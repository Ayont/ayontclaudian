import type { VaultFileAdapter } from '../../storage/VaultFileAdapter';

export type MissionStatus = 'pending' | 'running' | 'synthesizing' | 'completed' | 'error';

const MISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MISSION_BASE_PATH = '.claudian/missions';

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
  /**
   * Per-agent instructions from the master prompter. Persisting these is what
   * lets a resumed mission keep its division of labour instead of degrading to
   * "everyone re-answers the same question". Absent for legacy missions.
   */
  promptByAgent?: Record<string, string>;
}

export interface MissionEvent {
  ts: number;
  type: 'started' | 'agent-started' | 'agent-done' | 'agent-error' | 'synthesis-started' | 'synthesis-done' | 'synthesis-error' | 'completed' | 'error' | 'resumed' | 'failover';
  agentId?: string;
  message: string;
}

interface MissionWriteQueue {
  /** Latest state that has not started writing yet. Intermediate snapshots collapse into this slot. */
  pendingState: string | null;
  /** Single active state writer for this mission. */
  stateDrain: Promise<void> | null;
  /** Ordered event tail. Events are never coalesced. */
  eventTail: Promise<void>;
  /** Deferred storage failures surface when the mission performs its final flush. */
  errors: unknown[];
}

/**
 * Persisted storage for multi-agent mission state and event logs.
 *
 * State is saved as JSON under `.claudian/missions/{taskId}.json`.
 * Events are appended as JSONL under `.claudian/missions/{taskId}.events.jsonl`.
 */
export class MissionStateStorage {
  private readonly basePath: string;
  private readonly writeQueues = new Map<string, MissionWriteQueue>();

  constructor(
    private readonly adapter: VaultFileAdapter,
    basePath = MISSION_BASE_PATH,
  ) {
    const normalizedBasePath = basePath
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/\/$/, '');
    if (normalizedBasePath !== MISSION_BASE_PATH) {
      throw new Error(`Ungültiger Missions-Speicherpfad: ${basePath}`);
    }
    this.basePath = MISSION_BASE_PATH;
  }

  async saveMission(state: MissionState): Promise<void> {
    this.assertTaskId(state.taskId);
    const queue = this.getWriteQueue(state.taskId);
    // Serialize now. Progress objects are mutated in place by the runner, so
    // retaining the object would make an older queued write silently inherit a
    // newer state instead of representing the snapshot that was scheduled.
    queue.pendingState = JSON.stringify(state, null, 2);
    this.startStateDrain(state.taskId, queue);
    await queue.stateDrain;
  }

  /**
   * Waits until every state snapshot and event scheduled for one mission is on
   * disk. Callers use this as the completion barrier before reporting success.
   */
  async flushMission(taskId: string): Promise<void> {
    this.assertTaskId(taskId);
    const queue = this.writeQueues.get(taskId);
    if (!queue) return;

    while (true) {
      this.startStateDrain(taskId, queue);
      const stateDrain = queue.stateDrain;
      const eventTail = queue.eventTail;
      await Promise.allSettled([
        ...(stateDrain ? [stateDrain] : []),
        eventTail,
      ]);

      if (
        queue.pendingState === null &&
        queue.stateDrain === null &&
        queue.eventTail === eventTail
      ) {
        break;
      }
    }

    const error = queue.errors.shift();
    if (error !== undefined) {
      queue.errors.length = 0;
      throw error;
    }
    if (this.writeQueues.get(taskId) === queue) {
      this.writeQueues.delete(taskId);
    }
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
    const prefix = `${this.basePath}/`;

    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith('.json') || file.endsWith('.events.jsonl')) {
        continue;
      }
      const fileName = file.slice(prefix.length);
      if (fileName.includes('/') || fileName.includes('\\')) continue;
      const taskId = fileName.replace(/\.json$/, '');
      if (!MISSION_ID_PATTERN.test(taskId)) continue;
      const mission = await this.loadMission(taskId);
      if (mission) {
        missions.push(mission);
      }
    }

    return missions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteMission(taskId: string): Promise<void> {
    await this.flushMission(taskId);
    await this.adapter.delete(this.getMissionPath(taskId));
    await this.adapter.delete(this.getEventsPath(taskId));
    this.writeQueues.delete(taskId);
  }

  async appendEvent(taskId: string, event: MissionEvent): Promise<void> {
    const path = this.getEventsPath(taskId);
    const line = `${JSON.stringify(event)}\n`;
    const queue = this.getWriteQueue(taskId);
    const write = queue.eventTail.then(() => this.adapter.append(path, line));
    queue.eventTail = write.catch((error: unknown) => {
      queue.errors.push(error);
    });
    await queue.eventTail;
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
    this.assertTaskId(taskId);
    return `${this.basePath}/${taskId}.json`;
  }

  private getEventsPath(taskId: string): string {
    this.assertTaskId(taskId);
    return `${this.basePath}/${taskId}.events.jsonl`;
  }

  private assertTaskId(taskId: string): void {
    if (!MISSION_ID_PATTERN.test(taskId)) {
      throw new Error(`Ungültige Missions-ID: ${taskId || '(leer)'}`);
    }
  }

  private getWriteQueue(taskId: string): MissionWriteQueue {
    let queue = this.writeQueues.get(taskId);
    if (!queue) {
      queue = {
        pendingState: null,
        stateDrain: null,
        eventTail: Promise.resolve(),
        errors: [],
      };
      this.writeQueues.set(taskId, queue);
    }
    return queue;
  }

  private startStateDrain(taskId: string, queue: MissionWriteQueue): void {
    if (queue.stateDrain || queue.pendingState === null) return;

    const drain = this.drainMissionStates(taskId, queue);
    queue.stateDrain = drain;
    const finish = (): void => {
      if (queue.stateDrain === drain) {
        queue.stateDrain = null;
      }
      // A save may have arrived between the loop's final check and cleanup.
      this.startStateDrain(taskId, queue);
    };
    // Most progress writes are intentionally fire-and-forget. Attach both
    // handlers here so failures are held for flushMission instead of becoming
    // unhandled promise rejections.
    void drain.then(finish, (error: unknown) => {
      queue.errors.push(error);
      finish();
    });
  }

  private async drainMissionStates(taskId: string, queue: MissionWriteQueue): Promise<void> {
    while (queue.pendingState !== null) {
      const content = queue.pendingState;
      queue.pendingState = null;
      await this.adapter.write(this.getMissionPath(taskId), content);
    }
  }
}
