/**
 * Custom provider teams for multi-agent missions.
 *
 * A team member is Name + Rolle + Modell — the provider is derived from the
 * model (same routing as model comparison), so "Codex + Fable + Opus" is just
 * three members whose models live on different providers. Members become
 * regular {@link SpecialistAgent}s and run through the existing mission
 * pipeline (parallel execution, failover, synthesis) unchanged.
 */
import { getProviderForModel } from '../../providers/modelRouting';
import type { ProviderUIOption } from '../../providers/types';
import { AUTO_MODEL_VALUE } from '../../routing/modelRouterRules';
import type { SpecialistAgent } from './MultiAgentService';

export interface TeamMemberConfig {
  /** Stable slot id (member-1, member-2, …). */
  id: string;
  /** Display name shown on the mission card (e.g. "Codex"). */
  name: string;
  /** Free-form role fed into the member's system prompt. */
  role: string;
  /** Model id from the aggregated provider model options. */
  model: string;
}

/** Hard cap — more members than this mostly burns tokens, not insight. */
export const MAX_TEAM_MEMBERS = 6;

/** Registry id prefix so custom members never collide with built-in agents. */
export const TEAM_AGENT_ID_PREFIX = 'custom-team-';

function buildMemberSystemPrompt(name: string, role: string): string {
  return [
    `You are ${name}, a specialist agent on a small team. Your role: ${role}.`,
    'Work the user request strictly from your role\'s perspective — concrete and actionable, no filler.',
    'If parts of the request fall outside your role, contribute your most useful angle instead of covering everything.',
  ].join(' ');
}

/** True when the member has everything needed to run. */
export function isCompleteTeamMember(member: TeamMemberConfig): boolean {
  return Boolean(member.name.trim() && member.model.trim());
}

/**
 * Converts configured members into runnable specialist agents. Incomplete
 * rows (missing name or model) are skipped so a half-filled editor never
 * breaks a mission launch.
 */
export function buildCustomTeamAgents(
  members: TeamMemberConfig[],
  settings: Record<string, unknown>,
): SpecialistAgent[] {
  return members
    .filter(isCompleteTeamMember)
    .slice(0, MAX_TEAM_MEMBERS)
    .map((member) => {
      const role = member.role.trim() || 'Generalist';
      return {
        id: `${TEAM_AGENT_ID_PREFIX}${member.id}`,
        name: member.name.trim(),
        role,
        systemPrompt: buildMemberSystemPrompt(member.name.trim(), role),
        model: member.model,
        providerId: getProviderForModel(member.model, settings),
        icon: 'user-round',
      };
    });
}

/** Model options a member may use (the Auto router sentinel is meaningless here). */
export function getTeamModelOptions(options: ProviderUIOption[]): ProviderUIOption[] {
  return options.filter((option) => option.value !== AUTO_MODEL_VALUE);
}

const DEFAULT_TEAM_BLUEPRINT: ReadonlyArray<{ needle: string; name: string; role: string }> = [
  { needle: 'codex', name: 'Codex', role: 'Implementation & code quality' },
  { needle: 'fable', name: 'Fable', role: 'Architecture & synthesis' },
  { needle: 'opus', name: 'Opus', role: 'Deep reasoning & review' },
];

/**
 * Suggests the "Codex · Fable · Opus" starter team by fuzzy-matching the
 * aggregated model options. Members whose model cannot be found are skipped,
 * so the suggestion degrades gracefully on setups without those providers.
 */
export function suggestDefaultTeam(options: ProviderUIOption[]): TeamMemberConfig[] {
  const usable = getTeamModelOptions(options);
  const members: TeamMemberConfig[] = [];
  for (const blueprint of DEFAULT_TEAM_BLUEPRINT) {
    const match = usable.find((option) =>
      `${option.value} ${option.label ?? ''}`.toLowerCase().includes(blueprint.needle),
    );
    if (!match) {
      continue;
    }
    members.push({
      id: `member-${members.length + 1}`,
      name: blueprint.name,
      role: blueprint.role,
      model: match.value,
    });
  }
  return members;
}

/** Creates an empty member slot with the next free id. */
export function createEmptyTeamMember(existing: TeamMemberConfig[]): TeamMemberConfig {
  let index = existing.length + 1;
  const taken = new Set(existing.map((member) => member.id));
  while (taken.has(`member-${index}`)) {
    index += 1;
  }
  return { id: `member-${index}`, name: '', role: '', model: '' };
}
