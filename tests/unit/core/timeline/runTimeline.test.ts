import {
  clearRunTimelines,
  finishRunTimeline,
  formatRunTimelineMarkdown,
  getLastRunTimeline,
  recordRunTimelineChunk,
  startRunTimeline,
} from '@/core/timeline/runTimeline';

describe('runTimeline', () => {
  beforeEach(() => clearRunTimelines());

  it('records chunks and formats markdown', () => {
    const timeline = startRunTimeline({
      conversationId: 'conv-1',
      providerId: 'claude',
      model: 'sonnet',
      prompt: 'Fix the bug',
      now: () => 1000,
    });
    recordRunTimelineChunk(timeline, { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'a.ts' } }, () => 1100);
    recordRunTimelineChunk(timeline, { type: 'tool_result', id: 't1', content: 'ok' }, () => 1200);
    finishRunTimeline(timeline, 'success', () => 1500);

    const latest = getLastRunTimeline();
    expect(latest?.durationMs).toBe(500);
    expect(latest?.events.map(event => event.type)).toContain('tool_use');

    const md = formatRunTimelineMarkdown(latest!);
    expect(md).toContain('# Claudian Run Timeline');
    expect(md).toContain('Fix the bug');
    expect(md).toContain('Tool use: Edit');
    expect(md).toContain('Run finished: success');
  });
});
