import {
  buildScreencaptureArgs,
  DEFAULT_APP_SHOT_HOTKEY,
  formatAppShotHotkey,
  isObsidianProcessName,
  parseFrontmostWindow,
  pickCaptureProcess,
  toElectronAccelerator,
} from '@/features/chat/services/appShotCapture';

describe('appShotCapture', () => {
  it('parses the frontmost-window AppleScript payload', () => {
    const parsed = parseFrontmostWindow('120,80,1440,900\tSafari\tStartseite');
    expect(parsed).toEqual({
      x: 120,
      y: 80,
      width: 1440,
      height: 900,
      appName: 'Safari',
      windowTitle: 'Startseite',
    });
  });

  it('rejects malformed payloads', () => {
    expect(parseFrontmostWindow('')).toBeNull();
    expect(parseFrontmostWindow('nope')).toBeNull();
    expect(parseFrontmostWindow('1,2,3\tSafari')).toBeNull();
  });

  it('prefers a non-Obsidian frontmost app, then the next visible app', () => {
    expect(pickCaptureProcess([
      { name: 'Safari', frontmost: true, windowCount: 1 },
      { name: 'Obsidian', frontmost: false, windowCount: 1 },
    ])).toBe('Safari');

    expect(pickCaptureProcess([
      { name: 'Obsidian', frontmost: true, windowCount: 2 },
      { name: 'Figma', frontmost: false, windowCount: 1 },
    ])).toBe('Figma');

    expect(pickCaptureProcess([
      { name: 'Obsidian', frontmost: true, windowCount: 1 },
    ])).toBe('Obsidian');
  });

  it('treats Electron hosts as the Obsidian process', () => {
    expect(isObsidianProcessName('Obsidian')).toBe(true);
    expect(isObsidianProcessName('Electron')).toBe(true);
    expect(isObsidianProcessName('Safari')).toBe(false);
  });

  it('builds a silent region capture for screencapture', () => {
    expect(buildScreencaptureArgs('/tmp/shot.png', {
      x: 10,
      y: 20,
      width: 800,
      height: 600,
    })).toEqual(['-x', '-R', '10,20,800,600', '/tmp/shot.png']);
  });

  it('formats the default hotkey differently from ChatGPT and as an Electron accelerator', () => {
    expect(DEFAULT_APP_SHOT_HOTKEY).toEqual({ modifiers: ['Mod', 'Shift'], key: '2' });
    expect(formatAppShotHotkey(DEFAULT_APP_SHOT_HOTKEY, 'darwin')).toBe('⌘⇧2');
    expect(formatAppShotHotkey(DEFAULT_APP_SHOT_HOTKEY, 'win32')).toBe('Ctrl+Shift+2');
    expect(toElectronAccelerator(DEFAULT_APP_SHOT_HOTKEY)).toBe('CommandOrControl+Shift+2');
  });
});
