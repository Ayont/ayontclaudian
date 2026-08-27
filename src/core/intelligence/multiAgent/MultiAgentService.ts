import type { ProviderId } from '../../types/provider';
import {
  type MissionAgentState,
  type MissionEvent,
  type MissionState,
  MissionStateStorage,
  type MissionStatus,
  type MissionSynthesisState,
} from './MissionStateStorage';

export interface SpecialistAgent {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model?: string;
  /**
   * Preferred provider for this agent (e.g. 'codex', 'claude', 'grok'). When
   * unset, the agent runs on the mission's default (active) provider.
   */
  providerId?: ProviderId;
  icon?: string;
  color?: string;
}

export interface MultiAgentTask {
  id: string;
  prompt: string;
  agents: string[];
  /**
   * Per-agent instructions produced by the master prompter. When an agent has an
   * entry here it receives THAT prompt instead of the shared mission text, which
   * is what turns a "everyone answers the same question" fan-out into a real
   * division of labour. Agents without an entry fall back to {@link prompt}.
   */
  promptByAgent?: Record<string, string>;
}

export interface AgentResult {
  agentId: string;
  output: string;
}

export type AgentStatus = 'pending' | 'running' | 'done' | 'error';

export interface AgentProgress {
  agentId: string;
  status: AgentStatus;
  output?: string;
  progress: number;
  /** Rough token estimate of the agent's output so far. */
  tokens?: number;
  /** Wall-clock duration once the agent finishes. */
  durationMs?: number;
  /** Provider id the agent is currently running on (may change after failover). */
  providerId?: ProviderId;
  /** True when this slot's result was produced by a failover replacement. */
  failedOver?: boolean;
}

export interface MultiAgentProgress {
  taskId: string;
  agents: AgentProgress[];
  overall: number;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export type ProgressCallback = (progress: MultiAgentProgress) => void;
export type AgentChunkCallback = (agentId: string, chunk: string) => void;

export interface AgentExecutor {
  execute: (agent: SpecialistAgent, prompt: string, onChunk: AgentChunkCallback) => Promise<string>;
  /**
   * Provider-aware execution. When present, the service routes each agent to
   * its resolved provider via this method instead of {@link execute}. Falls
   * back to {@link execute} when omitted (legacy single-provider behavior).
   */
  executeWithProvider?: (
    agent: SpecialistAgent,
    prompt: string,
    providerId: ProviderId | undefined,
    model: string | undefined,
    onChunk: AgentChunkCallback,
  ) => Promise<string>;
  /**
   * Classifies an error as a rate-limit / transient provider error. When an
   * error is a rate-limit, the service marks that provider as unavailable for
   * the rest of the mission and prefers failover targets on other providers.
   * When omitted, failover is still attempted but providers are not blacklisted.
   */
  isRateLimitError?: (error: unknown) => boolean;
}

// ── Mission orchestration (specialists + synthesis) ──────────────────────────

export type MissionPhase = 'pending' | 'running' | 'synthesizing' | 'completed' | 'error';

export interface SynthesisProgress {
  status: AgentStatus;
  output: string;
}

/**
 * A single rate-limit failover hop: one agent's context was transferred to a
 * different agent running on a different provider after a rate-limit / error.
 */
export interface FailoverEntry {
  fromAgentId: string;
  toAgentId: string;
  fromProviderId?: ProviderId;
  toProviderId?: ProviderId;
  reason: string;
  /** Size of the partial output transferred as context (chars). */
  transferredChars: number;
  attempt: number;
  ts: number;
}

export interface MissionProgress {
  taskId: string;
  agents: AgentProgress[];
  synthesis?: SynthesisProgress;
  overall: number;
  status: MissionPhase;
  /** Chronological log of rate-limit failovers, for UI surfacing. */
  failoverLog?: FailoverEntry[];
}

export type MissionProgressCallback = (progress: MissionProgress) => void;

export interface SynthesisContribution {
  agent: SpecialistAgent;
  output: string;
}

export interface Synthesizer {
  synthesize: (
    prompt: string,
    contributions: SynthesisContribution[],
    onChunk: (chunk: string) => void,
  ) => Promise<string>;
}

export interface MissionOutcome {
  results: AgentResult[];
  synthesis: string;
}

export interface MissionRunOptions {
  /** Optional persistent storage for crash recovery and resume. */
  storage?: MissionStateStorage;
  /** Optional callback for mission timeline events. */
  onEvent?: (event: MissionEvent) => void;
  /** Default provider used when an agent has no preferred provider. */
  defaultProviderId?: ProviderId;
  /**
   * Resolves the effective provider for an agent (e.g. preferred provider when
   * enabled, otherwise the active provider). When omitted, the service uses
   * `agent.providerId ?? defaultProviderId`.
   */
  resolveAgentProviderId?: (agent: SpecialistAgent) => ProviderId | undefined;
  /** Maximum failover hops per agent before giving up. Defaults to 3. */
  maxFailovers?: number;
  /**
   * Providers ordered by remaining capacity, best first. When supplied, failover
   * picks the replacement whose provider has the most room instead of taking the
   * first different-provider agent it happens to find.
   */
  rankProviders?: () => ProviderId[];
  /** Called when a provider refuses work, so capacity tracking can cool it down. */
  onProviderRateLimited?: (providerId: ProviderId) => void;
}

/** Default failover attempts per agent when `maxFailovers` is not supplied. */
export const DEFAULT_MAX_FAILOVERS = 3;

/** Rough token estimate (~4 chars/token) for live metrics. Pure. */
export function estimateTokens(text: string): number {
  return Math.ceil((text ?? '').length / 4);
}

/** The instruction an agent actually receives: its own, or the shared mission text. */
export function resolveAgentPrompt(task: MultiAgentTask, agentId: string): string {
  const own = task.promptByAgent?.[agentId]?.trim();
  return own ? own : task.prompt;
}

/**
 * Builds a synthesis prompt that explicitly asks the coordinator to resolve
 * conflicts, de-duplicate contributions, cite specialists, and produce a
 * concise actionable answer.
 */
export function buildSynthesisPrompt(
  taskPrompt: string,
  contributions: { agent: { name: string; role: string }; output: string }[],
): string {
  const sections = contributions
    .map((c) => `### ${c.agent.name} (${c.agent.role})\n${c.output}`)
    .join('\n\n');

  return (
    'You are the lead coordinator of a team of specialist agents. They each answered the ' +
    'SAME task independently. Synthesize their contributions into ONE coherent, ' +
    'de-duplicated, actionable answer. Resolve conflicts between specialists, keep the ' +
    'strongest insights, and cite which specialist contributed each key point. Be concise.\n\n' +
    `## Task\n${taskPrompt}\n\n## Specialist contributions\n${sections}\n\n## Final synthesized answer:`
  );
}

/**
 * Builds the continuation prompt handed to a failover replacement. The
 * replacement receives the original task plus the partial output the failed
 * agent produced before hitting the rate limit, and is asked to continue
 * without repeating prior work. Pure.
 */
export function buildFailoverTransferPrompt(
  taskPrompt: string,
  failedAgentName: string,
  partialOutput: string,
  replacementName: string,
): string {
  const trimmed = partialOutput.trim();
  const partialSection = trimmed
    ? `\n\n## Partial work from ${failedAgentName} (continue from here)\n${trimmed}\n`
    : '';
  return (
    `${taskPrompt}${partialSection}\n\n## Instruction\n` +
    `A previous specialist (${failedAgentName}) was working on this task but hit a provider ` +
    `rate limit. Continue from where they left off — do not repeat their work, build on it, ` +
    `and complete the task. Respond as ${replacementName}.`
  );
}

/** Heuristic: true when an error message mentions rate-limiting / quotas. */
export function isRateLimitErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('rate limit') ||
    lower.includes('rate-limit') ||
    lower.includes('ratelimit') ||
    lower.includes('too many requests') ||
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('overloaded') ||
    lower.includes('capacity')
  );
}

export class MultiAgentService {
  private agents = new Map<string, SpecialistAgent>();
  private readonly activeMissionIds = new Set<string>();

  registerAgent(agent: SpecialistAgent): void {
    this.agents.set(agent.id, agent);
  }

  listAgents(): SpecialistAgent[] {
    return Array.from(this.agents.values());
  }

  getAgent(id: string): SpecialistAgent | undefined {
    return this.agents.get(id);
  }

  isMissionActive(taskId: string): boolean {
    return this.activeMissionIds.has(taskId);
  }

  async runTask(
    task: MultiAgentTask,
    executor: AgentExecutor,
    onProgress?: ProgressCallback,
  ): Promise<AgentResult[]> {
    const progress: MultiAgentProgress = {
      taskId: task.id,
      status: 'running',
      overall: 0,
      agents: task.agents.map((agentId) => ({
        agentId,
        status: 'pending',
        progress: 0,
      })),
    };

    const emit = (): void => {
      onProgress?.(progress);
    };

    emit();

    const agentPromises = task.agents.map(async (agentId, index) => {
      const agent = this.agents.get(agentId);
      const agentProgress = progress.agents[index];
      if (!agent || !agentProgress) {
        if (agentProgress) {
          agentProgress.status = 'error';
          agentProgress.progress = 100;
          emit();
        }
        return { agentId, output: '' };
      }

      agentProgress.status = 'running';
      agentProgress.progress = 10;
      emit();

      try {
        const output = await executor.execute(agent, task.prompt, (id, chunk) => {
          if (id !== agentId) return;
          agentProgress.output = (agentProgress.output ?? '') + chunk;
          agentProgress.progress = Math.min(90, agentProgress.progress + 2);
          emit();
        });

        agentProgress.status = 'done';
        agentProgress.progress = 100;
        agentProgress.output = output.slice(0, 300);
        emit();

        return { agentId, output };
      } catch (error) {
        agentProgress.status = 'error';
        agentProgress.progress = 100;
        agentProgress.output = error instanceof Error ? error.message : String(error);
        emit();
        return { agentId, output: agentProgress.output };
      }
    });

    const settled = await Promise.allSettled(agentPromises);
    const results: AgentResult[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }

    const doneCount = progress.agents.filter((a) => a.status === 'done').length;
    const errorCount = progress.agents.filter((a) => a.status === 'error').length;
    progress.overall = 100;
    progress.status = errorCount > 0 && doneCount === 0 ? 'error' : 'completed';
    emit();

    return results;
  }

  /**
   * Runs specialists in parallel (with live per-agent token + duration metrics),
   * then an optional synthesis pass that combines their outputs into one final
   * answer. Reports a richer {@link MissionProgress} so the UI can visualize both
   * the working phase and the synthesis phase.
   *
   * When an agent hits a rate limit or error, its partial context is transferred
   * to the next available agent running on a different provider (rate-limit
   * failover). Each hop is recorded in `progress.failoverLog`.
   *
   * When `options.storage` is provided, mission state is persisted after every
   * progress update and on completion, enabling {@link resumeMission} after a
   * crash.
   */
  async runMission(
    task: MultiAgentTask,
    executor: AgentExecutor,
    synthesizer?: Synthesizer,
    onProgress?: MissionProgressCallback,
    now: () => number = () => Date.now(),
    options: MissionRunOptions = {},
  ): Promise<MissionOutcome> {
    return this.withActiveMission(task.id, () => this.runMissionInternal(
      task,
      executor,
      synthesizer,
      onProgress,
      now,
      options,
    ));
  }

  private async runMissionInternal(
    task: MultiAgentTask,
    executor: AgentExecutor,
    synthesizer?: Synthesizer,
    onProgress?: MissionProgressCallback,
    now: () => number = () => Date.now(),
    options: MissionRunOptions = {},
  ): Promise<MissionOutcome> {
    const progress: MissionProgress = {
      taskId: task.id,
      status: 'running',
      overall: 0,
      agents: task.agents.map((agentId) => ({ agentId, status: 'pending', progress: 0, tokens: 0 })),
      synthesis: synthesizer ? { status: 'pending', output: '' } : undefined,
      failoverLog: [],
    };

    const createdAt = now();
    const rateLimitedProviders = new Set<ProviderId>();

    const emitEvent = (event: MissionEvent): void => {
      options.onEvent?.(event);
      void options.storage?.appendEvent(task.id, event).catch(() => undefined);
    };

    const persist = (completedAt?: number): void => {
      void options.storage?.saveMission(
        this.buildMissionState(task, progress, createdAt, now(), completedAt),
      ).catch(() => undefined);
    };

    const recomputeOverall = (): void => {
      // Specialists contribute up to 80% of the bar; synthesis the final 20%.
      const agentAvg = progress.agents.length
        ? progress.agents.reduce((sum, a) => sum + a.progress, 0) / progress.agents.length
        : 100;
      const specialistShare = (agentAvg / 100) * (synthesizer ? 80 : 100);
      const synthShare = synthesizer ? ((progress.synthesis?.status === 'done' ? 100 : 0) / 100) * 20 : 0;
      progress.overall = Math.round(specialistShare + synthShare);
    };

    const emit = (completedAt?: number): void => {
      recomputeOverall();
      onProgress?.(progress);
      persist(completedAt);
    };

    const resolveProvider = (agent: SpecialistAgent): ProviderId | undefined =>
      options.resolveAgentProviderId?.(agent) ?? agent.providerId ?? options.defaultProviderId;

    emitEvent({ ts: createdAt, type: 'started', message: 'Mission started' });
    emit();

    const runOne = async (agentId: string, index: number): Promise<AgentResult> => {
      const initialAgent = this.agents.get(agentId);
      const ap = progress.agents[index];
      if (!initialAgent || !ap) {
        if (ap) {
          ap.status = 'error';
          ap.progress = 100;
          emit();
        }
        return { agentId, output: '' };
      }

      const start = now();
      ap.status = 'running';
      ap.progress = 10;
      emitEvent({ ts: start, type: 'agent-started', agentId, message: `Agent ${initialAgent.name} started` });
      emit();

      const result = await this.runAgentWithFailover({
        agentId,
        initialAgent,
        taskPrompt: resolveAgentPrompt(task, agentId),
        executor,
        ap,
        allSlots: progress.agents,
        rateLimitedProviders,
        resolveProvider,
        maxFailovers: options.maxFailovers ?? DEFAULT_MAX_FAILOVERS,
        emit,
        emitEvent,
        now,
        failoverLog: progress.failoverLog!,
        rankProviders: options.rankProviders,
        onProviderRateLimited: options.onProviderRateLimited,
      });

      if (result.status === 'done') {
        emitEvent({ ts: now(), type: 'agent-done', agentId, message: `Agent ${initialAgent.name} finished` });
      } else {
        emitEvent({ ts: now(), type: 'agent-error', agentId, message: `Agent ${initialAgent.name} failed: ${result.output}` });
      }
      emit();
      return { agentId, output: result.output };
    };

    const settled = await Promise.allSettled(task.agents.map((id, i) => runOne(id, i)));
    const results: AgentResult[] = settled
      .filter((s): s is PromiseFulfilledResult<AgentResult> => s.status === 'fulfilled')
      .map((s) => s.value);

    const doneCount = progress.agents.filter((a) => a.status === 'done').length;
    const errorCount = progress.agents.filter((a) => a.status === 'error').length;

    let synthesis = '';
    let synthesisFailure: Error | null = null;
    if (synthesizer && doneCount > 0) {
      progress.status = 'synthesizing';
      if (progress.synthesis) progress.synthesis.status = 'running';
      emitEvent({ ts: now(), type: 'synthesis-started', message: 'Synthesis started' });
      emit();

      const contributions: SynthesisContribution[] = results
        .map((r) => ({ agent: this.agents.get(r.agentId), output: r.output }))
        .filter((c): c is SynthesisContribution => Boolean(c.agent) && c.output.length > 0);

      try {
        synthesis = await synthesizer.synthesize(task.prompt, contributions, (chunk) => {
          if (progress.synthesis) {
            progress.synthesis.output += chunk;
            emit();
          }
        });
        if (progress.synthesis) {
          progress.synthesis.status = 'done';
          progress.synthesis.output = synthesis;
        }
        emitEvent({ ts: now(), type: 'synthesis-done', message: 'Synthesis finished' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        synthesisFailure = error instanceof Error ? error : new Error(message);
        if (progress.synthesis) {
          progress.synthesis.status = 'error';
          progress.synthesis.output = message;
        }
        emitEvent({ ts: now(), type: 'synthesis-error', message: `Synthesis failed: ${message}` });
      }
    }

    progress.status = synthesisFailure !== null || (errorCount > 0 && doneCount === 0)
      ? 'error'
      : 'completed';
    progress.overall = 100;
    const finishedAt = now();
    emitEvent({ ts: finishedAt, type: progress.status === 'error' ? 'error' : 'completed', message: `Mission ${progress.status}` });
    emit(progress.status === 'completed' ? finishedAt : undefined);
    await options.storage?.flushMission?.(task.id);

    if (synthesisFailure) throw synthesisFailure;

    return { results, synthesis };
  }

  /**
   * Resumes a persisted mission. Already-done agents keep their stored output;
   * pending and errored agents are re-run. Synthesis is re-run when at least
   * one agent succeeds. Rate-limit failover applies to re-run agents. State and
   * events continue to be persisted to the same storage key.
   */
  async resumeMission(
    state: MissionState,
    executor: AgentExecutor,
    synthesizer?: Synthesizer,
    onProgress?: MissionProgressCallback,
    now: () => number = () => Date.now(),
    options: MissionRunOptions = {},
  ): Promise<MissionOutcome> {
    return this.withActiveMission(state.taskId, () => this.resumeMissionInternal(
      state,
      executor,
      synthesizer,
      onProgress,
      now,
      options,
    ));
  }

  private async resumeMissionInternal(
    state: MissionState,
    executor: AgentExecutor,
    synthesizer?: Synthesizer,
    onProgress?: MissionProgressCallback,
    now: () => number = () => Date.now(),
    options: MissionRunOptions = {},
  ): Promise<MissionOutcome> {
    const task: MultiAgentTask = {
      id: state.taskId,
      prompt: state.prompt,
      agents: state.agentIds,
      promptByAgent: state.promptByAgent,
    };

    const progress: MissionProgress = {
      taskId: state.taskId,
      status: 'running',
      overall: 0,
      agents: state.agents.map((a) => ({
        agentId: a.agentId,
        status: a.status,
        progress: a.progress,
        output: a.output,
        tokens: a.tokens,
        durationMs: a.durationMs,
      })),
      synthesis: synthesizer
        ? { status: state.synthesis?.status ?? 'pending', output: state.synthesis?.output ?? '' }
        : undefined,
      failoverLog: [],
    };

    const rateLimitedProviders = new Set<ProviderId>();

    const emitEvent = (event: MissionEvent): void => {
      options.onEvent?.(event);
      void options.storage?.appendEvent(state.taskId, event).catch(() => undefined);
    };

    const persist = (completedAt?: number): void => {
      void options.storage?.saveMission(
        this.buildMissionState(task, progress, state.createdAt, now(), completedAt),
      ).catch(() => undefined);
    };

    const recomputeOverall = (): void => {
      const agentAvg = progress.agents.length
        ? progress.agents.reduce((sum, a) => sum + a.progress, 0) / progress.agents.length
        : 100;
      const specialistShare = (agentAvg / 100) * (synthesizer ? 80 : 100);
      const synthShare = synthesizer ? ((progress.synthesis?.status === 'done' ? 100 : 0) / 100) * 20 : 0;
      progress.overall = Math.round(specialistShare + synthShare);
    };

    const emit = (completedAt?: number): void => {
      recomputeOverall();
      onProgress?.(progress);
      persist(completedAt);
    };

    const resolveProvider = (agent: SpecialistAgent): ProviderId | undefined =>
      options.resolveAgentProviderId?.(agent) ?? agent.providerId ?? options.defaultProviderId;

    emitEvent({ ts: now(), type: 'resumed', message: 'Mission resumed' });
    emit();

    const results: AgentResult[] = [];

    for (let index = 0; index < task.agents.length; index++) {
      const agentId = task.agents[index];
      const ap = progress.agents[index];
      if (!ap) continue;

      if (ap.status === 'done') {
        results.push({ agentId, output: ap.output ?? '' });
        continue;
      }

      const initialAgent = this.agents.get(agentId);
      if (!initialAgent) {
        ap.status = 'error';
        ap.progress = 100;
        emit();
        results.push({ agentId, output: ap.output ?? '' });
        continue;
      }

      const start = now();
      ap.status = 'running';
      ap.progress = 10;
      emitEvent({ ts: start, type: 'agent-started', agentId, message: `Agent ${initialAgent.name} resumed` });
      emit();

      const result = await this.runAgentWithFailover({
        agentId,
        initialAgent,
        taskPrompt: resolveAgentPrompt(task, agentId),
        executor,
        ap,
        allSlots: progress.agents,
        rateLimitedProviders,
        resolveProvider,
        maxFailovers: options.maxFailovers ?? DEFAULT_MAX_FAILOVERS,
        emit,
        emitEvent,
        now,
        failoverLog: progress.failoverLog!,
        rankProviders: options.rankProviders,
        onProviderRateLimited: options.onProviderRateLimited,
      });

      if (result.status === 'done') {
        emitEvent({ ts: now(), type: 'agent-done', agentId, message: `Agent ${initialAgent.name} finished` });
      } else {
        emitEvent({ ts: now(), type: 'agent-error', agentId, message: `Agent ${initialAgent.name} failed: ${result.output}` });
      }
      emit();
      results.push({ agentId, output: result.output });
    }

    const doneCount = progress.agents.filter((a) => a.status === 'done').length;
    const errorCount = progress.agents.filter((a) => a.status === 'error').length;

    let synthesis = state.synthesis?.output ?? '';
    let synthesisFailure: Error | null = null;
    if (synthesizer && doneCount > 0) {
      progress.status = 'synthesizing';
      if (progress.synthesis) progress.synthesis.status = 'running';
      emitEvent({ ts: now(), type: 'synthesis-started', message: 'Synthesis resumed' });
      emit();

      const contributions: SynthesisContribution[] = results
        .map((r) => ({ agent: this.agents.get(r.agentId), output: r.output }))
        .filter((c): c is SynthesisContribution => Boolean(c.agent) && c.output.length > 0);

      try {
        synthesis = await synthesizer.synthesize(task.prompt, contributions, (chunk) => {
          if (progress.synthesis) {
            progress.synthesis.output += chunk;
            emit();
          }
        });
        if (progress.synthesis) {
          progress.synthesis.status = 'done';
          progress.synthesis.output = synthesis;
        }
        emitEvent({ ts: now(), type: 'synthesis-done', message: 'Synthesis finished' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        synthesisFailure = error instanceof Error ? error : new Error(message);
        if (progress.synthesis) {
          progress.synthesis.status = 'error';
          progress.synthesis.output = message;
        }
        emitEvent({ ts: now(), type: 'synthesis-error', message: `Synthesis failed: ${message}` });
      }
    }

    progress.status = synthesisFailure !== null || (errorCount > 0 && doneCount === 0)
      ? 'error'
      : 'completed';
    progress.overall = 100;
    const finishedAt = now();
    emitEvent({ ts: finishedAt, type: progress.status === 'error' ? 'error' : 'completed', message: `Mission ${progress.status}` });
    emit(progress.status === 'completed' ? finishedAt : undefined);
    await options.storage?.flushMission?.(state.taskId);

    if (synthesisFailure) throw synthesisFailure;

    return { results, synthesis };
  }

  /**
   * Runs a single agent slot with rate-limit failover. On each provider error,
   * the partial output is transferred to the next available agent on a
   * different (non-rate-limited) provider, up to `maxFailovers` hops. The
   * result is attributed to the original slot (`agentId`).
   */
  private async runAgentWithFailover(params: {
    agentId: string;
    initialAgent: SpecialistAgent;
    taskPrompt: string;
    executor: AgentExecutor;
    ap: AgentProgress;
    allSlots: AgentProgress[];
    rateLimitedProviders: Set<ProviderId>;
    resolveProvider: (agent: SpecialistAgent) => ProviderId | undefined;
    maxFailovers: number;
    emit: () => void;
    emitEvent: (event: MissionEvent) => void;
    now: () => number;
    failoverLog: FailoverEntry[];
    rankProviders?: () => ProviderId[];
    onProviderRateLimited?: (providerId: ProviderId) => void;
  }): Promise<{ status: AgentStatus; output: string }> {
    const {
      agentId,
      initialAgent,
      taskPrompt,
      executor,
      ap,
      allSlots,
      rateLimitedProviders,
      resolveProvider,
      maxFailovers,
      emit,
      emitEvent,
      now,
      failoverLog,
      rankProviders,
      onProviderRateLimited,
    } = params;

    const start = now();
    let currentAgent = initialAgent;
    let currentPrompt = taskPrompt;
    let attempt = 0;

    const executeWithResolvedProvider = async (
      agent: SpecialistAgent,
      prompt: string,
      onChunk: AgentChunkCallback,
    ): Promise<string> => {
      const providerId = resolveProvider(agent);
      ap.providerId = providerId;
      if (executor.executeWithProvider) {
        return executor.executeWithProvider(agent, prompt, providerId, agent.model, onChunk);
      }
      return executor.execute(agent, prompt, onChunk);
    };

    while (true) {
      try {
        const output = await executeWithResolvedProvider(currentAgent, currentPrompt, (id, chunk) => {
          if (id !== currentAgent.id) return;
          ap.output = (ap.output ?? '') + chunk;
          ap.tokens = estimateTokens(ap.output);
          ap.progress = Math.min(90, ap.progress + 2);
          emit();
        });

        ap.status = 'done';
        ap.progress = 100;
        ap.output = output;
        ap.tokens = estimateTokens(output);
        ap.durationMs = now() - start;
        if (currentAgent.id !== agentId) {
          ap.failedOver = true;
        }
        return { status: 'done', output };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const partialOutput = ap.output ?? '';
        const failedProviderId = resolveProvider(currentAgent);

        if (failedProviderId && executor.isRateLimitError?.(error)) {
          rateLimitedProviders.add(failedProviderId);
          onProviderRateLimited?.(failedProviderId);
        }

        if (attempt >= maxFailovers) {
          ap.status = 'error';
          ap.progress = 100;
          ap.durationMs = now() - start;
          ap.output = message;
          return { status: 'error', output: message };
        }

        const replacement = this.findFailoverReplacement(
          currentAgent.id,
          failedProviderId,
          rateLimitedProviders,
          ap,
          allSlots,
          resolveProvider,
          rankProviders?.(),
        );

        if (!replacement) {
          ap.status = 'error';
          ap.progress = 100;
          ap.durationMs = now() - start;
          ap.output = message;
          return { status: 'error', output: message };
        }

        const toProviderId = resolveProvider(replacement);
        const transferPrompt = buildFailoverTransferPrompt(
          taskPrompt,
          currentAgent.name,
          partialOutput,
          replacement.name,
        );

        failoverLog.push({
          fromAgentId: currentAgent.id,
          toAgentId: replacement.id,
          fromProviderId: failedProviderId,
          toProviderId,
          reason: message,
          transferredChars: partialOutput.length,
          attempt: attempt + 1,
          ts: now(),
        });

        emitEvent({
          ts: now(),
          type: 'failover',
          agentId,
          message: `${currentAgent.name} failed over to ${replacement.name} (${toProviderId ?? 'default'})`,
        });

        // Reset visible output; the replacement streams fresh into the slot.
        ap.output = '';
        ap.providerId = toProviderId;
        ap.progress = Math.max(10, ap.progress);
        emit();

        currentAgent = replacement;
        currentPrompt = transferPrompt;
        attempt += 1;
      }
    }
  }

  /**
   * Finds a failover replacement: a registered agent on a different, non-rate-
   * limited provider that is not currently running in the mission. Bench agents
   * (not in the task) are preferred; already-done task agents are also eligible.
   *
   * When `providerRanking` is supplied (capacity, best first), candidates are
   * ordered by their provider's remaining headroom — so failover lands on the
   * provider with the most room instead of an arbitrary different one.
   */
  private findFailoverReplacement(
    failedAgentId: string,
    failedProviderId: ProviderId | undefined,
    rateLimitedProviders: Set<ProviderId>,
    currentSlot: AgentProgress,
    allSlots: AgentProgress[],
    resolveProvider: (agent: SpecialistAgent) => ProviderId | undefined,
    providerRanking?: ProviderId[],
  ): SpecialistAgent | undefined {
    const runningIds = new Set(
      allSlots.filter((s) => s.status === 'running' && s.agentId !== currentSlot.agentId).map((s) => s.agentId),
    );

    const candidates: { agent: SpecialistAgent; rank: number }[] = [];
    for (const candidate of this.listAgents()) {
      if (candidate.id === failedAgentId) continue;
      if (runningIds.has(candidate.id)) continue;
      const cp = resolveProvider(candidate);
      if (!cp || cp === failedProviderId) continue;
      if (rateLimitedProviders.has(cp)) continue;

      const rankIndex = providerRanking?.indexOf(cp) ?? -1;
      candidates.push({ agent: candidate, rank: rankIndex === -1 ? Number.MAX_SAFE_INTEGER : rankIndex });
    }

    if (candidates.length === 0) return undefined;
    candidates.sort((a, b) => a.rank - b.rank);
    return candidates[0].agent;
  }

  private buildMissionState(
    task: MultiAgentTask,
    progress: MissionProgress,
    createdAt: number,
    updatedAt: number,
    completedAt?: number,
  ): MissionState {
    const agents: MissionAgentState[] = progress.agents.map((a) => ({
      agentId: a.agentId,
      status: a.status,
      progress: a.progress,
      output: a.output,
      tokens: a.tokens,
      durationMs: a.durationMs,
    }));

    const synthesis: MissionSynthesisState | undefined = progress.synthesis
      ? {
          status: progress.synthesis.status,
          output: progress.synthesis.output,
          error: progress.synthesis.status === 'error' ? progress.synthesis.output : undefined,
        }
      : undefined;

    return {
      taskId: task.id,
      prompt: task.prompt,
      agentIds: task.agents,
      promptByAgent: task.promptByAgent,
      status: progress.status as MissionStatus,
      overall: progress.overall,
      agents,
      synthesis,
      createdAt,
      updatedAt,
      completedAt,
    };
  }

  private async withActiveMission<T>(taskId: string, run: () => Promise<T>): Promise<T> {
    if (this.activeMissionIds.has(taskId)) {
      throw new Error(`Mission ${taskId} is already active.`);
    }
    this.activeMissionIds.add(taskId);
    try {
      return await run();
    } finally {
      this.activeMissionIds.delete(taskId);
    }
  }
}

export { MissionStateStorage };
