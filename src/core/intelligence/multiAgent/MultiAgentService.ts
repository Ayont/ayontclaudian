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
          // Slowly advance progress while streaming; cap at 90 until done.
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
}
