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
  icon?: string;
  color?: string;
}

export interface MultiAgentTask {
  id: string;
  prompt: string;
  agents: string[];
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
}

// ── Mission orchestration (specialists + synthesis) ──────────────────────────

export type MissionPhase = 'pending' | 'running' | 'synthesizing' | 'completed' | 'error';

export interface SynthesisProgress {
  status: AgentStatus;
  output: string;
}

export interface MissionProgress {
  taskId: string;
  agents: AgentProgress[];
  synthesis?: SynthesisProgress;
  overall: number;
  status: MissionPhase;
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
}

/** Rough token estimate (~4 chars/token) for live metrics. Pure. */
export function estimateTokens(text: string): number {
  return Math.ceil((text ?? '').length / 4);
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

export class MultiAgentService {
  private agents = new Map<string, SpecialistAgent>();

  registerAgent(agent: SpecialistAgent): void {
    this.agents.set(agent.id, agent);
  }

  listAgents(): SpecialistAgent[] {
    return Array.from(this.agents.values());
  }

  getAgent(id: string): SpecialistAgent | undefined {
    return this.agents.get(id);
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
    const progress: MissionProgress = {
      taskId: task.id,
      status: 'running',
      overall: 0,
      agents: task.agents.map((agentId) => ({ agentId, status: 'pending', progress: 0, tokens: 0 })),
      synthesis: synthesizer ? { status: 'pending', output: '' } : undefined,
    };

    const createdAt = now();

    const emitEvent = (event: MissionEvent): void => {
      options.onEvent?.(event);
      void options.storage?.appendEvent(task.id, event);
    };

    const persist = (): void => {
      void options.storage?.saveMission(this.buildMissionState(task, progress, createdAt, now()));
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

    const emit = (): void => {
      recomputeOverall();
      onProgress?.(progress);
      persist();
    };

    emitEvent({ ts: createdAt, type: 'started', message: 'Mission started' });
    emit();

    const runOne = async (agentId: string, index: number): Promise<AgentResult> => {
      const agent = this.agents.get(agentId);
      const ap = progress.agents[index];
      if (!agent || !ap) {
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
      emitEvent({ ts: start, type: 'agent-started', agentId, message: `Agent ${agent.name} started` });
      emit();

      try {
        const output = await executor.execute(agent, task.prompt, (id, chunk) => {
          if (id !== agentId) return;
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
        emitEvent({ ts: now(), type: 'agent-done', agentId, message: `Agent ${agent.name} finished` });
        emit();
        return { agentId, output };
      } catch (error) {
        ap.status = 'error';
        ap.progress = 100;
        ap.durationMs = now() - start;
        ap.output = error instanceof Error ? error.message : String(error);
        emitEvent({ ts: now(), type: 'agent-error', agentId, message: `Agent ${agent.name} failed: ${ap.output}` });
        emit();
        return { agentId, output: ap.output };
      }
    };

    const settled = await Promise.allSettled(task.agents.map((id, i) => runOne(id, i)));
    const results: AgentResult[] = settled
      .filter((s): s is PromiseFulfilledResult<AgentResult> => s.status === 'fulfilled')
      .map((s) => s.value);

    const doneCount = progress.agents.filter((a) => a.status === 'done').length;
    const errorCount = progress.agents.filter((a) => a.status === 'error').length;

    let synthesis = '';
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
        if (progress.synthesis) {
          progress.synthesis.status = 'error';
          progress.synthesis.output = message;
        }
        emitEvent({ ts: now(), type: 'synthesis-error', message: `Synthesis failed: ${message}` });
      }
    }

    progress.status = errorCount > 0 && doneCount === 0 ? 'error' : 'completed';
    progress.overall = 100;
    emitEvent({ ts: now(), type: progress.status === 'error' ? 'error' : 'completed', message: `Mission ${progress.status}` });
    emit();

    return { results, synthesis };
  }

  /**
   * Resumes a persisted mission. Already-done agents keep their stored output;
   * pending and errored agents are re-run. Synthesis is re-run when at least
   * one agent succeeds. State and events continue to be persisted to the same
   * storage key.
   */
  async resumeMission(
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
    };

    const emitEvent = (event: MissionEvent): void => {
      options.onEvent?.(event);
      void options.storage?.appendEvent(state.taskId, event);
    };

    const persist = (): void => {
      void options.storage?.saveMission(
        this.buildMissionState(task, progress, state.createdAt, now(), state.completedAt),
      );
    };

    const recomputeOverall = (): void => {
      const agentAvg = progress.agents.length
        ? progress.agents.reduce((sum, a) => sum + a.progress, 0) / progress.agents.length
        : 100;
      const specialistShare = (agentAvg / 100) * (synthesizer ? 80 : 100);
      const synthShare = synthesizer ? ((progress.synthesis?.status === 'done' ? 100 : 0) / 100) * 20 : 0;
      progress.overall = Math.round(specialistShare + synthShare);
    };

    const emit = (): void => {
      recomputeOverall();
      onProgress?.(progress);
      persist();
    };

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

      const agent = this.agents.get(agentId);
      if (!agent) {
        ap.status = 'error';
        ap.progress = 100;
        emit();
        results.push({ agentId, output: ap.output ?? '' });
        continue;
      }

      const start = now();
      ap.status = 'running';
      ap.progress = 10;
      emitEvent({ ts: start, type: 'agent-started', agentId, message: `Agent ${agent.name} resumed` });
      emit();

      try {
        const output = await executor.execute(agent, task.prompt, (id, chunk) => {
          if (id !== agentId) return;
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
        emitEvent({ ts: now(), type: 'agent-done', agentId, message: `Agent ${agent.name} finished` });
        emit();
        results.push({ agentId, output });
      } catch (error) {
        ap.status = 'error';
        ap.progress = 100;
        ap.durationMs = now() - start;
        ap.output = error instanceof Error ? error.message : String(error);
        emitEvent({ ts: now(), type: 'agent-error', agentId, message: `Agent ${agent.name} failed: ${ap.output}` });
        emit();
        results.push({ agentId, output: ap.output });
      }
    }

    const doneCount = progress.agents.filter((a) => a.status === 'done').length;
    const errorCount = progress.agents.filter((a) => a.status === 'error').length;

    let synthesis = state.synthesis?.output ?? '';
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
        if (progress.synthesis) {
          progress.synthesis.status = 'error';
          progress.synthesis.output = message;
        }
        emitEvent({ ts: now(), type: 'synthesis-error', message: `Synthesis failed: ${message}` });
      }
    }

    progress.status = errorCount > 0 && doneCount === 0 ? 'error' : 'completed';
    progress.overall = 100;
    emitEvent({ ts: now(), type: progress.status === 'error' ? 'error' : 'completed', message: `Mission ${progress.status}` });
    emit();

    return { results, synthesis };
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
        }
      : undefined;

    return {
      taskId: task.id,
      prompt: task.prompt,
      agentIds: task.agents,
      status: progress.status as MissionStatus,
      overall: progress.overall,
      agents,
      synthesis,
      createdAt,
      updatedAt,
      completedAt,
    };
  }
}

export { MissionStateStorage };
