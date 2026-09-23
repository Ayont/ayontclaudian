/**
 * Optional model-written digest for a condensed carry. Runs through an
 * isolated aux runner so it never touches the visible session, and always
 * falls back to null: the deterministic carry is the baseline, the summary
 * only adds what the verbatim tail had to drop.
 */

import type { AuxiliaryUsageRecord } from '../auxiliary/AuxiliaryUsageAccounting';
import type { AuxQueryRunner } from '../auxiliary/AuxQueryRunner';
import type { ChatMessage, UsageInfo } from '../types';
import { buildConversationContextBootstrap } from './ConversationContextBootstrap';

/** Long enough for a large transcript, short enough that the user is not left waiting. */
export const CONDENSED_SUMMARY_TIMEOUT_MS = 40_000;

/** Upper bound for the transcript handed to the summarizer (~60k tokens). */
export const CONDENSED_SUMMARY_INPUT_MAX_CHARS = 240_000;

export const CONDENSED_SUMMARY_SYSTEM_PROMPT = [
  'You condense a coding-agent conversation so it can continue in a fresh session with far less context.',
  'Write a factual digest in the language the conversation uses.',
  'Keep: the task and its current state, decisions and their reasons, files and commands that matter,',
  'open problems, and the next step. Drop greetings, retries, and tool output that no longer matters.',
  'Never invent facts. Use short paragraphs or bullets, no preamble, no closing remarks.',
].join(' ');

export interface CondensedSummaryRequest {
  runner: AuxQueryRunner;
  messages: ChatMessage[];
  goal?: string | null;
  model?: string;
  /** Hard cap for the returned summary. */
  maxChars: number;
  /** Cap for the transcript sent to the summarizer. */
  inputMaxChars?: number;
  timeoutMs?: number;
  /** Receives what the hidden call consumed so it can be booked. */
  onAccounting?: (record: Omit<AuxiliaryUsageRecord, 'providerId'>) => void;
}

export async function summarizeConversationForCarry(request: CondensedSummaryRequest): Promise<string | null> {
  const transcript = buildConversationContextBootstrap(request.messages, {
    maxChars: request.inputMaxChars ?? CONDENSED_SUMMARY_INPUT_MAX_CHARS,
  });
  if (!transcript || request.maxChars <= 0) {
    return null;
  }

  const prompt = buildSummaryPrompt(transcript, request.goal, request.maxChars);
  const abortController = new AbortController();
  const usageReports: UsageInfo[] = [];
  let acceptingUsage = true;
  let raw = '';
  let completed = false;
  let timer: number | null = null;

  const timeout = new Promise<null>((resolve) => {
    timer = window.setTimeout(() => resolve(null), request.timeoutMs ?? CONDENSED_SUMMARY_TIMEOUT_MS);
  });

  try {
    const answer = await Promise.race([
      request.runner.query({
        abortController,
        model: request.model,
        onUsage: (usage) => {
          if (acceptingUsage) usageReports.push(usage);
        },
        systemPrompt: CONDENSED_SUMMARY_SYSTEM_PROMPT,
      }, prompt),
      timeout,
    ]);
    if (answer === null) {
      return null;
    }
    raw = answer;
    completed = true;
    const summary = raw.trim();
    return summary ? clipSummary(summary, request.maxChars) : null;
  } catch {
    return null;
  } finally {
    if (timer !== null) window.clearTimeout(timer);
    acceptingUsage = false;
    if (!completed) abortController.abort();
    try {
      request.runner.reset();
    } catch {
      // The runner is isolated; a failed cleanup cannot affect the visible session.
    }
    if (completed || usageReports.length > 0) {
      request.onAccounting?.({
        inputTexts: [CONDENSED_SUMMARY_SYSTEM_PROMPT, prompt],
        model: request.model,
        outputText: raw,
        ...(usageReports.length > 0 ? { usageReports } : {}),
      });
    }
  }
}

function buildSummaryPrompt(transcript: string, goal: string | null | undefined, maxChars: number): string {
  const goalLine = goal?.trim() ? `Standing goal of this conversation: ${goal.trim()}\n\n` : '';
  return `${goalLine}Condense the conversation below into at most ${maxChars} characters.\n\n${transcript}`;
}

function clipSummary(summary: string, maxChars: number): string {
  if (summary.length <= maxChars) {
    return summary;
  }
  const marker = ' […]';
  return `${summary.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`;
}
