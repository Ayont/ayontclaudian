import type { SubagentInfo, ToolCallInfo } from '@/core/types';
import {
  appendSubagentTimeline,
  buildSubagentTranscript,
  describeSubagentActivity,
  formatSubagentDuration,
  isLiveSubagentPhase,
  resolveSubagentPhase,
  SUBAGENT_PHASE_LABELS,
  SUBAGENT_TIMELINE_LIMIT,
  summarizeSubagent,
} from '@/features/chat/subagents/subagentPresentation';

function info(overrides: Partial<SubagentInfo> = {}): SubagentInfo {
  return {
    id: 'toolu_1',
    description: 'Durchsucht die Firewall-Regeln',
    status: 'running',
    toolCalls: [],
    isExpanded: false,
    ...overrides,
  };
}

function tool(overrides: Partial<ToolCallInfo> & { id: string }): ToolCallInfo {
  return { name: 'Read', input: {}, status: 'completed', ...overrides };
}

describe('resolveSubagentPhase', () => {
  it('reads a running agent as running and a background launch as starting', () => {
    expect(resolveSubagentPhase(info())).toBe('running');
    expect(resolveSubagentPhase(info({ mode: 'async', asyncStatus: 'pending' }))).toBe('starting');
  });

  it('shows a requested stop while the provider has not confirmed it', () => {
    expect(resolveSubagentPhase(info({ cancelState: 'requested' }))).toBe('stopping');
  });

  // A stopped agent ends with an error status on every provider; the user's
  // own stop must not read as a failure.
  it('reads an agent that ended after the user stopped it as stopped, not failed', () => {
    expect(resolveSubagentPhase(info({ status: 'error', cancelState: 'requested' }))).toBe('cancelled');
    expect(resolveSubagentPhase(info({ status: 'error', cancelState: 'cancelled' }))).toBe('cancelled');
    expect(resolveSubagentPhase(info({ status: 'running', cancelState: 'cancelled' }))).toBe('cancelled');
  });

  it('separates failures, completions and chats that ended underneath the agent', () => {
    expect(resolveSubagentPhase(info({ status: 'error' }))).toBe('failed');
    expect(resolveSubagentPhase(info({ status: 'completed' }))).toBe('completed');
    expect(resolveSubagentPhase(info({ status: 'error', asyncStatus: 'orphaned' }))).toBe('orphaned');
  });

  it('labels every phase in German', () => {
    expect(SUBAGENT_PHASE_LABELS).toEqual({
      starting: 'Startet',
      running: 'Läuft',
      stopping: 'Wird gestoppt',
      completed: 'Fertig',
      failed: 'Fehlgeschlagen',
      cancelled: 'Gestoppt',
      orphaned: 'Abgebrochen',
    });
    expect(isLiveSubagentPhase('stopping')).toBe(true);
    expect(isLiveSubagentPhase('cancelled')).toBe(false);
  });
});

describe('describeSubagentActivity', () => {
  it('prefers the provider activity line while the agent works', () => {
    const activity = describeSubagentActivity(info({
      activity: 'Running sleep 25 && echo slept',
      lastToolName: 'Bash',
      toolCalls: [tool({ id: 't1', name: 'Read', input: { file_path: '/v/a.md' } })],
    }));

    expect(activity).toEqual({ text: 'Running sleep 25 && echo slept', toolName: 'Bash' });
  });

  it('falls back to the tool that is running right now', () => {
    const activity = describeSubagentActivity(info({
      toolCalls: [
        tool({ id: 't1', name: 'Read', input: { file_path: '/v/a.md' } }),
        tool({ id: 't2', name: 'Grep', input: { pattern: 'fax' }, status: 'running' }),
      ],
    }));

    expect(activity?.toolName).toBe('Grep');
    expect(activity?.text).toContain('fax');
  });

  it('shows the result opening once the agent is done', () => {
    const activity = describeSubagentActivity(info({
      status: 'completed',
      activity: 'Running ls',
      result: '\n\nDrei Regeln blockieren Port 443.\nDetails folgen.',
    }));

    expect(activity).toEqual({ text: 'Drei Regeln blockieren Port 443.', toolName: undefined });
  });

  it('has nothing to say about an agent that has not acted yet', () => {
    expect(describeSubagentActivity(info())).toBeNull();
  });
});

describe('summarizeSubagent', () => {
  it('counts tools by outcome and trusts the larger provider count', () => {
    const summary = summarizeSubagent(info({
      toolUses: 7,
      totalTokens: 15853,
      toolCalls: [
        tool({ id: 't1', status: 'completed' }),
        tool({ id: 't2', status: 'error' }),
        tool({ id: 't3', status: 'running' }),
      ],
    }));

    expect(summary).toMatchObject({ toolCount: 7, failedTools: 1, runningTools: 1, totalTokens: 15853 });
  });

  it('lists the files the agent touched, newest last, without duplicates', () => {
    const summary = summarizeSubagent(info({
      toolCalls: [
        tool({ id: 't1', name: 'Read', input: { file_path: '/vault/a.md' } }),
        tool({ id: 't2', name: 'Edit', input: { file_path: '/vault/b.ts' } }),
        tool({ id: 't3', name: 'Read', input: { file_path: '/vault/a.md' } }),
        tool({ id: 't4', name: 'Bash', input: { command: 'ls' } }),
      ],
    }));

    expect(summary.files).toEqual(['/vault/b.ts', '/vault/a.md']);
  });

  it('measures elapsed time from start to completion, or to now while live', () => {
    expect(summarizeSubagent(info({ startedAt: 1_000, completedAt: 66_000, status: 'completed' }), 99_000).elapsedMs).toBe(65_000);
    expect(summarizeSubagent(info({ startedAt: 1_000 }), 31_000).elapsedMs).toBe(30_000);
    expect(summarizeSubagent(info({ durationMs: 4_200, status: 'completed' })).elapsedMs).toBe(4_200);
  });
});

describe('formatSubagentDuration', () => {
  it('stays short and tabular', () => {
    expect(formatSubagentDuration(4_200)).toBe('4s');
    expect(formatSubagentDuration(65_000)).toBe('1m 05s');
    expect(formatSubagentDuration(3_725_000)).toBe('1h 02m');
  });
});

describe('appendSubagentTimeline', () => {
  it('merges consecutive text into one entry and keeps tools in order', () => {
    let timeline = appendSubagentTimeline(undefined, { type: 'text', text: 'Ich prüfe ', at: 1 });
    timeline = appendSubagentTimeline(timeline, { type: 'text', text: 'die Regeln.', at: 2 });
    timeline = appendSubagentTimeline(timeline, { type: 'tool', toolId: 't1', at: 3 });
    timeline = appendSubagentTimeline(timeline, { type: 'tool', toolId: 't1', at: 4 });

    expect(timeline).toEqual([
      { type: 'text', text: 'Ich prüfe die Regeln.', at: 1, seq: 0 },
      { type: 'tool', toolId: 't1', at: 3, seq: 1 },
    ]);
  });

  it('never grows past its limit and keeps the newest entries', () => {
    let timeline = appendSubagentTimeline(undefined, { type: 'tool', toolId: 't0', at: 0 });
    for (let i = 1; i <= SUBAGENT_TIMELINE_LIMIT + 5; i++) {
      timeline = appendSubagentTimeline(timeline, { type: 'tool', toolId: `t${i}`, at: i });
    }

    expect(timeline).toHaveLength(SUBAGENT_TIMELINE_LIMIT);
    expect(timeline.at(-1)).toMatchObject({ type: 'tool', toolId: `t${SUBAGENT_TIMELINE_LIMIT + 5}`, at: SUBAGENT_TIMELINE_LIMIT + 5 });
  });

  it('does not change the timeline it was given', () => {
    const original = [{ type: 'text' as const, text: 'a', at: 1 }];
    appendSubagentTimeline(original, { type: 'text', text: 'b', at: 2 });

    expect(original).toEqual([{ type: 'text', text: 'a', at: 1 }]);
  });
});

describe('buildSubagentTranscript', () => {
  it('orders the prompt, what the agent wrote and did, and its result', () => {
    const entries = buildSubagentTranscript(info({
      prompt: 'Prüfe Regel 12',
      status: 'completed',
      result: 'Regel 12 blockiert Port 443.',
      toolCalls: [tool({ id: 't1', name: 'Read' })],
      timeline: [
        { type: 'text', text: 'Ich lese die Konfiguration.', at: 1 },
        { type: 'tool', toolId: 't1', at: 2 },
      ],
    }));

    expect(entries.map(entry => entry.key)).toEqual(['prompt', 'text-0', 'tool-t1', 'result']);
  });

  // Providers without a transcript (and older chats) still show every tool.
  it('falls back to the tool calls when there is no timeline', () => {
    const entries = buildSubagentTranscript(info({
      toolCalls: [tool({ id: 't1' }), tool({ id: 't2' })],
    }));

    expect(entries.map(entry => entry.key)).toEqual(['tool-t1', 'tool-t2']);
  });

  // A bounded timeline drops its oldest entries; tools missing from it are older
  // than everything still in it.
  it('puts tools missing from the timeline before it', () => {
    const entries = buildSubagentTranscript(info({
      toolCalls: [tool({ id: 't1' }), tool({ id: 't2' })],
      timeline: [{ type: 'tool', toolId: 't2', at: 1 }],
    }));

    expect(entries.map(entry => entry.key)).toEqual(['tool-t1', 'tool-t2']);
  });

  it('shows a result only once the agent reached an outcome', () => {
    expect(buildSubagentTranscript(info({ result: 'noch nicht' })).some(entry => entry.kind === 'result')).toBe(false);
    expect(buildSubagentTranscript(info({ status: 'error', cancelState: 'cancelled' })).at(-1))
      .toEqual({ kind: 'result', key: 'result', text: 'Von dir gestoppt.', phase: 'cancelled' });
  });
});

describe('transcript stability', () => {
  it('numbers entries so trimming the front never renames them', () => {
    let timeline = appendSubagentTimeline(undefined, { type: 'text', text: 'a', at: 1 });
    timeline = appendSubagentTimeline(timeline, { type: 'tool', toolId: 't1', at: 2 });
    timeline = appendSubagentTimeline(timeline, { type: 'text', text: 'b', at: 3 });

    expect(timeline.map(entry => entry.seq)).toEqual([0, 1, 2]);
    expect(buildSubagentTranscript(info({ timeline: timeline.slice(1), toolCalls: [tool({ id: 't1' })] })).map(entry => entry.key))
      .toEqual(['tool-t1', 'text-2']);
  });

  it('shows the stop, not the provider interrupt notice, as a stopped agent\'s outcome', () => {
    const entries = buildSubagentTranscript(info({
      status: 'error',
      cancelState: 'cancelled',
      result: '[Request interrupted by user for tool use]',
    }));

    expect(entries.at(-1)).toMatchObject({ kind: 'result', text: 'Von dir gestoppt.' });
  });
});
