import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';

import type { SubagentInfo } from '@/core/types';
import { SubagentManager } from '@/features/chat/services/SubagentManager';
import {
  STOP_ARM_MS,
  SubagentActionController,
  type SubagentActionDeps,
} from '@/features/chat/subagents/SubagentActionController';

function setup(runtime: Record<string, jest.Mock> | null, streaming = true) {
  const manager = new SubagentManager(() => {});
  const parentEl = createMockEl('div');
  manager.handleTaskToolUse('toolu_1', { run_in_background: false, description: 'Firewall prüfen' }, parentEl);
  const deps: SubagentActionDeps = {
    getManager: () => manager,
    getRuntime: () => runtime as never,
    isStreaming: () => streaming,
    cancelTurn: jest.fn(),
    openInspector: jest.fn(),
    providerLabel: () => 'OpenCode',
    notify: jest.fn(),
  };
  return { manager, deps, controller: new SubagentActionController(deps), info: manager.getSubagentById('toolu_1') as SubagentInfo };
}

describe('SubagentActionController', () => {
  afterEach(() => jest.useRealTimers());

  it('stops exactly one subagent when the provider can target it', async () => {
    const cancelSubagent = jest.fn().mockResolvedValue(true);
    const { controller, deps, manager, info } = setup({ canCancelSubagent: jest.fn().mockReturnValue(true), cancelSubagent });
    info.taskId = 'task-1';

    expect(controller.resolveStopScope('toolu_1')).toBe('agent');
    await expect(controller.stop('toolu_1')).resolves.toBe('stopped');

    expect(cancelSubagent).toHaveBeenCalledWith({ id: 'toolu_1', taskId: 'task-1' });
    expect(deps.cancelTurn).not.toHaveBeenCalled();
    expect(manager.getSubagentById('toolu_1')?.cancelState).toBe('requested');
  });

  // Providers without a per-subagent primitive: be honest and stop the answer.
  it('stops the whole answer when the provider cannot stop one subagent', async () => {
    const { controller, deps, manager } = setup({});

    expect(controller.resolveStopScope('toolu_1')).toBe('turn');
    await expect(controller.stop('toolu_1')).resolves.toBe('turn-stopped');

    expect(deps.cancelTurn).toHaveBeenCalled();
    expect(manager.getSubagentById('toolu_1')?.cancelState).toBe('requested');
  });

  it('says so when nothing can stop the subagent any more', async () => {
    const { controller, deps } = setup({}, false);

    await expect(controller.stop('toolu_1')).resolves.toBe('unavailable');

    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('OpenCode kann diesen Subagent gerade nicht einzeln stoppen'));
  });

  it('withdraws the stop and tells the user when the provider refused it', async () => {
    const { controller, deps, manager } = setup({
      canCancelSubagent: jest.fn().mockReturnValue(true),
      cancelSubagent: jest.fn().mockResolvedValue(false),
    });

    await expect(controller.stop('toolu_1')).resolves.toBe('failed');

    expect(manager.getSubagentById('toolu_1')?.cancelState).toBeUndefined();
    expect(deps.notify).toHaveBeenCalledWith('Stoppen fehlgeschlagen – der Subagent läuft weiter.');
  });

  it('arms the card button first and stops only on the confirming click', async () => {
    jest.useFakeTimers();
    const cancelSubagent = jest.fn().mockResolvedValue(true);
    const { controller } = setup({ canCancelSubagent: jest.fn().mockReturnValue(true), cancelSubagent });
    const button = createMockEl('button');
    button.createSpan({ cls: 'claudian-subagent-action-label' });

    await controller.handleAction(button as never, 'stop', 'toolu_1');
    expect(button.hasClass('is-armed')).toBe(true);
    expect(button.querySelector('.claudian-subagent-action-label')?.textContent).toBe('Stoppen?');
    expect(cancelSubagent).not.toHaveBeenCalled();

    await controller.handleAction(button as never, 'stop', 'toolu_1');
    expect(cancelSubagent).toHaveBeenCalledTimes(1);
    expect(button.hasClass('is-armed')).toBe(false);
  });

  it('names the consequence on the armed button when it will stop the answer', async () => {
    jest.useFakeTimers();
    const { controller } = setup({});
    const button = createMockEl('button');
    button.createSpan({ cls: 'claudian-subagent-action-label' });

    await controller.handleAction(button as never, 'stop', 'toolu_1');

    expect(button.querySelector('.claudian-subagent-action-label')?.textContent).toBe('Ganze Antwort stoppen?');
  });

  it('disarms on its own after a short wait', async () => {
    jest.useFakeTimers();
    const { controller } = setup({});
    const button = createMockEl('button');

    await controller.handleAction(button as never, 'stop', 'toolu_1');
    jest.advanceTimersByTime(STOP_ARM_MS + 1);

    expect(button.hasClass('is-armed')).toBe(false);
  });

  it('opens the inspector for a card', async () => {
    const { controller, deps } = setup({});

    await controller.handleAction(createMockEl('button') as never, 'inspect', 'toolu_1');

    expect(deps.openInspector).toHaveBeenCalledWith('toolu_1');
  });
});

describe('SubagentActionController — background agents', () => {
  // Stopping the answer does not stop an agent running in the background, so
  // offering it would promise something that does not happen.
  it('never offers stopping the whole answer for a background agent', () => {
    const manager = new SubagentManager(() => {});
    manager.handleTaskToolUse('toolu_bg', { run_in_background: true, description: 'Hintergrund' }, createMockEl('div'));
    const controller = new SubagentActionController({
      getManager: () => manager,
      getRuntime: () => ({}) as never,
      isStreaming: () => true,
      cancelTurn: jest.fn(),
      openInspector: jest.fn(),
      providerLabel: () => 'OpenCode',
      notify: jest.fn(),
    });

    expect(controller.resolveStopScope('toolu_bg')).toBe('none');
  });
});
