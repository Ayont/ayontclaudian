import {
  buildFallbackPlan,
  buildMasterPlanPrompt,
  MAX_PLAN_SUBTASKS,
  mergeDuplicateAssignments,
  parseMasterPlan,
  type RosterEntry,
  toRosterEntries,
} from '../../../../../src/core/intelligence/multiAgent/masterPlan';
import type { SpecialistAgent } from '../../../../../src/core/intelligence/multiAgent/MultiAgentService';

const ROSTER: RosterEntry[] = [
  { id: 'coder', name: 'Coder', role: 'Implementation' },
  { id: 'tester', name: 'Tester', role: 'Testing & QA' },
];

describe('buildMasterPlanPrompt', () => {
  test('carries the mission and the full roster as assignable ids', () => {
    const prompt = buildMasterPlanPrompt('Baue ein Login', ROSTER);

    expect(prompt).toContain('Baue ein Login');
    expect(prompt).toContain('coder: Coder');
    expect(prompt).toContain('tester: Tester');
  });

  test('states the subtask cap', () => {
    expect(buildMasterPlanPrompt('x', ROSTER)).toContain(String(MAX_PLAN_SUBTASKS));
  });
});

describe('parseMasterPlan', () => {
  test('parses a well-formed plan', () => {
    const raw = JSON.stringify({
      objective: 'Login bauen',
      rationale: 'Trennung von Bau und Test',
      subtasks: [
        { title: 'Formular', agentId: 'coder', prompt: 'Baue das Formular.' },
        { title: 'Tests', agentId: 'tester', prompt: 'Schreibe Tests.' },
      ],
    });

    const plan = parseMasterPlan(raw, ROSTER);

    expect(plan?.subtasks).toHaveLength(2);
    expect(plan?.subtasks[0]).toMatchObject({ agentId: 'coder', prompt: 'Baue das Formular.' });
    expect(plan?.objective).toBe('Login bauen');
  });

  test('drops subtasks that name an unknown specialist', () => {
    const raw = JSON.stringify({
      subtasks: [
        { title: 'a', agentId: 'ghost', prompt: 'x' },
        { title: 'b', agentId: 'coder', prompt: 'y' },
      ],
    });

    expect(parseMasterPlan(raw, ROSTER)?.subtasks.map((s) => s.agentId)).toEqual(['coder']);
  });

  test('drops subtasks without a prompt', () => {
    const raw = JSON.stringify({ subtasks: [{ title: 'a', agentId: 'coder', prompt: '  ' }] });

    expect(parseMasterPlan(raw, ROSTER)).toBeNull();
  });

  test('tolerates a code fence and surrounding prose', () => {
    const raw = 'Plan:\n```json\n{"subtasks":[{"title":"a","agentId":"coder","prompt":"x"}]}\n```\nFertig.';

    expect(parseMasterPlan(raw, ROSTER)?.subtasks).toHaveLength(1);
  });

  test('caps the number of subtasks', () => {
    const raw = JSON.stringify({
      subtasks: Array.from({ length: 20 }, (_, index) => ({
        title: `t${index}`,
        agentId: 'coder',
        prompt: `p${index}`,
      })),
    });

    expect(parseMasterPlan(raw, ROSTER)?.subtasks).toHaveLength(MAX_PLAN_SUBTASKS);
  });

  test('returns null for unusable output', () => {
    expect(parseMasterPlan('kein JSON', ROSTER)).toBeNull();
    expect(parseMasterPlan('{"subtasks": []}', ROSTER)).toBeNull();
    expect(parseMasterPlan('', ROSTER)).toBeNull();
  });
});

describe('mergeDuplicateAssignments', () => {
  test('collapses repeated agents into one slot with merged prompts', () => {
    const plan = parseMasterPlan(
      JSON.stringify({
        subtasks: [
          { title: 'a', agentId: 'coder', prompt: 'erst dies' },
          { title: 'b', agentId: 'coder', prompt: 'dann das' },
          { title: 'c', agentId: 'tester', prompt: 'testen' },
        ],
      }),
      ROSTER,
    )!;

    const merged = mergeDuplicateAssignments(plan);

    expect(merged.subtasks).toHaveLength(2);
    const coder = merged.subtasks.find((subtask) => subtask.agentId === 'coder');
    expect(coder?.prompt).toContain('erst dies');
    expect(coder?.prompt).toContain('dann das');
    expect(coder?.title).toBe('a + b');
  });
});

describe('buildFallbackPlan', () => {
  test('gives every specialist the mission from its own angle', () => {
    const plan = buildFallbackPlan('Mission X', ROSTER);

    expect(plan.subtasks).toHaveLength(2);
    for (const subtask of plan.subtasks) {
      expect(subtask.prompt).toContain('Mission X');
    }
    expect(plan.subtasks[0].prompt).toContain('Implementation');
  });

  test('respects the subtask cap', () => {
    const big = Array.from({ length: 30 }, (_, index) => ({
      id: `a${index}`,
      name: `A${index}`,
      role: 'r',
    }));

    expect(buildFallbackPlan('x', big).subtasks).toHaveLength(MAX_PLAN_SUBTASKS);
  });
});

describe('toRosterEntries', () => {
  test('reduces specialists to planner-visible fields', () => {
    const agents: SpecialistAgent[] = [
      { id: 'coder', name: 'Coder', role: 'Implementation', systemPrompt: 'geheim', providerId: 'codex' },
    ];

    expect(toRosterEntries(agents)).toEqual([{ id: 'coder', name: 'Coder', role: 'Implementation' }]);
  });
});
