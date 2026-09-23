/**
 * "Erneut generieren": produce a new answer for a prompt that was already sent.
 *
 * Two strategies, chosen per provider capability:
 * - rewind: the runtime can drop the answer from its own session (Claude). The
 *   conversation is rewound to just before the prompt and the prompt is sent
 *   again, so the new answer truly replaces the old one.
 * - supersede: every other provider keeps the old answer in its session no
 *   matter what the transcript shows. The old answer is marked superseded and
 *   collapsed, and the prompt goes out as a new turn.
 *
 * The prompt is resent through the send path with its original text, images,
 * file chips and editor selection. The composer is never read or written, so
 * an unsent draft survives.
 */

import { Notice } from 'obsidian';

import type { OutputSurface } from '../../../core/runtime/types';
import type { ChatMessage, ImageAttachment } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { type EditorSelectionContext, parseEditorSelectionContext } from '../../../utils/editor';
import { findRewindContext } from '../rewind';
import { restoreComposerAttachment } from '../ui/file-drop/restoreAttachment';
import { attachmentOnlyDisplayContent, type ComposerAttachment } from '../ui/file-drop/stagedAttachment';
import { userMessageText } from '../utils/messageText';
import { isUserPrompt } from '../utils/supersededTurns';
import { getTabProviderId } from './providerResolution';
import type { TabData } from './types';

export const REGENERATE_STREAMING_NOTICE = 'Es läuft bereits eine Antwort — bitte warten oder abbrechen.';
const NO_PROMPT_NOTICE = 'Kein Prompt zum erneuten Ausführen gefunden.';

export type RegenerationStrategy = 'rewind' | 'supersede';

export interface RegenerationPlan {
  strategy: RegenerationStrategy;
  userMessage: ChatMessage;
  /** What the user typed; empty for an attachment-only turn. */
  prompt: string;
  /** Every answer message of the turn, in order. */
  answerIds: string[];
  outputSurface?: OutputSurface;
}

export type RegenerationDecision =
  | { ok: true; plan: RegenerationPlan }
  | { ok: false; reason: string };

function resendablePrompt(userMessage: ChatMessage): string {
  const text = userMessageText(userMessage);
  const attachmentLabel = attachmentOnlyDisplayContent(userMessage.attachments ?? []);
  return attachmentLabel && text === attachmentLabel ? '' : text;
}

/**
 * Rewinding only replaces the newest turn: rewinding an older one would also
 * throw away every later turn of the conversation.
 */
function canRewindTurn(messages: ChatMessage[], userIndex: number, isLatestTurn: boolean): boolean {
  if (!isLatestTurn || !messages[userIndex].userMessageId) return false;
  const context = findRewindContext(messages, userIndex);
  return !!context.prevAssistantUuid && context.hasResponse;
}

export function planRegeneration(
  messages: ChatMessage[],
  assistantMessageId: string,
  options: { canRewind: boolean },
): RegenerationDecision {
  const answerIndex = messages.findIndex((message) => message.id === assistantMessageId && message.role === 'assistant');
  if (answerIndex === -1) return { ok: false, reason: 'Antwort nicht gefunden.' };
  const answer = messages[answerIndex];
  if (answer.isSuperseded) return { ok: false, reason: 'Diese Antwort wurde bereits ersetzt.' };

  let userIndex = -1;
  for (let i = answerIndex - 1; i >= 0; i--) {
    if (isUserPrompt(messages[i])) {
      userIndex = i;
      break;
    }
  }
  if (userIndex === -1) return { ok: false, reason: NO_PROMPT_NOTICE };

  const nextPromptOffset = messages.slice(answerIndex + 1).findIndex(isUserPrompt);
  const turnEnd = nextPromptOffset === -1 ? messages.length : answerIndex + 1 + nextPromptOffset;
  const userMessage = messages[userIndex];
  const prompt = resendablePrompt(userMessage);
  if (!prompt && !userMessage.images?.length && !userMessage.attachments?.length) {
    return { ok: false, reason: NO_PROMPT_NOTICE };
  }

  const strategy: RegenerationStrategy = options.canRewind && canRewindTurn(messages, userIndex, nextPromptOffset === -1)
    ? 'rewind'
    : 'supersede';
  return {
    ok: true,
    plan: {
      strategy,
      userMessage,
      prompt,
      answerIds: messages.slice(userIndex + 1, turnEnd)
        .filter((message) => message.role === 'assistant')
        .map((message) => message.id),
      ...(answer.outputSurface && answer.outputSurface !== 'chat' ? { outputSurface: answer.outputSurface } : {}),
    },
  };
}

/** The newest answer that can still be regenerated or copied; the streaming turn is not finished yet. */
export function findLastAnswerId(messages: ChatMessage[], options: { isStreaming: boolean }): string | null {
  let end = messages.length;
  if (options.isStreaming) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (isUserPrompt(messages[i])) {
        end = i;
        break;
      }
    }
  }
  for (let i = end - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'assistant' && !message.isSuperseded && !message.isInterrupt) return message.id;
  }
  return null;
}

function canRewindInTab(tab: TabData, plugin: ClaudianPlugin): boolean {
  const service = tab.service;
  // Rewind runs on the live runtime; a released or foreign one cannot do it.
  if (!service || service.providerId !== getTabProviderId(tab, plugin)) return false;
  return service.getCapabilities().supportsRewind === true;
}

/** Stored images drop their bytes after the first save; the archive still has them. */
async function restoreImages(
  images: ImageAttachment[] | undefined,
  plugin: ClaudianPlugin,
): Promise<ImageAttachment[] | null> {
  if (!images?.length) return [];
  const missing = images.filter((image) => !image.data).map((image) => image.id);
  const loaded = missing.length > 0
    ? await plugin.imageStagingService?.loadImages(missing).catch(() => new Map<string, ImageAttachment>())
    : new Map<string, ImageAttachment>();
  const restored = images.map((image) => (image.data ? { ...image } : loaded?.get(image.id) ?? null));
  return restored.every((image): image is ImageAttachment => image !== null) ? restored : null;
}

function budgetBlockReason(plugin: ClaudianPlugin): string | null {
  if (plugin.settings.tokenBudgetEnabled === false || !plugin.tokenBudgetTracker) return null;
  const budget = plugin.tokenBudgetTracker.checkBudget(plugin.settings);
  return budget?.ok === false ? (budget.reason ?? 'Token-Budget erreicht.') : null;
}

function withSupersededMark(message: ChatMessage, superseded: boolean): ChatMessage {
  if (superseded) return { ...message, isSuperseded: true };
  const copy = { ...message };
  delete copy.isSuperseded;
  return copy;
}

function markSuperseded(tab: TabData, ids: string[], superseded: boolean): void {
  const idSet = new Set(ids);
  tab.state.messages = tab.state.messages.map((message) =>
    (idSet.has(message.id) ? withSupersededMark(message, superseded) : message));
  tab.renderer?.setMessagesSuperseded(ids, superseded);
}

interface ResendRequest {
  content: string;
  images?: ImageAttachment[];
  attachments: ComposerAttachment[];
  outputSurface?: OutputSurface;
  editorContextOverride: EditorSelectionContext | null;
  browserContextOverride: null;
  canvasContextOverride: null;
}

export async function regenerateTabAnswer(
  tab: TabData,
  plugin: ClaudianPlugin,
  assistantMessageId: string,
): Promise<void> {
  const { state } = tab;
  const inputController = tab.controllers.inputController;
  if (!inputController) return;
  if (state.isStreaming) {
    new Notice(REGENERATE_STREAMING_NOTICE);
    return;
  }

  const decision = planRegeneration(state.messages, assistantMessageId, { canRewind: canRewindInTab(tab, plugin) });
  if (!decision.ok) {
    new Notice(decision.reason);
    return;
  }
  const { plan } = decision;

  // Everything that can fail is resolved before the old answer is touched.
  const images = await restoreImages(plan.userMessage.images, plugin);
  if (!images) {
    new Notice('Ein Bild der ursprünglichen Nachricht ist nicht mehr verfügbar — erneutes Generieren abgebrochen.');
    return;
  }
  const readBinary = (relPath: string) => plugin.app.vault.adapter.readBinary(relPath);
  const attachments = await Promise.all(
    (plan.userMessage.attachments ?? []).map((attachment) => restoreComposerAttachment(attachment, readBinary)),
  );
  const blocked = budgetBlockReason(plugin);
  if (blocked) {
    new Notice(blocked);
    return;
  }
  if (state.isStreaming) {
    new Notice(REGENERATE_STREAMING_NOTICE);
    return;
  }

  // Browser and canvas selections are not persisted in a replayable form; a
  // stale live selection must not slip into the resent prompt instead.
  const request: ResendRequest = {
    content: plan.prompt,
    images: images.length > 0 ? images : undefined,
    attachments,
    outputSurface: plan.outputSurface,
    editorContextOverride: parseEditorSelectionContext(plan.userMessage.content),
    browserContextOverride: null,
    canvasContextOverride: null,
  };

  if (plan.strategy === 'rewind') {
    const rewound = await tab.controllers.conversationController?.rewind(
      plan.userMessage.id,
      'conversation',
      { silent: true },
    );
    if (rewound) await inputController.sendMessage(request);
    return;
  }

  const knownIds = new Set(state.messages.map((message) => message.id));
  markSuperseded(tab, plan.answerIds, true);
  await inputController.sendMessage(request);
  // A send can bail out before it starts (budget, relay limits); the old
  // answer must not stay hidden without a replacement.
  const started = tab.state.messages.some((message) => !knownIds.has(message.id) && message.role === 'user');
  if (!started) markSuperseded(tab, plan.answerIds, false);
}
