/**
 * Claudian - Master prompter planning
 *
 * The master prompter is the agent that turns one mission sentence into a real
 * plan: which specialists are needed, what each of them is actually asked to do,
 * and in what order. It does NOT pick providers — capacity does that (see
 * {@link ../../budget/providerCapacity}) — so the plan stays valid even when a
 * provider is rate-limited between planning and dispatch.
 *
 * Pure module: prompt construction and parsing only.
 */

import type { SpecialistAgent } from './MultiAgentService';

export interface MasterSubtask {
  id: string;
  title: string;
  /** Registered specialist id this subtask is assigned to. */
  agentId: string;
  /** The tailored instruction for that specialist — not the raw mission text. */
  prompt: string;
}

export interface MasterPlan {
  objective: string;
  rationale: string;
  subtasks: MasterSubtask[];
}

/** Keeps a runaway plan from fanning out into dozens of parallel CLI processes. */
export const MAX_PLAN_SUBTASKS = 8;

export interface RosterEntry {
  id: string;
  name: string;
  role: string;
}

export function toRosterEntries(agents: SpecialistAgent[]): RosterEntry[] {
  return agents.map((agent) => ({ id: agent.id, name: agent.name, role: agent.role }));
}

/**
 * Planning prompt. The roster is passed as data so the master can only assign work
 * to specialists that actually exist, and the output contract is a strict JSON
 * object so the result is machine-usable instead of prose we have to guess at.
 */
export function buildMasterPlanPrompt(mission: string, roster: RosterEntry[]): string {
  const rosterLines = roster
    .map((entry) => `- ${entry.id}: ${entry.name} — ${entry.role}`)
    .join('\n');

  return [
    'Du bist der Master-Prompter eines Agenten-Teams. Du führst die Aufgabe NICHT selbst aus.',
    'Deine Aufgabe: die Mission in klar abgegrenzte Teilaufgaben zerlegen und jede einem',
    'Spezialisten aus dem Roster zuweisen — mit einem eigenen, präzisen Prompt.',
    '',
    `## Mission\n${mission.trim()}`,
    '',
    `## Verfügbare Spezialisten\n${rosterLines}`,
    '',
    '## Regeln',
    `- Höchstens ${MAX_PLAN_SUBTASKS} Teilaufgaben, so wenige wie möglich.`,
    '- Teilaufgaben müssen sich inhaltlich NICHT überschneiden.',
    '- Jede "prompt" ist eine vollständige Arbeitsanweisung, die für sich allein verständlich ist.',
    '- Nutze nur "agentId"-Werte aus dem Roster.',
    '- Keine Teilaufgabe für Zusammenfassung oder Synthese — das übernimmt ein separater Schritt.',
    '',
    'Antworte ausschließlich mit JSON in genau dieser Form, ohne Text davor oder danach:',
    '{"objective": "…", "rationale": "warum diese Aufteilung", "subtasks": [{"title": "…", "agentId": "…", "prompt": "…"}]}',
  ].join('\n');
}

/**
 * Parses a master plan, dropping subtasks that name unknown specialists so a
 * hallucinated agent id cannot silently swallow part of the mission. Returns null
 * when nothing usable survives — callers then fall back to {@link buildFallbackPlan}.
 */
export function parseMasterPlan(raw: string, roster: RosterEntry[]): MasterPlan | null {
  const candidate = extractFirstJsonObject((raw ?? '').trim());
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const rawSubtasks = Array.isArray(record.subtasks) ? record.subtasks : [];
  const known = new Set(roster.map((entry) => entry.id));

  const subtasks: MasterSubtask[] = [];
  for (const entry of rawSubtasks) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const agentId = typeof item.agentId === 'string' ? item.agentId.trim() : '';
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
    if (!known.has(agentId) || !prompt) continue;

    const title = typeof item.title === 'string' && item.title.trim()
      ? item.title.trim()
      : roster.find((candidateEntry) => candidateEntry.id === agentId)?.role ?? agentId;

    subtasks.push({ id: `${agentId}-${subtasks.length + 1}`, title, agentId, prompt });
    if (subtasks.length >= MAX_PLAN_SUBTASKS) break;
  }

  if (subtasks.length === 0) return null;

  return {
    objective: typeof record.objective === 'string' ? record.objective.trim() : '',
    rationale: typeof record.rationale === 'string' ? record.rationale.trim() : '',
    subtasks,
  };
}

/**
 * Plan used when the master is unreachable or its answer is unusable: every
 * rostered specialist works the mission from its own angle. Less targeted than a
 * real plan, but the mission still runs instead of failing outright.
 */
export function buildFallbackPlan(mission: string, roster: RosterEntry[]): MasterPlan {
  const selected = roster.slice(0, MAX_PLAN_SUBTASKS);
  return {
    objective: mission.trim(),
    rationale: 'Kein Master-Plan verfügbar — jeder Spezialist bearbeitet die Mission aus seiner Rolle heraus.',
    subtasks: selected.map((entry, index) => ({
      id: `${entry.id}-${index + 1}`,
      title: entry.role,
      agentId: entry.id,
      prompt: `${mission.trim()}\n\nBearbeite diese Mission ausschließlich aus deiner Rolle als ${entry.role}.`,
    })),
  };
}

/** Duplicate agent ids collapse into one mission slot — the prompts are merged. */
export function mergeDuplicateAssignments(plan: MasterPlan): MasterPlan {
  const byAgent = new Map<string, MasterSubtask>();
  for (const subtask of plan.subtasks) {
    const existing = byAgent.get(subtask.agentId);
    if (!existing) {
      byAgent.set(subtask.agentId, subtask);
      continue;
    }
    byAgent.set(subtask.agentId, {
      ...existing,
      title: `${existing.title} + ${subtask.title}`,
      prompt: `${existing.prompt}\n\n---\n\n${subtask.prompt}`,
    });
  }
  return { ...plan, subtasks: [...byAgent.values()] };
}

/** Finds the first balanced `{…}` block, ignoring braces inside JSON strings. */
function extractFirstJsonObject(source: string): string | null {
  const start = source.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}
