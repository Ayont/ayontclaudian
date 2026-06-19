import type { VaultFileAdapter } from '../../storage/VaultFileAdapter';

export type MissionStatus = 'pending' | 'running' | 'synthesizing' | 'completed' | 'error';

export interface MissionAgentState {
  agentId: string;
  status: 'pending' | 'running' | 'done' | 'error';
  progress: number;
  output?: string;
  tokens?: number;
  durationMs?: number;
  error?: string;
}

export interface MissionSynthesisState {
  status: 'pending' | 'running' | 'done' | 'error';
  output?: string;
  error?: string;
}

export interface MissionState {
  taskId: string;
  prompt: string;
  agentIds: string[];
  status: MissionStatus;
  overall: number;
  agents: MissionAgentState[];
  synthesis?: MissionSynthesisState;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface MissionEvent {
  ts: number;
  type: 'started' | 'agent-started' | 'agent-done' | 'agent-error' | 'synthesis-started' | 'synthesis-done' | 'synthesis-error' | 'completed' | 'error' | 'resumed' | 'failover';
  agentId?: string;
  message: string;
}

/**
 * Persisted storage for multi-agent mission state and event logs.
 *
 * State is saved as JSON under `.claudian/missions/{taskId}.json`.
 * Events are appended as JSONL under `.claudian/missions/{taskId}.events.jsonl`.
 */
export class MissionStateStorage {
  private readonly basePath: string;

  constructor(
    private readonly adapter: VaultFileAdapter,
    basePath = '.claudian/missions',
  ) {
    this.basePath = basePath;
  }

  async saveMission(state: MissionState): Promise<void> {
    const path = this.getMissionPath(state.taskId);
    await this.adapter.write(path, JSON.stringify(state, null, 2));
  }

  async loadMission(taskId: string): Promise<MissionState | null> {
    const path = this.getMissionPath(taskId);
    try {
      if (!(await this.adapter.exists(path))) {
        return null;
      }
      const content = await this.adapter.read(path);
      return JSON.parse(content) as MissionState;
    } catch {
      return null;
    }
  }

  async listMissions(): Promise<MissionState[]> {
    const files = await this.adapter.listFiles(this.basePath);
    const missions: MissionState[] = [];

    for (const file of files) {
      if (!file.endsWith('.json') || file.endsWith('.events.jsonl')) {
        continue;
      }
      const taskId = file.replace(`${this.basePath}/`, '').replace(/\.json$/, '');
      const mission = await this.loadMission(taskId);
      if (mission) {
        missions.push(mission);
      }
    }

    return missions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteMission(taskId: string): Promise<void> {
    await this.adapter.delete(this.getMissionPath(taskId));
    await this.adapter.delete(this.getEventsPath(taskId));
  }

  async appendEvent(taskId: string, event: MissionEvent): Promise<void> {
    const path = this.getEventsPath(taskId);
    const line = `${JSON.stringify(event)}\n`;
    await this.adapter.append(path, line);
  }

  async loadEvents(taskId: string): Promise<MissionEvent[]> {
    const path = this.getEventsPath(taskId);
    try {
      if (!(await this.adapter.exists(path))) {
        return [];
      }
      const content = await this.adapter.read(path);
      const events: MissionEvent[] = [];
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line) as MissionEvent);
        } catch {
          // Skip corrupt lines; keep the rest of the log readable.
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  private getMissionPath(taskId: string): string {
    return `${this.basePath}/${taskId}.json`;
  }

  private getEventsPath(taskId: string): string {
    return `${this.basePath}/${taskId}.events.jsonl`;
  }
}
