import { type ClaudianEventType,globalEventBus } from '../../events/EventBus';

export interface WorkflowTrigger {
  type: 'schedule' | 'event';
  schedule?: { cron: string }; // simplified: just hourly/daily for now
  event?: { type: ClaudianEventType };
}

export interface WorkflowStep {
  id: string;
  action: string;
  params: Record<string, unknown>;
}

export interface ScheduledWorkflow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  lastRun?: number;
  nextRun?: number;
}

export interface WorkflowStorage {
  load(): Promise<ScheduledWorkflow[]>;
  save(workflows: ScheduledWorkflow[]): Promise<void>;
}

export class WorkflowEngine {
  private workflows = new Map<string, ScheduledWorkflow>();
  private checkInterval: number | null = null;

  constructor(
    private readonly executor: (step: WorkflowStep) => Promise<void>,
    private readonly storage?: WorkflowStorage,
  ) {}

  async load(): Promise<void> {
    if (!this.storage) return;
    const workflows = await this.storage.load().catch(() => []);
    this.workflows.clear();
    for (const workflow of workflows) {
      if (workflow.enabled && !workflow.nextRun) workflow.nextRun = this.computeNextRun(workflow.trigger);
      this.workflows.set(workflow.id, workflow);
    }
  }

  start(): void {
    if (this.checkInterval) return;
    this.checkInterval = window.setInterval(() => {
      void this.checkScheduledWorkflows();
    }, 60_000);
  }

  stop(): void {
    if (this.checkInterval) {
      window.clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  register(workflow: ScheduledWorkflow): void {
    if (workflow.enabled && workflow.trigger.type === 'schedule' && !workflow.nextRun) {
      workflow.nextRun = this.computeNextRun(workflow.trigger);
    }
    this.workflows.set(workflow.id, workflow);
    if (workflow.trigger.type === 'event' && workflow.trigger.event) {
      globalEventBus.on(workflow.trigger.event.type, () => {
        if (workflow.enabled) {
          void this.runWorkflow(workflow);
        }
      });
    }
    void this.persist();
  }

  unregister(id: string): void {
    this.workflows.delete(id);
    void this.persist();
  }

  list(): ScheduledWorkflow[] {
    return Array.from(this.workflows.values());
  }

  async run(id: string): Promise<boolean> {
    const workflow = this.workflows.get(id);
    if (!workflow) return false;
    await this.runWorkflow(workflow);
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const workflow = this.workflows.get(id);
    if (!workflow) return false;
    workflow.enabled = enabled;
    if (enabled && (!workflow.nextRun || workflow.nextRun < Date.now())) {
      workflow.nextRun = this.computeNextRun(workflow.trigger);
    }
    void this.persist();
    return true;
  }

  private async checkScheduledWorkflows(): Promise<void> {
    const now = Date.now();
    for (const workflow of this.workflows.values()) {
      if (!workflow.enabled) continue;
      if (workflow.trigger.type !== 'schedule') continue;
      if (workflow.nextRun && workflow.nextRun > now) continue;
      await this.runWorkflow(workflow);
    }
  }

  private async runWorkflow(workflow: ScheduledWorkflow): Promise<void> {
    workflow.lastRun = Date.now();
    workflow.nextRun = this.computeNextRun(workflow.trigger);
    globalEventBus.emit('workflow:trigger', { workflowId: workflow.id });

    for (const step of workflow.steps) {
      try {
        await this.executor(step);
      } catch (error) {
        globalEventBus.emit('agent:run-error', { workflowId: workflow.id, stepId: step.id, error });
      }
    }
    await this.persist();
  }

  private computeNextRun(trigger: WorkflowTrigger): number {
    if (trigger.schedule?.cron === 'hourly') return Date.now() + 60 * 60 * 1000;
    if (trigger.schedule?.cron === 'daily') return Date.now() + 24 * 60 * 60 * 1000;
    const dailyAt = trigger.schedule?.cron.match(/^daily@(\d{2}):(\d{2})$/);
    if (dailyAt) {
      const next = new Date();
      next.setHours(Number(dailyAt[1]), Number(dailyAt[2]), 0, 0);
      if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
      return next.getTime();
    }
    return Date.now() + 24 * 60 * 60 * 1000;
  }

  private async persist(): Promise<void> {
    await this.storage?.save(this.list());
  }
}
