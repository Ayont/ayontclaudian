/**
 * Claudian - Conversation Context Bootstrap
 *
 * Provider-agnostic helper that renders prior conversation turns for the first
 * turn after a provider switch. A transcript that fits the target window is sent
 * whole. Only overflow past that window is omitted, and that omission is marked.
 *
 * Each provider keeps its own native session. The first turn after a switch carries
 * the local transcript that the target does not already have. The carry uses the
 * target context window: a transcript that fits is sent whole, and only the overflow
 * past that window is omitted.
 */

import { buildBoundedContextFromHistory, buildContextFromHistory } from '../../utils/session';
import type { ChatMessage } from '../types';

/**
 * Floor used only when the target window is unknown. A known window uses its
 * full character budget so a fitting transcript is never discarded early.
 */
export const CONTEXT_BOOTSTRAP_CHAR_CAP = 6000;

/** Rough chars-per-token used to translate a token window into a character budget. */
const CHARS_PER_TOKEN = 4;

/**
 * Character budget for a switch carry. A known context window is converted in
 * full (4 characters per token). Unknown or invalid windows stay at the small
 * floor so a missing catalog cannot emit an unbounded prompt.
 */
export function computeBootstrapCharCap(contextWindowTokens?: number): number {
  if (!contextWindowTokens || contextWindowTokens <= 0 || !Number.isFinite(contextWindowTokens)) {
    return CONTEXT_BOOTSTRAP_CHAR_CAP;
  }
  return Math.round(contextWindowTokens * CHARS_PER_TOKEN);
}

const CONTEXT_OPEN_TAG = '<conversation_context>';
const CONTEXT_CLOSE_TAG = '</conversation_context>';

export interface ConversationContextBootstrapOptions {
  /** Hard character cap for the framed body (defaults to CONTEXT_BOOTSTRAP_CHAR_CAP). */
  maxChars?: number;
}

/**
 * Builds a bounded, framed `<conversation_context>` snapshot from prior messages.
 *
 * Behavior:
 * - Formats turns via the shared `buildContextFromHistory` (User:/Assistant: pairs,
 *   skipping interrupts and empty assistant messages), keeping the MOST RECENT turns
 *   with oldest-last ordering.
 * - Hard-caps the body at `maxChars`. When older turns are dropped, an
 *   `[earlier turns omitted]` note is prepended so the model knows context was trimmed.
 * - Returns `''` for empty history or history with no renderable content (so callers
 *   can cheaply skip injection).
 *
 * @param messages Prior conversation messages (NOT including the current turn).
 * @param options Optional overrides (e.g. a smaller cap for tests).
 * @returns A framed bootstrap string, or `''` when there is nothing to carry.
 */
export function buildConversationContextBootstrap(
  messages: ChatMessage[],
  options: ConversationContextBootstrapOptions = {},
): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }

  const maxChars = options.maxChars ?? CONTEXT_BOOTSTRAP_CHAR_CAP;
  if (maxChars <= 0) {
    return '';
  }

  const frameOverhead = CONTEXT_OPEN_TAG.length + CONTEXT_CLOSE_TAG.length + 2;
  const bodyBudget = maxChars - frameOverhead;
  if (bodyBudget <= 0) {
    return '';
  }

  const body = buildBoundedBody(messages, bodyBudget);
  if (!body) {
    return '';
  }

  const framed = `${CONTEXT_OPEN_TAG}\n${body}\n${CONTEXT_CLOSE_TAG}`;
  return framed.length <= maxChars ? framed : limitSwitchCarry(framed, maxChars);
}

/**
 * Produces the bounded body by keeping the most recent renderable turns oldest-last,
 * dropping older turns until the formatted text fits within `maxChars`.
 */
function buildBoundedBody(messages: ChatMessage[], maxChars: number): string {
  return buildBoundedContextFromHistory(messages, maxChars, {
    includeSuccessfulOutcomes: true,
  }).trim();
}

/**
 * Messages the restored native session does not already contain.
 * An unknown watermark carries the whole transcript rather than dropping it.
 */
export function selectUncoveredMessages(
  messages: ChatMessage[],
  coveredThroughMessageId?: string | null,
): ChatMessage[] {
  if (!coveredThroughMessageId) {
    return messages;
  }
  const index = messages.findIndex((message) => message.id === coveredThroughMessageId);
  if (index < 0) {
    return messages;
  }
  return messages.slice(index + 1);
}

export interface ProviderSwitchCarryInput {
  messages: ChatMessage[];
  contextWindowTokens?: number;
  /** Last message id already inside the restored native session. */
  coveredThroughMessageId?: string | null;
  goal?: string | null;
}

/**
 * Renders the one-shot carry for a provider switch from the local transcript.
 * The whole uncovered transcript is kept when it fits the target window.
 * Older turns past that window are the only omission, and they are marked.
 * A restored native session receives only turns after its watermark.
 */
export function buildProviderSwitchCarry(input: ProviderSwitchCarryInput): string {
  const uncovered = selectUncoveredMessages(input.messages, input.coveredThroughMessageId);
  const goal = input.goal?.trim() ?? '';
  const goalBlock = goal ? `<standing_goal>\n${goal}\n</standing_goal>` : '';
  const windowBudget = computeBootstrapCharCap(input.contextWindowTokens);
  // The goal is inserted inside the frame. Reserve that insertion so the
  // finished string, tags included, stays inside the window budget.
  const goalExtra = goalBlock ? goalBlock.length + 2 : 0;
  const transcriptBudget = Math.max(0, windowBudget - goalExtra);
  const transcript = uncovered.length > 0
    ? buildConversationContextBootstrap(uncovered, { maxChars: transcriptBudget })
    : '';

  if (!transcript && !goalBlock) {
    return '';
  }
  if (!transcript) {
    return limitSwitchCarry(
      `${CONTEXT_OPEN_TAG}\n${goalBlock}\n${CONTEXT_CLOSE_TAG}`,
      windowBudget,
    );
  }
  if (!goalBlock) {
    return limitSwitchCarry(transcript, windowBudget);
  }
  return limitSwitchCarry(transcript.replace(
    `${CONTEXT_OPEN_TAG}\n`,
    `${CONTEXT_OPEN_TAG}\n${goalBlock}\n\n`,
  ), windowBudget);
}

const CARRY_OPEN = `${CONTEXT_OPEN_TAG}\n`;
const CARRY_CLOSE = `\n${CONTEXT_CLOSE_TAG}`;
const CARRY_OMISSION = '[earlier turns omitted]\n\n';

/**
 * Shortens an already framed carry so the whole string, tags included, fits
 * `maxChars`. The newest tail is kept and the cut is marked.
 */
export function limitSwitchCarry(carry: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (carry.length <= maxChars) {
    return carry;
  }
  if (!carry.startsWith(CARRY_OPEN) || !carry.endsWith(CARRY_CLOSE)) {
    if (maxChars <= CARRY_OMISSION.length) {
      return carry.slice(0, maxChars);
    }
    return CARRY_OMISSION + carry.slice(-(maxChars - CARRY_OMISSION.length));
  }

  const innerBudget = maxChars - CARRY_OPEN.length - CARRY_CLOSE.length;
  if (innerBudget <= 0) {
    return '';
  }
  const inner = carry.slice(CARRY_OPEN.length, carry.length - CARRY_CLOSE.length);
  return `${CARRY_OPEN}${shrinkCarryInner(inner, innerBudget)}${CARRY_CLOSE}`;
}

function shrinkCarryInner(inner: string, maxChars: number): string {
  if (inner.length <= maxChars) {
    return inner;
  }
  const goalMatch = inner.match(/^<standing_goal>[\s\S]*?<\/standing_goal>\n*/);
  const goal = goalMatch?.[0] ?? '';
  const rest = goal ? inner.slice(goal.length) : inner;
  if (goal.length >= maxChars) {
    return goal.slice(0, maxChars);
  }
  const room = maxChars - goal.length;
  if (room <= CARRY_OMISSION.length) {
    return (goal + CARRY_OMISSION).slice(0, maxChars);
  }
  const body = rest.startsWith(CARRY_OMISSION) ? rest.slice(CARRY_OMISSION.length) : rest;
  const tailBudget = room - CARRY_OMISSION.length;
  const tail = body.length > tailBudget ? body.slice(-tailBudget).trimStart() : body;
  return goal + CARRY_OMISSION + tail;
}

/**
 * Share of the window a condensed carry may use when a conversation continues
 * in a fresh native session. A provider switch carries up to the whole window;
 * the point of starting over is to leave most of it free.
 */
export const CONDENSED_CARRY_WINDOW_SHARE = 0.18;

/** Largest part of the condensed budget a model-written summary may take. */
const CONDENSED_SUMMARY_BUDGET_SHARE = 0.45;

const CONDENSED_HISTORY_OPTIONS = { includeSuccessfulOutcomes: true } as const;

export function computeCondensedCarryCharBudget(contextWindowTokens?: number): number {
  if (!contextWindowTokens || contextWindowTokens <= 0 || !Number.isFinite(contextWindowTokens)) {
    return CONTEXT_BOOTSTRAP_CHAR_CAP / 2;
  }
  return Math.round(computeBootstrapCharCap(contextWindowTokens) * CONDENSED_CARRY_WINDOW_SHARE);
}

/** Character budget a summary may take inside the condensed carry. */
export function computeCondensedSummaryCharBudget(contextWindowTokens?: number): number {
  return Math.floor(computeCondensedCarryCharBudget(contextWindowTokens) * CONDENSED_SUMMARY_BUDGET_SHARE);
}

export interface CondensedContextCarryInput {
  messages: ChatMessage[];
  contextWindowTokens?: number;
  goal?: string | null;
  /** Optional model-written digest of the whole transcript. */
  summary?: string | null;
}

/**
 * Carry for a fresh native session in the same conversation. The goal comes
 * first (the shrink step never cuts it), then the optional summary, then the
 * newest turns verbatim in whatever budget remains.
 */
export function buildCondensedContextCarry(input: CondensedContextCarryInput): string {
  const budget = computeCondensedCarryCharBudget(input.contextWindowTokens);
  const goal = input.goal?.trim() ?? '';
  const goalBlock = goal ? `<standing_goal>\n${goal}\n</standing_goal>` : '';
  const summaryText = clipText(
    input.summary?.trim() ?? '',
    computeCondensedSummaryCharBudget(input.contextWindowTokens),
  );
  const summaryBlock = summaryText ? `<condensed_summary>\n${summaryText}\n</condensed_summary>` : '';

  const fixedParts = [goalBlock, summaryBlock].filter(Boolean);
  const fixedLength = CARRY_OPEN.length + CARRY_CLOSE.length
    + fixedParts.reduce((total, part) => total + part.length + 2, 0);
  const transcriptBudget = budget - fixedLength;
  const transcript = transcriptBudget > 0
    ? buildBoundedContextFromHistory(input.messages, transcriptBudget, CONDENSED_HISTORY_OPTIONS).trim()
    : '';

  const parts = [...fixedParts, transcript].filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  return limitSwitchCarry(`${CARRY_OPEN}${parts.join('\n\n')}${CARRY_CLOSE}`, budget);
}

/** True when the condensed carry cannot hold the whole visible transcript. */
export function condensedCarryOmitsTurns(messages: ChatMessage[], contextWindowTokens?: number): boolean {
  const full = buildContextFromHistory(messages, CONDENSED_HISTORY_OPTIONS).trim();
  const room = computeCondensedCarryCharBudget(contextWindowTokens) - CARRY_OPEN.length - CARRY_CLOSE.length;
  return full.length > room;
}

function clipText(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  const marker = ' […]';
  return `${text.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`;
}
