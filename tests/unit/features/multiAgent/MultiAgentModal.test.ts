import { createMockEl } from '@test/helpers/mockElement';
import { Modal } from 'obsidian';

import type { MissionState } from '@/core/intelligence/multiAgent/MissionStateStorage';
import {
  createMissionId,
  MultiAgentModal,
} from '@/features/multiAgent/MultiAgentModal';

const AGENT = { id: 'a', name: 'A', role: 'a', systemPrompt: 'A' };

function allElements(root: any): any[] {
  return [root, ...(root.children ?? []).flatMap((child: any) => allElements(child))];
}

function createPlugin() {
  return {
    app: {
      vault: { create: jest.fn().mockResolvedValue({}) },
    },
    settings: { multiAgentUseCustomTeam: false },
    missionStateStorage: {
      loadMission: jest.fn().mockResolvedValue(null),
      listMissions: jest.fn().mockResolvedValue([]),
    },
    multiAgentService: {
      listAgents: jest.fn().mockReturnValue([AGENT]),
      registerAgent: jest.fn(),
      isMissionActive: jest.fn().mockReturnValue(false),
      resumeMission: jest.fn().mockResolvedValue({
        results: [{ agentId: 'a', output: 'done' }],
        synthesis: 'summary',
      }),
    },
    buildMultiAgentExecutor: jest.fn().mockReturnValue({ execute: jest.fn() }),
    getActiveMultiAgentProviderId: jest.fn().mockReturnValue('claude'),
    resolveMultiAgentProviderId: jest.fn().mockReturnValue('claude'),
    providerCapacityService: {
      getAvailableProviderIds: jest.fn().mockReturnValue(['claude']),
      rank: jest.fn().mockReturnValue([]),
      markRateLimited: jest.fn(),
    },
    runMasterMission: jest.fn().mockResolvedValue({
      results: [{ agentId: 'a', output: 'done' }],
      synthesis: 'summary',
    }),
    runSynthesisPrompt: jest.fn().mockResolvedValue('summary'),
    getView: jest.fn().mockReturnValue({ getActiveTab: () => ({ providerId: 'claude' }) }),
  };
}

function resumableMission(): MissionState {
  return {
    taskId: 'mission-existing',
    prompt: 'repair it',
    agentIds: ['a'],
    status: 'error',
    overall: 50,
    agents: [{ agentId: 'a', status: 'error', progress: 100, output: 'failed' }],
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('MultiAgentModal mission identity and resume wiring', () => {
  beforeEach(() => {
    (Modal as unknown as { instances: Modal[] }).instances.length = 0;
  });

  it('creates collision-resistant ids even when time and randomness are identical', () => {
    const first = createMissionId(() => 42, () => 'fixed');
    const second = createMissionId(() => 42, () => 'fixed');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^ma-/);
  });

  it('uses the visible mission heading as the dialog accessible name', () => {
    const plugin = createPlugin();
    plugin.multiAgentService.listAgents.mockReturnValue([]);
    const modal = new MultiAgentModal(plugin as never);
    (modal as any).contentEl = createMockEl();
    (modal as any).modalEl = createMockEl();

    MultiAgentModal.prototype.onOpen.call(modal);

    const heading = allElements(modal.contentEl).find((element) => element.tagName === 'H2');
    expect(heading?.textContent).toBe('Multi-Agent Mission');
    expect(modal.modalEl.getAttribute('aria-labelledby')).toBe(heading?.id);
  });

  it('opens a fresh console by default and restores only an explicitly requested mission', async () => {
    const plugin = createPlugin();
    const state = resumableMission();
    plugin.missionStateStorage.loadMission.mockResolvedValue(state);

    await MultiAgentModal.open(plugin as never);
    expect(plugin.missionStateStorage.listMissions).not.toHaveBeenCalled();
    expect(plugin.missionStateStorage.loadMission).not.toHaveBeenCalled();

    await MultiAgentModal.open(plugin as never, '', state.taskId);
    expect(plugin.missionStateStorage.loadMission).toHaveBeenCalledWith(state.taskId);
    const instances = (Modal as unknown as { instances: Modal[] }).instances;
    expect((instances.at(-1) as unknown as { restoredState: MissionState }).restoredState).toEqual(state);
  });

  it('assigns a new mission id for every fresh launch', async () => {
    const plugin = createPlugin();
    const modal = new MultiAgentModal(plugin as never);
    (modal as unknown as { promptInput: HTMLTextAreaElement }).promptInput = {
      value: 'task',
      disabled: false,
      focus: jest.fn(),
    } as unknown as HTMLTextAreaElement;

    await (modal as unknown as { launch: () => Promise<void> }).launch();
    await (modal as unknown as { launch: () => Promise<void> }).launch();

    const ids = plugin.runMasterMission.mock.calls.map(([request]) => request.taskId as string);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('continues an explicitly restored mission through MultiAgentService.resumeMission', async () => {
    const plugin = createPlugin();
    const state = resumableMission();
    const modal = new MultiAgentModal(plugin as never, '', state.taskId);
    (modal as unknown as { restoredState: MissionState }).restoredState = state;

    await (modal as unknown as { resumeStoredMission: () => Promise<void> }).resumeStoredMission();

    expect(plugin.multiAgentService.resumeMission).toHaveBeenCalledTimes(1);
    expect(plugin.multiAgentService.resumeMission.mock.calls[0][0]).toBe(state);
    expect(plugin.buildMultiAgentExecutor).toHaveBeenCalledTimes(1);
  });

  it('restores a failed launch as a retryable mission instead of showing success controls', async () => {
    const plugin = createPlugin();
    plugin.runMasterMission.mockRejectedValue(new Error('Synthese fehlgeschlagen'));
    plugin.missionStateStorage.loadMission.mockImplementation(async (taskId: string) => ({
      ...resumableMission(),
      taskId,
      synthesis: { status: 'error', output: 'Synthese fehlgeschlagen', error: 'Synthese fehlgeschlagen' },
    }));
    const modal = new MultiAgentModal(plugin as never);
    const promptInput = { value: 'task', disabled: false, focus: jest.fn() } as unknown as HTMLTextAreaElement;
    const launchBtn = createMockEl('button');
    const overallBar = createMockEl();
    const statusText = createMockEl();
    overallBar.parentElement = createMockEl();
    (modal as unknown as { promptInput: HTMLTextAreaElement }).promptInput = promptInput;
    (modal as unknown as { launchBtn: HTMLButtonElement }).launchBtn = launchBtn;
    (modal as unknown as { statusText: HTMLElement }).statusText = statusText;
    (modal as unknown as { overallBar: HTMLElement }).overallBar = overallBar;

    await (modal as unknown as { launch: () => Promise<void> }).launch();

    const launchedId = plugin.runMasterMission.mock.calls[0][0].taskId as string;
    expect(plugin.app.vault.create).not.toHaveBeenCalled();
    expect(plugin.missionStateStorage.loadMission).toHaveBeenCalledWith(launchedId);
    expect((modal as unknown as { restoredState: MissionState }).restoredState.status).toBe('error');
    expect(statusText.textContent).toBe('Mission mit Fehlern beendet');
    expect(allElements(launchBtn).some((element) => element.textContent === 'Mission fortsetzen')).toBe(true);
    expect(promptInput.disabled).toBe(true);
  });
});
