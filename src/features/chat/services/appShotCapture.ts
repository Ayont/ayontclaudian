import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AppShotHotkey {
  modifiers: Array<'Mod' | 'Ctrl' | 'Alt' | 'Shift' | 'Meta'>;
  key: string;
}

export interface AppShotSettings {
  enabled: boolean;
  playSound: boolean;
  target: 'auto' | 'active-chat';
  hotkey: AppShotHotkey;
}

export const DEFAULT_APP_SHOT_HOTKEY: AppShotHotkey = {
  modifiers: ['Mod', 'Shift'],
  key: '2',
};

export const DEFAULT_APP_SHOT_SETTINGS: AppShotSettings = {
  enabled: true,
  playSound: true,
  target: 'auto',
  hotkey: DEFAULT_APP_SHOT_HOTKEY,
};

export interface FrontmostWindow {
  x: number;
  y: number;
  width: number;
  height: number;
  appName: string;
  windowTitle: string;
}

export interface VisibleProcess {
  name: string;
  frontmost: boolean;
  windowCount: number;
}

export interface AppShotCapture {
  png: Buffer;
  appName: string;
  windowTitle: string;
  bounds: FrontmostWindow;
  extractedText: string;
}

export function isObsidianProcessName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return lower === 'obsidian' || lower === 'electron';
}

export function pickCaptureProcess(processes: readonly VisibleProcess[]): string | null {
  const withWindows = processes.filter((process) => process.windowCount > 0);
  const front = withWindows.find((process) => process.frontmost);
  if (front && !isObsidianProcessName(front.name)) return front.name;
  const other = withWindows.find((process) => !isObsidianProcessName(process.name));
  if (other) return other.name;
  return front?.name ?? withWindows[0]?.name ?? null;
}

export function parseFrontmostWindow(raw: string): FrontmostWindow | null {
  const line = raw.trim();
  if (!line) return null;
  const [boundsPart, appName, ...titleParts] = line.split('\t');
  const nums = (boundsPart ?? '').split(',').map((part) => Number(part.trim()));
  if (nums.length !== 4 || nums.some((value) => !Number.isFinite(value))) return null;
  if (!appName?.trim()) return null;
  const [x, y, width, height] = nums;
  return {
    x,
    y,
    width,
    height,
    appName: appName.trim(),
    windowTitle: titleParts.join('\t').trim(),
  };
}

export function buildScreencaptureArgs(
  dest: string,
  bounds: Pick<FrontmostWindow, 'x' | 'y' | 'width' | 'height'>,
): string[] {
  const x = Math.round(bounds.x);
  const y = Math.round(bounds.y);
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  return ['-x', '-T0', '-t', 'png', '-R', `${x},${y},${width},${height}`, dest];
}

export function formatAppShotHotkey(
  hotkey: AppShotHotkey,
  platform: NodeJS.Platform | 'darwin' | 'win32' | 'linux',
): string {
  const isMac = platform === 'darwin';
  const labels = hotkey.modifiers.map((modifier) => {
    if (modifier === 'Mod') return isMac ? '⌘' : 'Ctrl';
    if (modifier === 'Meta') return isMac ? '⌘' : 'Win';
    if (modifier === 'Ctrl') return isMac ? '⌃' : 'Ctrl';
    if (modifier === 'Alt') return isMac ? '⌥' : 'Alt';
    if (modifier === 'Shift') return isMac ? '⇧' : 'Shift';
    return modifier;
  });
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
  return isMac ? `${labels.join('')}${key}` : [...labels, key].join('+');
}

export function toElectronAccelerator(hotkey: AppShotHotkey): string {
  const parts = hotkey.modifiers.map((modifier) => {
    if (modifier === 'Mod') return 'CommandOrControl';
    if (modifier === 'Meta') return 'Command';
    if (modifier === 'Ctrl') return 'Control';
    if (modifier === 'Alt') return 'Alt';
    if (modifier === 'Shift') return 'Shift';
    return modifier;
  });
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
  return [...parts, key].join('+');
}

export function resolveAppShotSettings(raw: unknown): AppShotSettings {
  const bag = raw && typeof raw === 'object' ? raw as Partial<AppShotSettings> : {};
  const hotkey = bag.hotkey && typeof bag.hotkey === 'object'
    ? {
        modifiers: Array.isArray(bag.hotkey.modifiers) && bag.hotkey.modifiers.length > 0
          ? bag.hotkey.modifiers
          : DEFAULT_APP_SHOT_HOTKEY.modifiers,
        key: typeof bag.hotkey.key === 'string' && bag.hotkey.key
          ? bag.hotkey.key
          : DEFAULT_APP_SHOT_HOTKEY.key,
      }
    : DEFAULT_APP_SHOT_HOTKEY;
  return {
    enabled: bag.enabled !== false,
    playSound: bag.playSound !== false,
    target: bag.target === 'active-chat' ? 'active-chat' : 'auto',
    hotkey,
  };
}

const FRONTMOST_SCRIPT = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set aname to name of frontApp as text
  if aname is "Obsidian" or aname is "Electron" then
    repeat with p in (application processes whose visible is true and background only is false)
      set pname to name of p as text
      if pname is not "Obsidian" and pname is not "Electron" then
        try
          if (count of windows of p) > 0 then
            set frontApp to p
            set aname to pname
            exit repeat
          end if
        end try
      end if
    end repeat
  end if
  tell frontApp
    set win to window 1
    set p to position of win
    set s to size of win
    return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text) & tab & aname & tab & (name of win as text)
  end tell
end tell
`.trim();

const TEXT_SCRIPT = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  try
    set focusedEl to value of attribute "AXFocusedUIElement" of frontApp
    return value of focusedEl as text
  on error
    try
      return value of text area 1 of window 1 of frontApp as text
    on error
      return ""
    end try
  end try
end tell
`.trim();

export async function captureFrontmostAppShot(): Promise<AppShotCapture> {
  if (process.platform !== 'darwin') {
    throw new Error('App Shots sind derzeit nur auf macOS verfügbar.');
  }

  const { stdout } = await execFileAsync('osascript', ['-e', FRONTMOST_SCRIPT], {
    timeout: 2500,
  });
  const window = parseFrontmostWindow(stdout);
  if (!window) {
    throw new Error('Konnte das vordere Fenster nicht lesen. Bildschirmaufnahme in den Systemeinstellungen erlauben.');
  }

  const dest = path.join(os.tmpdir(), `claudian-appshot-${Date.now()}.png`);
  try {
    await execFileAsync('screencapture', buildScreencaptureArgs(dest, window), { timeout: 4000 });
    const png = await fs.readFile(dest);
    if (png.length < 32) {
      throw new Error('Screenshot war leer.');
    }
    return { png, appName: window.appName, windowTitle: window.windowTitle, bounds: window, extractedText: '' };
  } finally {
    void fs.unlink(dest).catch(() => undefined);
  }
}

/** Accessibility scrape — not on the capture critical path. */
export async function extractFrontmostAppText(): Promise<string> {
  try {
    const text = await execFileAsync('osascript', ['-e', TEXT_SCRIPT], { timeout: 1500 });
    return text.stdout.trim().slice(0, 12_000);
  } catch {
    return '';
  }
}
