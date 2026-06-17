import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';

import { isSubagentToolName, TOOL_AGENT_OUTPUT } from '@/core/tools/toolNames';
import type { StreamChunk } from '@/core/types';
import { SubagentManager } from '@/features/chat/services/SubagentManager';
import { humanizeKimiTool, parseKimiStreamLine } from '@/providers/kimi/normalization/streamEvents';
import { createKimiStreamState, mapKimiEventToChunks } from '@/providers/kimi/normalization/streamMapping';

/**
 * End-to-end proof that kimi-cli's built-in `Agent` subagent tool flows into the
 * shared subagent pipeline (and therefore the swarm overview). Uses the real
 * stream-json + Agent-tool shapes taken from MoonshotAI/kimi-cli source.
 */

function kimiAgentToolUseLine(args: Record<string, unknown>, id = 'call_agent_1'): string {
  return JSON.stringify({
    role: 'assistant',
    content: [{ type: 'text', text: 'Delegating to a subagent.' }],
    tool_calls: [{ id, function: { name: 'Agent', arguments: JSON.stringify(args) } }],
  });
}

function toolUseChunkFromLine(line: string): Extract<StreamChunk, { type: 'tool_use' }> {
  const event = parseKimiStreamLine(line);
  expect(event).not.toBeNull();
  const chunks = mapKimiEventToChunks(event!, createKimiStreamState());
  const toolUse = chunks.find((c) => c.type === 'tool_use');
  expect(toolUse).toBeDefined();
  return toolUse as Extract<StreamChunk, { type: 'tool_use' }>;
}

describe('Kimi subagent (Agent tool) → swarm pipeline', () => {
  it('keeps subagent tool names canonical through the humanizer', () => {
    expect(humanizeKimiTool('Agent')).toBe('Agent');
    expect(humanizeKimiTool('Task')).toBe('Task');
    // Regression: would otherwise humanize to "Task output" and break linking.
    expect(humanizeKimiTool('TaskOutput')).toBe(TOOL_AGENT_OUTPUT);
  });

  it('maps a kimi Agent tool_call to a subagent-routable tool_use chunk', () => {
    const chunk = toolUseChunkFromLine(
      kimiAgentToolUseLine({ description: 'Build API', prompt: 'Implement the endpoints', subagent_type: 'coder' }),
    );

    expect(chunk.name).toBe('Agent');
    expect(isSubagentToolName(chunk.name)).toBe(true);
    expect(chunk.input.description).toBe('Build API');
    expect(chunk.input.subagent_type).toBe('coder');
  });

  it('surfaces a foreground kimi Agent in the swarm overview', () => {
    const manager = new SubagentManager(() => {});
    const parentEl = createMockEl('div');

    const chunk = toolUseChunkFromLine(
      kimiAgentToolUseLine({
        description: 'Refactor module',
        prompt: 'Split the file',
        subagent_type: 'coder',
        run_in_background: false,
      }),
    );

    manager.handleTaskToolUse(chunk.id, chunk.input, parentEl);

    const agents = manager.getAllSubagents();
    expect(agents).toHaveLength(1);
    expect(agents[0].description).toBe('Refactor module');

    manager.finalizeSyncSubagent(chunk.id, 'Done: split into 3 files', false);
    expect(manager.getSubagentById(chunk.id)?.status).toBe('completed');
  });

  it('tracks a background kimi Agent and parses its agent_id', () => {
    const manager = new SubagentManager(() => {});
    const parentEl = createMockEl('div');

    const chunk = toolUseChunkFromLine(
      kimiAgentToolUseLine({
        description: 'Long crawl',
        prompt: 'Index the repo',
        subagent_type: 'explore',
        run_in_background: true,
      }),
    );

    manager.handleTaskToolUse(chunk.id, chunk.input, parentEl);
    expect(manager.getSubagentById(chunk.id)?.asyncStatus).toBe('pending');

    // Exact background-launch result text emitted by kimi-cli's Agent tool.
    const launchText = [
      'task_id: t_abc123',
      'kind: agent',
      'status: running_background',
      'description: Long crawl',
      'agent_id: a1b2c3d4',
      'actual_subagent_type: explore',
      'automatic_notification: true',
    ].join('\n');

    manager.handleTaskToolResult(chunk.id, launchText, false, undefined);

    const info = manager.getSubagentById(chunk.id);
    expect(info?.asyncStatus).toBe('running');
    expect(info?.agentId).toBe('a1b2c3d4');
  });
});
