import type { ProviderSettingsTabRendererContext } from '@/core/providers/types';
import { GrokAgentCatalog } from '@/providers/grok/agents/GrokAgentCatalog';
import { getGrokProviderSettings } from '@/providers/grok/settings';

const mockSettings: MockSetting[] = [];
let mockCatalog: GrokAgentCatalog | null = null;

class MockControl {
  value: string | boolean = '';
  disabled = false;
  options: Record<string, string> = {};
  inputEl = { rows: 0, toggleClass: jest.fn() };
  selectEl = { empty: () => { this.options = {}; } };
  change: (value: string) => Promise<void> | void = () => {};
  click: () => Promise<void> | void = () => {};
  setValue(value: string | boolean) { this.value = value; return this; }
  setDisabled(value: boolean) { this.disabled = value; return this; }
  setPlaceholder(_value: string) { return this; }
  setButtonText(_value: string) { return this; }
  addOption(value: string, label: string) { this.options[value] = label; return this; }
  onChange(callback: MockControl['change']) { this.change = callback; return this; }
  onClick(callback: MockControl['click']) { this.click = callback; return this; }
}
class MockSetting {
  name = '';
  desc = '';
  controls: MockControl[] = [];
  constructor(_container: unknown) { mockSettings.push(this); }
  setName(value: string) { this.name = value; return this; }
  setDesc(value: string) { this.desc = value; return this; }
  setHeading() { return this; }
  addDropdown(cb: (control: MockControl) => void) { return this.addControl(cb); }
  addButton(cb: (control: MockControl) => void) { return this.addControl(cb); }
  addText(cb: (control: MockControl) => void) { return this.addControl(cb); }
  addTextArea(cb: (control: MockControl) => void) { return this.addControl(cb); }
  addToggle(cb: (control: MockControl) => void) { return this.addControl(cb); }
  private addControl(cb: (control: MockControl) => void) {
    const control = new MockControl(); this.controls.push(control); cb(control); return this;
  }
}
jest.mock('obsidian', () => ({ Setting: MockSetting }));
jest.mock('@/providers/grok/app/GrokWorkspaceServices', () => ({
  maybeGetGrokWorkspaceServices: () => mockCatalog ? { agentCatalog: mockCatalog } : null,
}));
jest.mock('@/features/settings/ui/EnvironmentSettingsSection', () => ({ renderEnvironmentSettingsSection: jest.fn() }));
jest.mock('@/providers/grok/modelOptions', () => ({ getGrokModelOptions: () => [{ value: 'grok-code', label: 'Grok' }] }));

import { grokSettingsTabRenderer } from '@/providers/grok/ui/GrokSettingsTab';

const report = { grokVersion: '1.0.34', projectTrusted: true, agents: [{ name: 'explore', description: 'Read only', source: { type: 'builtin' } }] };
function render(botName = '') {
  const bag = { model: 'unchanged', providerConfigs: { grok: { botName } } };
  const saveSettings = jest.fn().mockResolvedValue(undefined);
  const context = { plugin: { settings: bag, saveSettings }, refreshModelSelectors: jest.fn(), renderCustomContextLimits: jest.fn() };
  const container = { createDiv: () => ({ setText: jest.fn(), toggleClass: jest.fn() }) };
  grokSettingsTabRenderer.render(container as unknown as HTMLElement, context as unknown as ProviderSettingsTabRendererContext);
  return { bag, saveSettings };
}
function row(name: string) {
  const found = mockSettings.find(setting => setting.name === name);
  if (!found) throw new Error(`Missing setting: ${name}`);
  return found;
}

beforeEach(() => { mockSettings.length = 0; mockCatalog = null; });

describe('Grok bot settings', () => {
  it('does not offer ignored legacy agent-file, MCP-file, or thinking flags', () => {
    render();
    expect(mockSettings.some(setting => setting.name === 'Eigene Agenten-Datei')).toBe(false);
    expect(mockSettings.some(setting => setting.name === 'MCP-Konfigurationsdatei')).toBe(false);
    expect(mockSettings.some(setting => setting.name === 'Standardmäßig denken')).toBe(false);
    expect(row('Eigene Bots').desc).toContain('grok inspect --json');
    expect(row('Berechtigungen überspringen (YOLO)').desc).toContain('--always-approve');
  });
  it('loads discovery on opening and explains when workspace services are unavailable', async () => {
    render('explore');
    expect(row('Bot-Status').desc).toContain('nicht verfügbar');
    expect(row('Bots aktualisieren').controls[0].disabled).toBe(true);
    mockSettings.length = 0;
    const inspect = jest.fn().mockResolvedValue(JSON.stringify(report));
    mockCatalog = new GrokAgentCatalog({ runInspect: inspect });
    render('explore');
    expect(inspect).toHaveBeenCalledTimes(1);
    await mockCatalog.refresh();
    await Promise.resolve();
    expect(row('Grok-Bot').controls[0].options.explore).toBe('explore');
    expect(row('Bot-Status').desc).toContain('1 Bots gefunden');
  });
  it('rolls back only the bot on save failure and permits a retry', async () => {
    mockCatalog = new GrokAgentCatalog({ runInspect: async () => JSON.stringify(report) });
    await mockCatalog.refresh();
    const { bag, saveSettings } = render();
    saveSettings.mockRejectedValueOnce(new Error('secret-save-error'));
    const dropdown = row('Grok-Bot').controls[0];
    await dropdown.change('explore');
    expect(getGrokProviderSettings(bag).botName).toBe('');
    expect(dropdown.value).toBe('');
    expect(row('Bot-Status').desc).toContain('nicht gespeichert');
    expect(row('Bot-Status').desc).not.toContain('secret-save-error');
    await dropdown.change('explore');
    expect(getGrokProviderSettings(bag).botName).toBe('explore');
  });
  it('disables concurrent refreshes, reports failures safely, and refuses stale bot changes', async () => {
    const inspect = jest.fn().mockResolvedValue(JSON.stringify(report));
    mockCatalog = new GrokAgentCatalog({ runInspect: inspect });
    await mockCatalog.refresh();
    const { bag, saveSettings } = render('explore');
    let rejectInspect!: (error: Error) => void;
    inspect.mockImplementation(() => new Promise((_resolve, reject) => { rejectInspect = reject; }));
    const button = row('Bots aktualisieren').controls[0];
    const dropdown = row('Grok-Bot').controls[0];
    const pending = button.click();
    expect(button.disabled).toBe(true);
    expect(dropdown.disabled).toBe(true);
    expect(row('Bot-Status').desc).toContain('geladen');
    rejectInspect(new Error('MOONSHOT_API_KEY=secret-do-not-display'));
    await pending;
    expect(button.disabled).toBe(false);
    expect(row('Bot-Status').desc).toContain('fehlgeschlagen');
    expect(row('Bot-Status').desc).not.toContain('secret-do-not-display');
    await dropdown.change('explore');
    expect(saveSettings).not.toHaveBeenCalled();
    expect(getGrokProviderSettings(bag).botName).toBe('explore');
    await dropdown.change('');
    expect(getGrokProviderSettings(bag).botName).toBe('');
  });
  it('preserves a missing selection, refreshes the catalog, and reports trust without saving a fallback', async () => {
    const inspect = jest.fn().mockResolvedValue(JSON.stringify(report));
    mockCatalog = new GrokAgentCatalog({ runInspect: inspect });
    await mockCatalog.refresh();
    const { bag, saveSettings } = render('removed');
    const dropdown = row('Grok-Bot').controls[0];
    expect(dropdown.value).toBe('removed');
    expect(dropdown.options.removed).toContain('nicht verfügbar');
    expect(row('Bot-Status').desc).toContain('nicht verfügbar');
    inspect.mockResolvedValue(JSON.stringify({ ...report, projectTrusted: false, agents: [{ name: 'removed', source: { type: 'project' } }] }));
    await row('Bots aktualisieren').controls[0].click();
    expect(dropdown.value).toBe('removed');
    expect(dropdown.options.removed).not.toContain('nicht verfügbar');
    expect(row('Bot-Status').desc).toContain('nicht vertraut');
    expect(getGrokProviderSettings(bag).botName).toBe('removed');
    expect(saveSettings).not.toHaveBeenCalled();
  });
  it('offers discovered bots and explicitly persists selection without changing the model', async () => {
    mockCatalog = new GrokAgentCatalog({ runInspect: async () => JSON.stringify(report) });
    await mockCatalog.refresh();
    const { bag, saveSettings } = render();
    const dropdown = row('Grok-Bot').controls[0];
    expect(dropdown.options.explore).toContain('explore');
    expect(dropdown.options['']).toBe('CLI-Standard');
    await dropdown.change('explore');
    expect(getGrokProviderSettings(bag).botName).toBe('explore');
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(bag.model).toBe('unchanged');
  });
});
