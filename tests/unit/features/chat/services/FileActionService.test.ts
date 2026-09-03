/** @jest-environment jsdom */
import {
  copyFilePath,
  getFileManagerName,
  getPlatformName,
  openInDefaultApp,
  renderFileActionPill,
  resolveToAbsolutePath,
  revealInSystemFileManager,
  showFileContextMenu,
} from '@/features/chat/services/FileActionService';

describe('FileActionService', () => {
  let mockApp: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApp = {
      vault: {
        adapter: {
          getFullPath: jest.fn((p: string) => `/mock/vault/${p}`),
          getBasePath: jest.fn(() => '/mock/vault'),
          getResourcePath: jest.fn((p: string) => `app://obsidian.md/${p}`),
        },
        getAbstractFileByPath: jest.fn(),
        getFiles: jest.fn(() => []),
      },
      metadataCache: {
        getFirstLinkpathDest: jest.fn(),
      },
      workspace: {
        openLinkText: jest.fn(),
      },
    };
  });

  describe('getPlatformName and getFileManagerName', () => {
    it('returns a valid platform name', () => {
      const platform = getPlatformName();
      expect(['mac', 'windows', 'linux']).toContain(platform);
    });

    it('returns a user-friendly file manager name', () => {
      const name = getFileManagerName();
      expect(['Finder', 'Windows-Explorer', 'Dateimanager', 'File Manager']).toContain(name);
    });
  });

  describe('resolveToAbsolutePath', () => {
    it('returns absolute paths unchanged', () => {
      expect(resolveToAbsolutePath(mockApp, '/Users/test/file.png')).toBe('/Users/test/file.png');
      expect(resolveToAbsolutePath(mockApp, 'C:\\Users\\test\\file.png')).toBe('C:\\Users\\test\\file.png');
    });

    it('resolves vault-relative path using adapter getFullPath', () => {
      const resolved = resolveToAbsolutePath(mockApp, 'notes/doc.md');
      expect(resolved).toBe('/mock/vault/notes/doc.md');
      expect(mockApp.vault.adapter.getFullPath).toHaveBeenCalledWith('notes/doc.md');
    });

    it('strips file:// protocol and @ prefixes', () => {
      expect(resolveToAbsolutePath(mockApp, 'file:///var/log/app.log')).toBe('/var/log/app.log');
      expect(resolveToAbsolutePath(mockApp, '@/var/log/app.log')).toBe('/var/log/app.log');
    });
  });

  describe('copyFilePath', () => {
    it('copies relative path to navigator.clipboard', async () => {
      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

      await copyFilePath(mockApp, 'photos/pic.png', false);
      expect(writeTextMock).toHaveBeenCalledWith('photos/pic.png');
    });

    it('copies absolute path to clipboard when requested', async () => {
      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

      await copyFilePath(mockApp, 'photos/pic.png', true);
      expect(writeTextMock).toHaveBeenCalledWith('/mock/vault/photos/pic.png');
    });
  });

  describe('renderFileActionPill', () => {
    it('creates action pill with reveal, open, and copy buttons', () => {
      const container = document.createElement('div');
      const pill = renderFileActionPill(container, mockApp, 'notes/summary.md');

      expect(pill.classList.contains('claudian-file-action-pill')).toBe(true);
      const revealBtn = pill.querySelector('.claudian-file-action-btn--reveal');
      const openBtn = pill.querySelector('.claudian-file-action-btn--open');
      const copyBtn = pill.querySelector('.claudian-file-action-btn--copy');

      expect(revealBtn).not.toBeNull();
      expect(openBtn).not.toBeNull();
      expect(copyBtn).not.toBeNull();
    });
  });

  describe('showFileContextMenu', () => {
    it('safely handles mouse event without throwing', () => {
      const event: any = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        clientX: 100,
        clientY: 200,
      };

      expect(() => {
        showFileContextMenu(mockApp, event, 'images/test.png', { kind: 'image' });
      }).not.toThrow();

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });
});
