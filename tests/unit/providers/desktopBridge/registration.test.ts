import { execFile, spawn } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import type ClaudianPlugin from '../../../../src/main';
import { desktopRegistration, desktopWorkspaceRegistration, saveDesktopSettings } from '../../../../src/providers/desktopBridge/registration';
import { getDesktopSettings } from '../../../../src/providers/desktopBridge/settings';
import { GROK_PROVIDER_ICON } from '../../../../src/shared/icons';

jest.mock('../../../../src/providers/desktopBridge/DesktopBridgeRuntime', () => ({ DesktopBridgeRuntime: jest.fn() }));
jest.mock('../../../../src/providers/desktopBridge/helper', () => ({ desktopAppPath: jest.fn() }));

jest.mock('child_process', () => ({ execFile: jest.fn(), spawn: jest.fn() }));

describe('desktop provider presentation', () => {
  it.each(['grok-bot', 'perplexity-chat'] as const)('%s renders explicit setup without launching or requesting anything', async id => {
    const plugin = { settings: {}, saveSettings: jest.fn() } as unknown as ClaudianPlugin;
    const services = await desktopWorkspaceRegistration(id).initialize({ plugin } as never);
    const container = { createEl: jest.fn() };
    services.settingsTabRenderer!.render(container as never, { plugin, refreshModelSelectors: jest.fn() } as never);
    const copy = container.createEl.mock.calls.map(call => call[1].text).join(' ');
    expect(copy).toContain('Grok-Build-CLI');
    expect(copy).toContain('kein OAuth/API');
    expect(copy).toContain('Nachrichtentext');
    expect(copy).toContain('nicht Computer');
    expect(copy).toContain('2000 UTF-16');
    expect(copy).toContain('Automatischer Memory-, Vault- und Graph-Kontext');
    expect(copy).toContain('nicht gekürzt');
    expect(copy).toContain('MCP-Tools');
    expect(execFile).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    for (const file of ['base/variables.css', 'components/tabs.css', 'features/dashboard.css', 'modals/model-select.css', 'components/messages.css', 'components/history.css']) {
      expect(readFileSync(resolve(process.cwd(), 'src/style', file), 'utf8')).toContain(`--claudian-brand-${id}`);
    }
  });
  it.each(['grok-bot', 'perplexity-chat'] as const)('%s is opt-in with an app-selected model and no auxiliary transport', async id => {
    const registration = desktopRegistration(id);
    const plugin = { settings: {}, saveSettings: jest.fn() } as unknown as ClaudianPlugin;
    expect(registration.isEnabled({})).toBe(false);
    expect(registration.defaultConfig).toMatchObject({ enabled: false, localTools: false, toolRoot: '', anchor: '' });
    expect(registration.chatUIConfig.ownsModel(`desktop:${id}`, {} as never)).toBe(true);
    expect(registration.chatUIConfig.ownsModel('grok', {} as never)).toBe(false);
    expect(registration.chatUIConfig.getContextWindowSize(`desktop:${id}`)).toBe(
      id === 'grok-bot' ? 500_000 : 200_000,
    );
    expect(registration.chatUIConfig.getContextWindowSize(`desktop:${id}`, {
      [`desktop:${id}`]: 128_000,
    })).toBe(128_000);
    await expect(registration.createAuxQueryRunner!(plugin).query({} as never, {} as never)).rejects.toThrow('keine versteckten Anfragen');
    const callback = jest.fn();
    await registration.createTitleGenerationService(plugin).generateTitle('chat', '  Lokaler Titel ', callback);
    expect(callback).toHaveBeenCalledWith('chat', { success: true, title: ' Lokaler Titel ' });
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });
  it.each(['grok-bot', 'perplexity-chat'] as const)('rolls back failed local tool opt-in and root saves for %s', async id => {
    const plugin = { settings: {}, saveSettings: jest.fn().mockRejectedValue(new Error('disk')) } as unknown as ClaudianPlugin;
    await expect(saveDesktopSettings(plugin, id, { localTools: true, toolRoot: '/fixture' })).rejects.toThrow('disk');
    expect(getDesktopSettings(plugin.settings, id)).toMatchObject({ localTools: false, toolRoot: '' });
  });
  it('uses a distinct Perplexity icon', () => {
    expect(desktopRegistration('perplexity-chat').chatUIConfig.getProviderIcon!()).not.toEqual(GROK_PROVIDER_ICON);
  });
  it('serializes saves and rolls back only the failed update', async () => {
    let release!: () => void;
    const saveSettings = jest.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined);
    const plugin = { settings: {}, saveSettings } as unknown as ClaudianPlugin;
    const first = saveDesktopSettings(plugin, 'grok-bot', { anchor: 'user supplied' });
    const second = saveDesktopSettings(plugin, 'grok-bot', { enabled: true });
    const failed = second.catch(error => error as Error);
    await Promise.resolve();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    release(); await first; expect((await failed as Error).message).toBe('disk');
    expect(getDesktopSettings(plugin.settings, 'grok-bot')).toMatchObject({ enabled: false, anchor: 'user supplied' });
    await saveDesktopSettings(plugin, 'perplexity-chat', { enabled: true });
    expect(getDesktopSettings(plugin.settings, 'perplexity-chat').enabled).toBe(true);
  });
});
