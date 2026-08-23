import { appendImagePathReferences } from '../../../core/providers/imagePathFallback';
import type { ChatTurnRequest } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import { appendBrowserContext } from '../../../utils/browser';
import { appendCanvasContext } from '../../../utils/canvas';
import { appendCurrentNote } from '../../../utils/context';
import { appendEditorContext } from '../../../utils/editor';
import { buildContextFromHistory, buildPromptWithHistoryContext } from '../../../utils/session';
import type { AcpContentBlock } from '../../acp';

/**
 * Hermes' ACP surface has no system-prompt channel: `new_session` builds its
 * agent from `~/.hermes/config.yaml` plus the CWD's AGENTS.md/SOUL.md. Rather
 * than write files into the user's vault, Claudian's vault prompt is sent as a
 * fenced preamble on the first turn of a session.
 */
const VAULT_PROMPT_HEADER = '<claudian-vault-instructions>';
const VAULT_PROMPT_FOOTER = '</claudian-vault-instructions>';

export function buildHermesPromptText(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
): string {
  let prompt = request.text;

  if (request.currentNotePath) {
    prompt = appendCurrentNote(prompt, request.currentNotePath);
  }

  if (request.editorSelection && request.editorSelection.mode !== 'none') {
    prompt = appendEditorContext(prompt, request.editorSelection);
  }

  if (request.browserSelection) {
    prompt = appendBrowserContext(prompt, request.browserSelection);
  }

  if (request.canvasSelection) {
    prompt = appendCanvasContext(prompt, request.canvasSelection);
  }

  if (conversationHistory.length > 0) {
    const historyContext = buildContextFromHistory(conversationHistory);
    prompt = buildPromptWithHistoryContext(
      historyContext,
      prompt,
      prompt,
      conversationHistory,
    );
  }

  return prompt;
}

export function prependHermesVaultPrompt(prompt: string, systemPrompt: string): string {
  const trimmed = systemPrompt.trim();
  if (!trimmed) {
    return prompt;
  }

  return `${VAULT_PROMPT_HEADER}\n${trimmed}\n${VAULT_PROMPT_FOOTER}\n\n${prompt}`;
}

export function buildHermesPromptBlocks(params: {
  conversationHistory?: ChatMessage[];
  request: ChatTurnRequest;
  vaultPrompt?: string;
}): AcpContentBlock[] {
  const promptText = buildHermesPromptText(
    params.request,
    params.conversationHistory ?? [],
  );
  // Native image blocks below carry the pixels; the staged-path references in
  // the text are the fallback for models that ignore ACP image blocks.
  const text = appendImagePathReferences(promptText, params.request.images);
  const blocks: AcpContentBlock[] = [{
    type: 'text',
    text: params.vaultPrompt ? prependHermesVaultPrompt(text, params.vaultPrompt) : text,
  }];

  for (const image of params.request.images ?? []) {
    if (!image.data) {
      continue;
    }

    blocks.push({
      data: image.data,
      mimeType: image.mediaType,
      type: 'image',
    });
  }

  return blocks;
}
