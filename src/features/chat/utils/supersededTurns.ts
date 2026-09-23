import type { ChatMessage } from '../../../core/types';
import { userMessageText } from './messageText';

/**
 * A prompt the user sent. Interrupt markers and rebuilt history are user-role
 * transport artifacts inside a turn, never the start of a new one.
 */
export function isUserPrompt(message: ChatMessage): boolean {
  return message.role === 'user' && !message.isInterrupt && !message.isRebuiltContext;
}

interface TurnSlice {
  start: number;
  end: number;
  hasPrompt: boolean;
}

function sliceTurns(messages: readonly ChatMessage[]): TurnSlice[] {
  const slices: TurnSlice[] = [];
  let start = 0;
  for (let i = 1; i <= messages.length; i++) {
    if (i === messages.length || isUserPrompt(messages[i])) {
      if (i > start) slices.push({ start, end: i, hasPrompt: isUserPrompt(messages[start]) });
      start = i;
    }
  }
  return slices;
}

function isSupersededTurn(messages: readonly ChatMessage[], slice: TurnSlice): boolean {
  const answers = messages.slice(slice.start, slice.end).filter((message) => message.role === 'assistant');
  return answers.length > 0 && answers.every((message) => message.isSuperseded === true);
}

/**
 * The conversation as it now reads: a regenerated turn replaces the old one,
 * so exports drop the replaced answer together with the prompt that produced it.
 */
export function withoutSupersededTurns(messages: readonly ChatMessage[]): ChatMessage[] {
  const kept: ChatMessage[] = [];
  for (const slice of sliceTurns(messages)) {
    if (slice.hasPrompt && isSupersededTurn(messages, slice)) continue;
    for (const message of messages.slice(slice.start, slice.end)) {
      if (!(message.role === 'assistant' && message.isSuperseded)) kept.push(message);
    }
  }
  return kept;
}

/**
 * Provider transcripts do not know about superseded answers, so the mark lives
 * in Claudian's session metadata and is carried onto the hydrated history. It
 * only transfers when every turn still lines up by prompt text: collapsing the
 * wrong answer would be worse than showing a replaced one expanded.
 */
export function carrySupersededMarks(
  cached: readonly ChatMessage[],
  hydrated: ChatMessage[],
): ChatMessage[] {
  const cachedTurns = sliceTurns(cached).filter((slice) => slice.hasPrompt);
  const superseded = cachedTurns
    .map((slice, ordinal) => (isSupersededTurn(cached, slice) ? ordinal : -1))
    .filter((ordinal) => ordinal >= 0);
  if (superseded.length === 0) return hydrated;

  const hydratedTurns = sliceTurns(hydrated).filter((slice) => slice.hasPrompt);
  if (hydratedTurns.length !== cachedTurns.length) return hydrated;
  const aligned = cachedTurns.every((slice, ordinal) =>
    userMessageText(cached[slice.start]) === userMessageText(hydrated[hydratedTurns[ordinal].start]));
  if (!aligned) return hydrated;

  const markedIndices = new Set<number>();
  for (const ordinal of superseded) {
    const slice = hydratedTurns[ordinal];
    for (let i = slice.start; i < slice.end; i++) {
      if (hydrated[i].role === 'assistant') markedIndices.add(i);
    }
  }
  return hydrated.map((message, index) =>
    (markedIndices.has(index) ? { ...message, isSuperseded: true } : message));
}
