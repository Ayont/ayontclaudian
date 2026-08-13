import type { ProviderCapacity } from '../../budget/providerCapacity';
import type { ProviderId } from '../../types/provider';
import {
  buildFallbackPlan,
  buildMasterPlanPrompt,
  type MasterPlan,
  mergeDuplicateAssignments,
  parseMasterPlan,
  type RosterEntry,
  toRosterEntries,
} from './masterPlan';
import type { MissionEvent, MissionStateStorage } from './MissionStateStorage';
import type {
  AgentExecutor,
  MissionOutcome,
  MissionProgress,
  MultiAgentService,
  MultiAgentTask,
  SpecialistAgent,
  Synthesizer,
} from './MultiAgentService';
import type { ProviderCapacityService } from './ProviderCapacityService';

export type MasterMissionPhase =
  | 'planning'
  | 'dispatching'
  | 'working'
  | 'synthesizing'
  | 'completed'
  | 'error';

export interface MasterMissionProgress {
  taskId: string;
  phase: MasterMissionPhase;
  /** Live capacity snapshot — what the router saw when it assigned work. */
  capacities: ProviderCapacity[];
  plan: MasterPlan | null;
  /** Provider that produced the plan. */
  plannerProviderId: ProviderId | null;
  /** agentId → provider the subtask was dispatched to. */
  assignments: Record<string, ProviderId>;
  /** Underlying specialist progress once the mission is running. */
  mission: MissionProgress | null;
  /** Streaming text of the planning phase, for a live "master is thinking" view. */
  planningText: string;
}

export interface MasterMissionOutcome extends MissionOutcome {
  plan: MasterPlan;
  assignments: Record<string, ProviderId>;
  plannerProviderId: ProviderId | null;
}

export interface MasterPrompterDeps {
  capacity: ProviderCapacityService;
  service: MultiAgentService;
  /** Runs a raw prompt on a specific provider. Used for the planning pass. */
  runPrompt: (
    prompt: string,
    providerId: ProviderId | undefined,
    onChunk?: (chunk: string) => void,
  ) => Promise<string>;
  storage?: MissionStateStorage;
  onEvent?: (event: MissionEvent) => void;
}

export interface MasterMissionRequest {
  taskId: string;
  mission: string;
  /** Candidate specialists the master may assign work to. */
  roster: SpecialistAgent[];
  executor: AgentExecutor;
  synthesizer?: Synthesizer;
  maxFailovers?: number;
}

/**
 * The master prompter: one planning agent decomposes the mission and writes a
 * tailored prompt per specialist, then every subtask is routed to whichever
 * provider still has usage headroom.
 *
 * This replaces the previous "every specialist answers the same question on its
 * hard-coded preferred provider" model. Preferred providers are now a hint that
 * only wins when that provider actually has capacity — otherwise the router moves
 * the work to a provider that does, which is the entire point of running several
 * CLIs side by side.
 */
export class MasterPrompterService {
  constructor(private readonly deps: MasterPrompterDeps) {}

  async run(
    request: MasterMissionRequest,
    onProgress?: (progress: MasterMissionProgress) => void,
    now: () => number = () => Date.now(),
  ): Promise<MasterMissionOutcome> {
    const progress: MasterMissionProgress = {
      taskId: request.taskId,
      phase: 'planning',
      capacities: this.deps.capacity.rank(now()),
      plan: null,
      plannerProviderId: null,
      assignments: {},
      mission: null,
      planningText: '',
    };
    const emit = (): void => onProgress?.(progress);
    const emitEvent = (event: MissionEvent): void => {
      this.deps.onEvent?.(event);
      void this.deps.storage?.appendEvent(request.taskId, event);
    };

    emit();

    const roster = toRosterEntries(request.roster);
    progress.plannerProviderId = this.deps.capacity.pickBest([], now());
    emitEvent({
      ts: now(),
      type: 'started',
      message: `Master-Prompter plant auf ${progress.plannerProviderId ?? 'Standard-Provider'}`,
    });
    emit();

    const plan = await this.plan(request.mission, roster, progress, emit);
    progress.plan = plan;
    progress.phase = 'dispatching';
    emit();

    progress.assignments = this.assignProviders(plan, request.roster, now());
    emitEvent({
      ts: now(),
      type: 'started',
      message: `Plan: ${plan.subtasks.length} Teilaufgaben — ${describeAssignments(progress.assignments)}`,
    });

    const task: MultiAgentTask = {
      id: request.taskId,
      prompt: request.mission,
      agents: plan.subtasks.map((subtask) => subtask.agentId),
      promptByAgent: Object.fromEntries(
        plan.subtasks.map((subtask) => [subtask.agentId, subtask.prompt]),
      ),
    };

    progress.phase = 'working';
    emit();

    const outcome = await this.deps.service.runMission(
      task,
      request.executor,
      request.synthesizer,
      (missionProgress) => {
        progress.mission = missionProgress;
        progress.phase = missionProgress.status === 'synthesizing'
          ? 'synthesizing'
          : missionProgress.status === 'completed'
            ? 'completed'
            : missionProgress.status === 'error'
              ? 'error'
              : 'working';
        progress.capacities = this.deps.capacity.rank(now());
        emit();
      },
      now,
      {
        storage: this.deps.storage,
        onEvent: (event) => this.deps.onEvent?.(event),
        resolveAgentProviderId: (agent) => progress.assignments[agent.id],
        maxFailovers: request.maxFailovers ?? 3,
        rankProviders: () => this.deps.capacity.getAvailableProviderIds(),
        onProviderRateLimited: (providerId) => this.deps.capacity.markRateLimited(providerId),
      },
    );

    progress.phase = progress.mission?.status === 'error' ? 'error' : 'completed';
    progress.capacities = this.deps.capacity.rank(now());
    emit();

    return {
      ...outcome,
      plan,
      assignments: progress.assignments,
      plannerProviderId: progress.plannerProviderId,
    };
  }

  /** Planning pass. Any failure degrades to the fallback plan — never to no mission. */
  private async plan(
    mission: string,
    roster: RosterEntry[],
    progress: MasterMissionProgress,
    emit: () => void,
  ): Promise<MasterPlan> {
    if (roster.length === 0) {
      return { objective: mission, rationale: 'Kein Team verfügbar.', subtasks: [] };
    }

    try {
      const raw = await this.deps.runPrompt(
        buildMasterPlanPrompt(mission, roster),
        progress.plannerProviderId ?? undefined,
        (chunk) => {
          progress.planningText += chunk;
          emit();
        },
      );
      const parsed = parseMasterPlan(raw, roster);
      if (parsed) {
        return mergeDuplicateAssignments(parsed);
      }
    } catch {
      // Planning is best-effort: a dead planner must not kill the mission.
    }
    return buildFallbackPlan(mission, roster);
  }

  /**
   * Routes every subtask to a provider.
   *
   * An agent's preferred provider wins only when that provider currently has
   * capacity; otherwise the subtask goes to the best-ranked provider that is not
   * already saturated by this mission, so parallel work spreads out instead of
   * queueing behind one rate limit.
   */
  private assignProviders(
    plan: MasterPlan,
    roster: SpecialistAgent[],
    now: number,
  ): Record<string, ProviderId> {
    const available = this.deps.capacity.getAvailableProviderIds(now);
    const fallback = this.deps.capacity.distribute(plan.subtasks.length, now);
    const availableSet = new Set(available);
    const byId = new Map(roster.map((agent) => [agent.id, agent]));
    const load = new Map<ProviderId, number>();

    const assignments: Record<string, ProviderId> = {};
    plan.subtasks.forEach((subtask, index) => {
      const preferred = byId.get(subtask.agentId)?.providerId;
      const target = preferred && availableSet.has(preferred)
        ? preferred
        : pickLeastLoaded(available, load) ?? fallback[index] ?? preferred;
      if (!target) return;
      assignments[subtask.agentId] = target;
      load.set(target, (load.get(target) ?? 0) + 1);
    });
    return assignments;
  }
}

/** Least-loaded provider among the available ones, preserving capacity order on ties. */
function pickLeastLoaded(
  available: ProviderId[],
  load: Map<ProviderId, number>,
): ProviderId | null {
  let best: ProviderId | null = null;
  let bestLoad = Number.MAX_SAFE_INTEGER;
  for (const providerId of available) {
    const current = load.get(providerId) ?? 0;
    if (current < bestLoad) {
      best = providerId;
      bestLoad = current;
    }
  }
  return best;
}

function describeAssignments(assignments: Record<string, ProviderId>): string {
  const counts = new Map<ProviderId, number>();
  for (const providerId of Object.values(assignments)) {
    counts.set(providerId, (counts.get(providerId) ?? 0) + 1);
  }
  return [...counts.entries()].map(([providerId, count]) => `${providerId}×${count}`).join(', ');
}
