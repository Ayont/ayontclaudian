import type { ProviderCapacity } from '../../../../../src/core/budget/providerCapacity';
import {
  type MasterMissionProgress,
  MasterPrompterService,
} from '../../../../../src/core/intelligence/multiAgent/MasterPrompterService';
import {
  type AgentExecutor,
  MultiAgentService,
  type SpecialistAgent,
} from '../../../../../src/core/intelligence/multiAgent/MultiAgentService';
import type { ProviderCapacityService } from '../../../../../src/core/intelligence/multiAgent/ProviderCapacityService';
import type { ProviderId } from '../../../../../src/core/types/provider';

const AGENTS: SpecialistAgent[] = [
  { id: 'coder', name: 'Coder', role: 'Implementation', systemPrompt: 'code', providerId: 'codex' },
  { id: 'tester', name: 'Tester', role: 'Testing', systemPrompt: 'test', providerId: 'claude' },
];

function capacity(providerId: string, available: boolean): ProviderCapacity {
  return {
    providerId,
    enabled: true,
    headroom: available ? 1 : 0,
    windowTokens: 0,
    cap: 0,
    resetAt: null,
    cooldownUntil: null,
    available,
    reason: available ? 'frei' : 'Limit erreicht',
    score: available ? 1 : -1,
  };
}

function makeCapacityService(availableIds: string[], allIds = availableIds): ProviderCapacityService {
  const rateLimited = new Set<string>();
  const stub = {
    rank: () => allIds.map((id) => capacity(id, availableIds.includes(id) && !rateLimited.has(id))),
    getAvailableProviderIds: () => availableIds.filter((id) => !rateLimited.has(id)) as ProviderId[],
    pickBest: () => (availableIds.filter((id) => !rateLimited.has(id))[0] ?? null) as ProviderId | null,
    distribute: (count: number) =>
      Array.from({ length: count }, (_, index) => availableIds[index % availableIds.length] as ProviderId),
    markRateLimited: (providerId: ProviderId) => rateLimited.add(providerId),
    clearRateLimit: (providerId: ProviderId) => rateLimited.delete(providerId),
    isRateLimited: (providerId: ProviderId) => rateLimited.has(providerId),
  };
  return stub as unknown as ProviderCapacityService;
}

interface HarnessOptions {
  planResponse?: string;
  planRejects?: boolean;
  available?: string[];
  all?: string[];
}

function makeHarness(options: HarnessOptions = {}) {
  const service = new MultiAgentService();
  for (const agent of AGENTS) service.registerAgent(agent);

  const executed: { agentId: string; prompt: string; providerId?: ProviderId }[] = [];
  const executor: AgentExecutor = {
    execute: async (agent, prompt) => {
      executed.push({ agentId: agent.id, prompt });
      return `${agent.name}: erledigt`;
    },
    executeWithProvider: async (agent, prompt, providerId) => {
      executed.push({ agentId: agent.id, prompt, providerId });
      return `${agent.name}: erledigt`;
    },
  };

  const planPrompts: string[] = [];
  const master = new MasterPrompterService({
    capacity: makeCapacityService(options.available ?? ['codex', 'claude'], options.all),
    service,
    runPrompt: async (prompt) => {
      planPrompts.push(prompt);
      if (options.planRejects) throw new Error('Planner tot');
      return options.planResponse ?? JSON.stringify({
        objective: 'Login',
        rationale: 'Bau und Test trennen',
        subtasks: [
          { title: 'Formular', agentId: 'coder', prompt: 'Baue das Formular.' },
          { title: 'Tests', agentId: 'tester', prompt: 'Schreibe Tests.' },
        ],
      });
    },
  });

  return { executed, executor, master, planPrompts, service };
}

describe('MasterPrompterService', () => {
  test('hands each specialist its own prompt instead of the raw mission', async () => {
    const harness = makeHarness();

    await harness.master.run({
      executor: harness.executor,
      mission: 'Baue ein Login',
      roster: AGENTS,
      taskId: 'task-1',
    });

    const prompts = harness.executed.map((entry) => entry.prompt);
    expect(prompts).toContain('Baue das Formular.');
    expect(prompts).toContain('Schreibe Tests.');
    expect(prompts).not.toContain('Baue ein Login');
  });

  test('routes subtasks only to providers that have capacity', async () => {
    const harness = makeHarness({ available: ['claude'], all: ['claude', 'codex'] });

    const outcome = await harness.master.run({
      executor: harness.executor,
      mission: 'Baue ein Login',
      roster: AGENTS,
      taskId: 'task-2',
    });

    expect(Object.values(outcome.assignments)).toEqual(['claude', 'claude']);
  });

  test('keeps a preferred provider when it still has capacity', async () => {
    const harness = makeHarness({ available: ['codex', 'claude'] });

    const outcome = await harness.master.run({
      executor: harness.executor,
      mission: 'Baue ein Login',
      roster: AGENTS,
      taskId: 'task-3',
    });

    expect(outcome.assignments.coder).toBe('codex');
    expect(outcome.assignments.tester).toBe('claude');
  });

  test('falls back to a per-role plan when the planner dies', async () => {
    const harness = makeHarness({ planRejects: true });

    const outcome = await harness.master.run({
      executor: harness.executor,
      mission: 'Baue ein Login',
      roster: AGENTS,
      taskId: 'task-4',
    });

    expect(outcome.plan.subtasks).toHaveLength(2);
    expect(outcome.plan.rationale).toContain('Kein Master-Plan');
    expect(harness.executed).toHaveLength(2);
  });

  test('falls back when the planner answers with unusable text', async () => {
    const harness = makeHarness({ planResponse: 'ich weiß es nicht' });

    const outcome = await harness.master.run({
      executor: harness.executor,
      mission: 'Baue ein Login',
      roster: AGENTS,
      taskId: 'task-5',
    });

    expect(outcome.plan.subtasks).toHaveLength(2);
    expect(harness.executed).toHaveLength(2);
  });

  test('reports planning, working and completion phases in order', async () => {
    const harness = makeHarness();
    const phases: MasterMissionProgress['phase'][] = [];

    await harness.master.run(
      { executor: harness.executor, mission: 'x', roster: AGENTS, taskId: 'task-6' },
      (progress) => {
        if (phases[phases.length - 1] !== progress.phase) phases.push(progress.phase);
      },
    );

    expect(phases[0]).toBe('planning');
    expect(phases).toContain('dispatching');
    expect(phases).toContain('working');
    expect(phases[phases.length - 1]).toBe('completed');
  });

  test('exposes the plan and the live capacity snapshot to the UI', async () => {
    const harness = makeHarness();
    let last: MasterMissionProgress | null = null;

    await harness.master.run(
      { executor: harness.executor, mission: 'x', roster: AGENTS, taskId: 'task-7' },
      (progress) => { last = progress; },
    );

    expect(last!.plan?.subtasks).toHaveLength(2);
    expect(last!.capacities.length).toBeGreaterThan(0);
    expect(last!.assignments.coder).toBeDefined();
  });

  test('produces an empty plan without crashing when no specialists exist', async () => {
    const harness = makeHarness();

    const outcome = await harness.master.run({
      executor: harness.executor,
      mission: 'x',
      roster: [],
      taskId: 'task-8',
    });

    expect(outcome.plan.subtasks).toEqual([]);
    expect(outcome.results).toEqual([]);
  });
});
