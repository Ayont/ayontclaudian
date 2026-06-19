import { formatMissionLogMarkdown } from '../../../../../src/core/intelligence/multiAgent/formatMissionLogMarkdown';
import type { MissionEvent, MissionState } from '../../../../../src/core/intelligence/multiAgent/MissionStateStorage';

const baseMission = (id: string): MissionState => ({
  taskId: id,
  prompt: 'do something',
  agentIds: ['a'],
  status: 'completed',
  overall: 100,
  agents: [{ agentId: 'a', status: 'done', progress: 100, output: 'result' }],
  createdAt: 0,
  updatedAt: 1,
});

describe('formatMissionLogMarkdown', () => {
  it('renders mission metadata and timeline', () => {
    const mission: MissionState = {
      ...baseMission('m-1'),
      synthesis: { status: 'done', output: 'final answer' },
    };
    const events: MissionEvent[] = [
      { ts: 0, type: 'started', message: 'started' },
      { ts: 1, type: 'agent-done', agentId: 'a', message: 'done' },
    ];

    const md = formatMissionLogMarkdown([mission], new Map([['m-1', events]]), 2);

    expect(md).toContain('# Mission Log');
    expect(md).toContain('## m-1');
    expect(md).toContain('completed');
    expect(md).toContain('final answer');
    expect(md).toContain('a (done)');
    expect(md).toContain('started');
    expect(md).toContain('done');
  });

  it('renders empty state when no missions', () => {
    const md = formatMissionLogMarkdown([], new Map(), 0);
    expect(md).toContain('No missions recorded');
  });
});
