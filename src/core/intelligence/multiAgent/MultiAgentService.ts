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
    executor: (agent: SpecialistAgent, prompt: string) => Promise<string>,
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

    const results: AgentResult[] = [];
    for (let i = 0; i < task.agents.length; i++) {
      const agentId = task.agents[i];
      const agent = this.agents.get(agentId);
      if (!agent) {
        const p = progress.agents.find((a) => a.agentId === agentId);
        if (p) {
          p.status = 'error';
          p.progress = 100;
        }
        emit();
        continue;
      }

      const agentProgress = progress.agents.find((a) => a.agentId === agentId);
      if (agentProgress) {
        agentProgress.status = 'running';
        agentProgress.progress = 25;
      }
      emit();

      try {
        if (agentProgress) {
          agentProgress.progress = 60;
          emit();
        }

        const output = await executor(agent, task.prompt);
        results.push({ agentId, output });

        if (agentProgress) {
          agentProgress.status = 'done';
          agentProgress.progress = 100;
          agentProgress.output = output.slice(0, 240);
        }
      } catch (error) {
        if (agentProgress) {
          agentProgress.status = 'error';
          agentProgress.progress = 100;
          agentProgress.output = error instanceof Error ? error.message : String(error);
        }
      }

      progress.overall = Math.round(((i + 1) / task.agents.length) * 100);
      emit();
    }

    progress.status = progress.agents.some((a) => a.status === 'error') ? 'error' : 'completed';
    progress.overall = 100;
    emit();

    return results;
  }
}
