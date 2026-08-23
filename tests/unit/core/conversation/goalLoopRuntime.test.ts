import { withGoalLoop } from '@/core/conversation/goalLoopRuntime';
import { parseGoalCommand } from '@/core/conversation/goalPrompt';
import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import type { PreparedChatTurn } from '@/core/runtime/types';
import type { StreamChunk } from '@/core/types/chat';

const GOAL_PROMPT = '<standing_goal>Test-Ziel</standing_goal>\nMach es.';

function fakeRuntime(handler: (prompt: string) => AsyncGenerator<StreamChunk>): ChatRuntime {
  const runtime = {
    providerId: 'kimi',
    query: (turn: PreparedChatTurn) => handler(turn.prompt),
  };
  return runtime as unknown as ChatRuntime;
}

function textChunks(chunks: StreamChunk[]): string {
  return chunks.filter((c) => c.type === 'text').map((c) => (c as { content: string }).content).join('');
}

async function drain(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

describe('withGoalLoop', () => {
  it('passes turns without a framed goal straight through', async () => {
    const seen: string[] = [];
    const base = fakeRuntime(async function* (prompt) {
      seen.push(prompt);
      yield { type: 'text', content: 'plain' };
      yield { type: 'done' };
    });
    const wrapped = withGoalLoop(base, { isPaused: () => false });
    const chunks = await drain(wrapped.query({ request: { text: 'hi' }, persistedContent: '', prompt: 'hi', isCompact: false, mcpMentions: new Set() }));
    expect(seen).toEqual(['hi']);
    expect(textChunks(chunks)).toBe('plain');
  });

  it('verifies the goal and continues until the verifier agrees', async () => {
    const prompts: string[] = [];
    let turn = 0;
    const base = fakeRuntime(async function* (prompt) {
      prompts.push(prompt);
      turn += 1;
      if (turn === 1) {
        yield { type: 'text', content: 'Arbeit 1' };
        yield { type: 'done' };
      } else if (turn === 2) {
        // Verifier pass: goal NOT done yet.
        yield { type: 'text', content: '{"done": false, "reason": "fehlt", "nextStep": "mehr", "confidence": 0.9}' };
        yield { type: 'done' };
      } else if (turn === 3) {
        yield { type: 'text', content: 'Arbeit 2' };
        yield { type: 'done' };
      } else if (turn === 4) {
        yield { type: 'text', content: '{"done": true, "reason": "ok", "nextStep": "", "confidence": 0.9}' };
        yield { type: 'done' };
      }
    });
    const wrapped = withGoalLoop(base, { isPaused: () => false });
    const chunks = await drain(wrapped.query({ request: { text: 'goal' }, persistedContent: '', prompt: GOAL_PROMPT, isCompact: false, mcpMentions: new Set() }));
    const text = textChunks(chunks);
    expect(text).toContain('Arbeit 1');
    expect(text).toContain('Arbeit 2');
    expect(text).not.toContain('fehlt');
    expect(prompts.some((p) => p.includes('strenger Prüfer'))).toBe(true);
    expect(chunks[chunks.length - 1]?.type).toBe('done');
  });

  it('suspends before the next iteration when paused', async () => {
    let turn = 0;
    const base = fakeRuntime(async function* (prompt) {
      turn += 1;
      yield { type: 'text', content: turn === 1 ? 'Arbeit 1' : '{"done": false, "reason": "offen", "nextStep": "", "confidence": 1}' };
      yield { type: 'done' };
    });
    const wrapped = withGoalLoop(base, { isPaused: () => true });
    const chunks = await drain(wrapped.query({ request: { text: 'goal' }, persistedContent: '', prompt: GOAL_PROMPT, isCompact: false, mcpMentions: new Set() }));
    const notices = chunks.filter((c) => c.type === 'notice').map((c) => (c as { content: string }).content).join('');
    expect(notices).toContain('pausiert');
    // Pause hits before the verifier runs — no wasted call while suspended.
    expect(turn).toBe(1);
  });
});

describe('parseGoalCommand', () => {
  it('routes pause, resume and clear keywords', () => {
    expect(parseGoalCommand('pause')).toEqual({ action: 'pause', goal: null });
    expect(parseGoalCommand('resume')).toEqual({ action: 'resume', goal: null });
    expect(parseGoalCommand('done')).toEqual({ action: 'clear', goal: null });
  });

  it('treats anything else as an immediately started goal', () => {
    expect(parseGoalCommand('Refactor die Auth')).toEqual({ action: 'set', goal: 'Refactor die Auth' });
  });
});