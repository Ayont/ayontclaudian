import type { MissionEvent, MissionState } from './MissionStateStorage';

/**
 * Formats persisted mission states and their event logs into a readable
 * markdown note. Pure function — safe to unit-test without Obsidian.
 */
export function formatMissionLogMarkdown(
  missions: MissionState[],
  eventsByMission: Map<string, MissionEvent[]>,
  now = Date.now(),
): string {
  const lines: string[] = ['# Mission Log\n'];

  for (const mission of missions) {
    lines.push(`## ${mission.taskId}`);
    lines.push(`- **Status:** ${mission.status}`);
    lines.push(`- **Prompt:** ${mission.prompt}`);
    lines.push(`- **Overall:** ${mission.overall}%`);
    lines.push(`- **Agents:** ${mission.agents.map((a) => `${a.agentId} (${a.status})`).join(', ')}`);
    if (mission.synthesis?.output) {
      const preview = mission.synthesis.output.slice(0, 200);
      const suffix = mission.synthesis.output.length > 200 ? '...' : '';
      lines.push(`- **Synthesis:** ${preview}${suffix}`);
    }
    lines.push('');

    const events = eventsByMission.get(mission.taskId) ?? [];
    if (events.length > 0) {
      lines.push('### Timeline');
      for (const event of events) {
        const agentPrefix = event.agentId ? `**${event.agentId}**: ` : '';
        const time = new Date(event.ts).toLocaleTimeString();
        lines.push(`- \`${time}\` ${agentPrefix}${event.message}`);
      }
      lines.push('');
    }
  }

  if (missions.length === 0) {
    lines.push('_No missions recorded._');
  }

  lines.push(`\n_Generated ${new Date(now).toLocaleString()}._`);
  return lines.join('\n');
}
