import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import type { SubagentInfo } from '@/core/types';
import { type InspectorCallbacks, SubagentInspectorPanel } from '@/features/chat/subagents/SubagentInspectorPanel';

function info(overrides: Partial<SubagentInfo> = {}): SubagentInfo {
  return {
    id: 'toolu_1',
    description: 'Firewall-Regeln prüfen',
    prompt: 'Prüfe Regel 12',
    status: 'running',
    toolCalls: [],
    isExpanded: false,
    providerId: 'claude',
    agentType: 'Explore',
    model: 'claude-haiku-4-5',
    startedAt: Date.now(),
    ...overrides,
  };
}

function texts(root: MockElement, cls: string): string[] {
  return root.querySelectorAll(`.${cls}`).map(el => el.textContent);
}

describe('SubagentInspectorPanel', () => {
  let root: MockElement;
  let callbacks: InspectorCallbacks & { onStop: jest.Mock; onOpenFile: jest.Mock; renderMarkdown: jest.Mock };
  let panel: SubagentInspectorPanel;

  beforeEach(() => {
    root = createMockEl('div');
    callbacks = {
      onStop: jest.fn(),
      onLocate: jest.fn(),
      onOpenFile: jest.fn(),
      renderMarkdown: jest.fn((markdown: string, el: HTMLElement) => el.setText(markdown)),
    };
    panel = new SubagentInspectorPanel(root as never, callbacks);
  });

  afterEach(() => panel.destroy());

  it('names the agent, its phase and where it comes from', () => {
    panel.render(info(), { live: true, stopScope: 'agent', providerLabel: 'Claude', conversationTitle: 'CERTUSS' });

    expect(texts(root, 'claudian-inspector-title')).toEqual(['Firewall-Regeln prüfen']);
    expect(texts(root, 'claudian-inspector-phase-text')).toEqual(['Läuft']);
    expect(texts(root, 'claudian-inspector-provenance-parts')).toEqual(['Explore · claude-haiku-4-5 · Vordergrund']);
    expect(texts(root, 'claudian-inspector-context-text')).toEqual(['Chat: CERTUSS']);
    expect(root.getAttribute('data-provider')).toBe('claude');
  });

  it('shows the task, what the agent wrote and did, and its result in order', () => {
    const subagent = info({
      toolCalls: [{ id: 't1', name: 'Read', input: { file_path: '/v/regeln.md' }, status: 'completed' }],
      timeline: [
        { type: 'text', text: 'Ich lese die Regeln.', at: 1 },
        { type: 'tool', toolId: 't1', at: 2 },
      ],
      status: 'completed',
      result: 'Regel 12 blockiert **Port 443**.',
    });

    panel.render(subagent, { live: true, stopScope: 'none' });

    const entries = root.querySelectorAll('.claudian-inspector-entry');
    expect(entries.map(entry => entry.getClasses().find(cls => cls.startsWith('is-')))).toEqual(['is-prompt', 'is-text', 'is-tool', 'is-result']);
    expect(callbacks.renderMarkdown).toHaveBeenCalledWith('Regel 12 blockiert **Port 443**.', expect.anything());
  });

  it('updates a running tool in place and animates only what arrives while watching', () => {
    const subagent = info({
      toolCalls: [{ id: 't1', name: 'Bash', input: { command: 'npm test' }, status: 'running' }],
    });
    panel.render(subagent, { live: true, stopScope: 'agent' });
    const toolEntry = root.querySelector('.is-tool') as MockElement;
    expect(toolEntry.hasClass('is-new')).toBe(false);

    subagent.toolCalls[0] = { ...subagent.toolCalls[0], status: 'completed', result: 'ok' };
    subagent.toolCalls.push({ id: 't2', name: 'Read', input: { file_path: '/v/a.md' }, status: 'running' });
    panel.render(subagent, { live: true, stopScope: 'agent' });

    const tools = root.querySelectorAll('.is-tool');
    expect(tools[0]).toBe(toolEntry);
    expect(toolEntry.getAttribute('data-status')).toBe('completed');
    expect(tools[1].hasClass('is-new')).toBe(true);
  });

  it('stops only after the confirming second click', () => {
    panel.render(info(), { live: true, stopScope: 'agent' });
    const stop = root.querySelector('.claudian-inspector-stop') as MockElement;

    stop.click();
    expect(texts(stop, 'claudian-inspector-button-label')).toEqual(['Stoppen?']);
    expect(callbacks.onStop).not.toHaveBeenCalled();

    stop.click();
    expect(callbacks.onStop).toHaveBeenCalledTimes(1);
  });

  it('warns on the armed button that the whole answer will stop', () => {
    panel.render(info(), { live: true, stopScope: 'turn' });
    const stop = root.querySelector('.claudian-inspector-stop') as MockElement;

    stop.click();

    expect(texts(stop, 'claudian-inspector-button-label')).toEqual(['Ganze Antwort stoppen?']);
  });

  it('does not offer Stop for a subagent restored from history', () => {
    panel.render(info(), { live: false, stopScope: 'none' });

    expect((root.querySelector('.claudian-inspector-stop') as MockElement).hasClass('claudian-hidden')).toBe(true);
  });

  it('opens a file the agent touched', () => {
    panel.render(info({
      toolCalls: [{ id: 't1', name: 'Edit', input: { file_path: '/vault/firewall.md' }, status: 'completed' }],
    }), { live: true, stopScope: 'agent' });

    (root.querySelector('.claudian-inspector-file') as MockElement).click();

    expect(callbacks.onOpenFile).toHaveBeenCalledWith('/vault/firewall.md');
  });

  it('explains when the subagent cannot be found any more', () => {
    panel.render(undefined, { live: false, stopScope: 'none' });

    expect((root.querySelector('.claudian-inspector-empty') as MockElement).hasClass('claudian-hidden')).toBe(false);
    expect(texts(root, 'claudian-inspector-empty-title')).toEqual(['Dieser Subagent ist nicht mehr verfügbar.']);
  });
});

describe('SubagentInspectorPanel — saved runs', () => {
  it('shows a saved foreground run that never finished as ended, and does not tick', () => {
    const root = createMockEl('div');
    const panel = new SubagentInspectorPanel(root as never, { onStop: jest.fn(), renderMarkdown: jest.fn() });
    const saved = info({ startedAt: 1_000 });

    panel.render(saved, { live: false, stopScope: 'none' });
    const elapsed = (root.querySelector('.claudian-inspector-elapsed') as MockElement).textContent;
    panel.tick(10_000_000);

    expect(texts(root, 'claudian-inspector-phase-text')).toEqual(['Abgebrochen']);
    expect((root.querySelector('.claudian-inspector-elapsed') as MockElement).textContent).toBe(elapsed);
    panel.destroy();
  });

  it('places the first entry first even when it arrives late', () => {
    const root = createMockEl('div');
    const panel = new SubagentInspectorPanel(root as never, { onStop: jest.fn(), renderMarkdown: jest.fn() });
    const subagent = info({ prompt: '', toolCalls: [{ id: 't2', name: 'Read', input: {}, status: 'completed' }], timeline: [{ type: 'tool', toolId: 't2', at: 2 }] });
    panel.render(subagent, { live: true, stopScope: 'agent' });

    subagent.toolCalls.unshift({ id: 't1', name: 'Grep', input: {}, status: 'completed' });
    panel.render(subagent, { live: true, stopScope: 'agent' });

    const list = root.querySelector('.claudian-inspector-timeline') as MockElement;
    expect(list.children.map(child => child.getAttribute('data-status') && child.querySelector('.claudian-inspector-tool-name')?.textContent)).toEqual(['Grep', 'Read']);
    panel.destroy();
  });
});
