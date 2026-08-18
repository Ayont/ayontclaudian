import {
  type AppShotHotkey,
  resolveAppShotSettings,
  toElectronAccelerator,
} from './appShotCapture';

interface GlobalShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  isRegistered?(accelerator: string): boolean;
}

let registeredAccelerator: string | null = null;

function getGlobalShortcutApi(): GlobalShortcutApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron globalShortcut is only on the Obsidian renderer.
    const electron = require('electron') as {
      globalShortcut?: GlobalShortcutApi;
      remote?: { globalShortcut?: GlobalShortcutApi };
    };
    return electron.globalShortcut ?? electron.remote?.globalShortcut ?? null;
  } catch {
    return null;
  }
}

export function registerAppShotGlobalHotkey(
  hotkey: AppShotHotkey,
  enabled: boolean,
  onFire: () => void,
): boolean {
  const api = getGlobalShortcutApi();
  if (!api) return false;
  if (registeredAccelerator) {
    try {
      api.unregister(registeredAccelerator);
    } catch {
      // already gone
    }
    registeredAccelerator = null;
  }
  if (!enabled) return false;
  const accelerator = toElectronAccelerator(hotkey);
  try {
    const ok = api.register(accelerator, onFire);
    if (ok) registeredAccelerator = accelerator;
    return ok;
  } catch {
    return false;
  }
}

export function unregisterAppShotGlobalHotkey(): void {
  if (!registeredAccelerator) return;
  const api = getGlobalShortcutApi();
  try {
    api?.unregister(registeredAccelerator);
  } catch {
    // teardown is best-effort
  }
  registeredAccelerator = null;
}

export function currentAppShotAccelerator(): string | null {
  return registeredAccelerator;
}

export function settingsToHotkey(raw: unknown): { hotkey: AppShotHotkey; enabled: boolean } {
  const settings = resolveAppShotSettings(raw);
  return { hotkey: settings.hotkey, enabled: settings.enabled };
}
