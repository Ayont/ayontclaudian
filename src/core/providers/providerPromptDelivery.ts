import { createHash } from 'node:crypto';

import type ClaudianPlugin from '../../main';
import { getVaultPath } from '../../utils/path';
import { escapePromptXmlAttribute, escapePromptXmlClosingTags } from '../../utils/promptXml';
import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../prompt/mainAgent';
import type { ChatRuntime } from '../runtime/ChatRuntime';
import type {
  ChatRuntimeEnsureReadyOptions,
  PreparedChatTurn,
} from '../runtime/types';
import { normalizeWorkspaceMode } from '../workspace/workspaceMode';
import type { PromptDeliveryPolicy } from './types';

export const CLAUDIAN_PROMPT_DELIVERY_STATE_KEY = 'claudianPromptDelivery';

interface PersistedPromptDeliveryState {
  promptKey: string;
  sessionId: string;
}

export interface ProviderPromptDeliveryOptions {
  plugin: ClaudianPlugin;
  policy: PromptDeliveryPolicy;
}

/**
 * Supplies the shared Claudian system instructions to transports without a
 * native system-prompt channel. Session transports receive one preamble per
 * native session; stateless transports receive it on every ordinary turn.
 */
export function withProviderPromptDelivery(
  base: ChatRuntime,
  options: ProviderPromptDeliveryOptions,
): ChatRuntime {
  if (options.policy === 'native-system') {
    return base;
  }

  let delivered: PersistedPromptDeliveryState | null = null;

  const wrapped: ChatRuntime = {
    providerId: base.providerId,
    getCapabilities: () => base.getCapabilities(),
    prepareTurn: request => base.prepareTurn(request),
    onReadyStateChange: listener => base.onReadyStateChange(listener),
    setResumeCheckpoint: checkpointId => base.setResumeCheckpoint(checkpointId),
    syncConversationState(conversation, externalContextPaths) {
      base.syncConversationState(conversation, externalContextPaths);
      delivered = restoreDeliveryState(conversation?.providerState, resolveSessionId(base, conversation?.sessionId));
    },
    reloadMcpServers: () => base.reloadMcpServers(),
    ensureReady: (ensureOptions?: ChatRuntimeEnsureReadyOptions) => base.ensureReady(ensureOptions),
    async *query(turn, conversationHistory, queryOptions) {
      if (isRawProviderSlashCommand(turn.request.text)) {
        yield* base.query(turn, conversationHistory, queryOptions);
        return;
      }

      const prompt = buildDeliveryPrompt(options.plugin);
      const currentSessionId = base.getSessionId();
      const needsPreamble = options.policy === 'stateless-turn'
        || queryOptions?.forceColdStart === true
        || !matchesDelivery(delivered, prompt.promptKey, currentSessionId);
      const deliveredTurn = needsPreamble
        ? prependSystemPreamble(turn, prompt.text, prompt.promptKey)
        : turn;

      let failed = false;
      let completed = false;
      for await (const chunk of base.query(deliveredTurn, conversationHistory, queryOptions)) {
        if (chunk.type === 'error') failed = true;
        if (chunk.type === 'done') completed = true;
        yield chunk;
      }

      // A failed, interrupted, or contract-incomplete turn must be retried with
      // the preamble. Marking it in `finally` used to suppress redelivery even
      // when the provider rejected the request or the consumer closed the stream.
      if (options.policy === 'session-preamble' && needsPreamble && completed && !failed) {
        const sessionId = base.getSessionId();
        delivered = sessionId ? { promptKey: prompt.promptKey, sessionId } : null;
      }
    },
    cancel: () => base.cancel(),
    resetSession() {
      delivered = null;
      base.resetSession();
    },
    getSessionId: () => base.getSessionId(),
    consumeSessionInvalidation() {
      const invalidated = base.consumeSessionInvalidation();
      if (invalidated) delivered = null;
      return invalidated;
    },
    isReady: () => base.isReady(),
    getSupportedCommands: () => base.getSupportedCommands(),
    cleanup: () => base.cleanup(),
    rewind: (userMessageId, assistantMessageId, mode) => base.rewind(userMessageId, assistantMessageId, mode),
    setApprovalCallback: callback => base.setApprovalCallback(callback),
    setApprovalDismisser: dismisser => base.setApprovalDismisser(dismisser),
    setAskUserQuestionCallback: callback => base.setAskUserQuestionCallback(callback),
    setExitPlanModeCallback: callback => base.setExitPlanModeCallback(callback),
    setPermissionModeSyncCallback: callback => base.setPermissionModeSyncCallback(callback),
    setSubagentHookProvider: getState => base.setSubagentHookProvider(getState),
    setAutoTurnCallback: callback => base.setAutoTurnCallback(callback),
    consumeTurnMetadata: () => base.consumeTurnMetadata(),
    buildSessionUpdates(params) {
      const result = base.buildSessionUpdates(params);
      if (params.sessionInvalidated) delivered = null;

      const sessionId = resolveSessionId(base, result.updates.sessionId, params.conversation?.sessionId);
      const marker = delivered?.sessionId === sessionId ? delivered : null;
      const providerState = mergePromptDeliveryState(result.updates.providerState, marker);

      return {
        updates: {
          ...result.updates,
          providerState,
        },
      };
    },
    resolveSessionIdForFork: conversation => base.resolveSessionIdForFork(conversation),
  };

  if (base.steer) {
    wrapped.steer = turn => base.steer!(turn);
  }
  if (base.softSteer) {
    wrapped.softSteer = turn => base.softSteer!(turn);
  }
  if (base.getAuxiliaryModel) {
    wrapped.getAuxiliaryModel = () => base.getAuxiliaryModel!();
  }
  if (base.loadSubagentToolCalls) {
    wrapped.loadSubagentToolCalls = agentId => base.loadSubagentToolCalls!(agentId);
  }
  if (base.loadSubagentFinalResult) {
    wrapped.loadSubagentFinalResult = agentId => base.loadSubagentFinalResult!(agentId);
  }

  return wrapped;
}

export function isRawProviderSlashCommand(text: string): boolean {
  return /^\/[a-z][\w-]*(?:\s|$)/i.test(text.trimStart());
}

function buildDeliveryPrompt(plugin: ClaudianPlugin): { promptKey: string; text: string } {
  const settings = getSystemPromptSettings(plugin);
  const text = buildSystemPrompt(settings);
  const rawKey = `${computeSystemPromptKey(settings)}\0${text}`;
  return {
    promptKey: `sha256:${createHash('sha256').update(rawKey).digest('hex')}`,
    text,
  };
}

function getSystemPromptSettings(plugin: ClaudianPlugin): SystemPromptSettings {
  const settings = plugin.settings;
  return {
    customPrompt: settings.systemPrompt,
    mediaFolder: settings.mediaFolder,
    userName: settings.userName,
    vaultPath: plugin.app ? getVaultPath(plugin.app) ?? undefined : undefined,
    workspaceMode: normalizeWorkspaceMode(settings.workspaceMode),
  };
}

function prependSystemPreamble(
  turn: PreparedChatTurn,
  systemPrompt: string,
  promptKey: string,
): PreparedChatTurn {
  const preamble = [
    `<claudian_system_preamble prompt-key="${escapePromptXmlAttribute(promptKey)}">`,
    escapePromptXmlClosingTags(systemPrompt, 'claudian_system_preamble'),
    '</claudian_system_preamble>',
  ].join('\n');
  const body = turn.prompt || turn.request.text;
  const prompt = body ? `${preamble}\n\n${body}` : preamble;

  return {
    ...turn,
    request: {
      ...turn.request,
      text: prompt,
    },
    persistedContent: prompt,
    prompt,
  };
}

function restoreDeliveryState(
  providerState: Record<string, unknown> | undefined,
  currentSessionId: string | null,
): PersistedPromptDeliveryState | null {
  const raw = providerState?.[CLAUDIAN_PROMPT_DELIVERY_STATE_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const promptKey = (raw as Record<string, unknown>).promptKey;
  const sessionId = (raw as Record<string, unknown>).sessionId;
  if (typeof promptKey !== 'string' || typeof sessionId !== 'string') return null;
  return currentSessionId === sessionId ? { promptKey, sessionId } : null;
}

function mergePromptDeliveryState(
  providerState: Record<string, unknown> | undefined,
  marker: PersistedPromptDeliveryState | null,
): Record<string, unknown> | undefined {
  const merged = { ...(providerState ?? {}) };
  if (marker) {
    merged[CLAUDIAN_PROMPT_DELIVERY_STATE_KEY] = marker;
  } else {
    delete merged[CLAUDIAN_PROMPT_DELIVERY_STATE_KEY];
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function matchesDelivery(
  marker: PersistedPromptDeliveryState | null,
  promptKey: string,
  sessionId: string | null,
): boolean {
  return Boolean(sessionId && marker?.promptKey === promptKey && marker.sessionId === sessionId);
}

function resolveSessionId(
  base: ChatRuntime,
  ...candidates: Array<string | null | undefined>
): string | null {
  const runtimeSessionId = base.getSessionId();
  if (runtimeSessionId) return runtimeSessionId;
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
    ?? null;
}
