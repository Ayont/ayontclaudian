import {
  buildCustomTeamAgents,
  createEmptyTeamMember,
  getTeamModelOptions,
  isCompleteTeamMember,
  MAX_TEAM_MEMBERS,
  suggestDefaultTeam,
  TEAM_AGENT_ID_PREFIX,
  type TeamMemberConfig,
} from '@/core/intelligence/multiAgent/customTeam';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderUIOption } from '@/core/providers/types';
import { AUTO_MODEL_VALUE } from '@/core/routing/modelRouterRules';

jest.mock('@/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    resolveProviderForModel: jest.fn((model: string) =>
      model.startsWith('gpt') ? 'codex' : 'claude',
    ),
  },
}));

const member = (overrides: Partial<TeamMemberConfig> = {}): TeamMemberConfig => ({
  id: 'member-1',
  name: 'Codex',
  role: 'Implementation',
  model: 'gpt-5.2-codex',
  ...overrides,
});

describe('isCompleteTeamMember', () => {
  it('requires name and model', () => {
    expect(isCompleteTeamMember(member())).toBe(true);
    expect(isCompleteTeamMember(member({ name: '  ' }))).toBe(false);
    expect(isCompleteTeamMember(member({ model: '' }))).toBe(false);
  });
});

describe('buildCustomTeamAgents', () => {
  it('builds specialist agents with derived provider and prefixed id', () => {
    const agents = buildCustomTeamAgents([member()], {});

    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe(`${TEAM_AGENT_ID_PREFIX}member-1`);
    expect(agents[0].name).toBe('Codex');
    expect(agents[0].model).toBe('gpt-5.2-codex');
    expect(agents[0].providerId).toBe('codex');
    expect(agents[0].systemPrompt).toContain('Codex');
    expect(agents[0].systemPrompt).toContain('Implementation');
    expect(ProviderRegistry.resolveProviderForModel).toHaveBeenCalledWith('gpt-5.2-codex', {});
  });

  it('skips incomplete rows and defaults empty roles to Generalist', () => {
    const agents = buildCustomTeamAgents(
      [
        member({ id: 'member-1', role: '  ' }),
        member({ id: 'member-2', name: '' }),
        member({ id: 'member-3', model: '' }),
      ],
      {},
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].role).toBe('Generalist');
  });

  it('caps the team at MAX_TEAM_MEMBERS', () => {
    const members = Array.from({ length: MAX_TEAM_MEMBERS + 3 }, (_, i) =>
      member({ id: `member-${i + 1}` }),
    );
    expect(buildCustomTeamAgents(members, {})).toHaveLength(MAX_TEAM_MEMBERS);
  });
});

describe('getTeamModelOptions', () => {
  it('filters the auto-router sentinel', () => {
    const options: ProviderUIOption[] = [
      { value: AUTO_MODEL_VALUE, label: 'Auto' },
      { value: 'gpt-5.2-codex', label: 'Codex' },
    ];
    expect(getTeamModelOptions(options).map((option) => option.value)).toEqual(['gpt-5.2-codex']);
  });
});

describe('suggestDefaultTeam', () => {
  const options: ProviderUIOption[] = [
    { value: AUTO_MODEL_VALUE, label: 'Auto' },
    { value: 'gpt-5.2-codex', label: 'Codex · GPT-5.2' },
    { value: 'fable', label: 'Claude · Fable' },
    { value: 'opus-4.8', label: 'Claude · Opus 4.8' },
  ];

  it('assembles Codex, Fable and Opus from the aggregated options', () => {
    const team = suggestDefaultTeam(options);
    expect(team.map((entry) => entry.name)).toEqual(['Codex', 'Fable', 'Opus']);
    expect(team.map((entry) => entry.model)).toEqual(['gpt-5.2-codex', 'fable', 'opus-4.8']);
    expect(new Set(team.map((entry) => entry.id)).size).toBe(3);
  });

  it('skips members whose model is unavailable', () => {
    const team = suggestDefaultTeam(options.filter((option) => option.value !== 'fable'));
    expect(team.map((entry) => entry.name)).toEqual(['Codex', 'Opus']);
  });

  it('never picks the auto sentinel', () => {
    const team = suggestDefaultTeam([{ value: AUTO_MODEL_VALUE, label: 'Auto codex fable opus' }]);
    expect(team).toEqual([]);
  });
});

describe('createEmptyTeamMember', () => {
  it('assigns the next free slot id, skipping taken ids', () => {
    const existing = [member({ id: 'member-1' }), member({ id: 'member-3' })];
    expect(createEmptyTeamMember(existing).id).toBe('member-4');
  });

  it('starts at member-1 for empty teams', () => {
    expect(createEmptyTeamMember([]).id).toBe('member-1');
  });
});
