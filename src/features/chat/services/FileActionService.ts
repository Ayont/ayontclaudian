import { type App, Menu, Notice, setIcon, TFile } from 'obsidian';

import { getLocale } from '../../../i18n/i18n';
import { getMediaKindFromPath, openMediaModal } from '../rendering/MediaActivityRenderer';

export interface FileActionOptions {
  kind?: string;
  fileName?: string;
  sourceEl?: HTMLElement;
}

/**
 * Returns Electron shell if running inside Obsidian desktop.
 */
function getElectronShell(): {
  showItemInFolder: (fullPath: string) => void;
  openPath: (path: string) => Promise<string>;
  openExternal: (url: string) => Promise<void>;
} | null {
  try {
    const electronWindow = window as unknown as {
      require?: (mod: string) => { shell?: any };
    };
    return electronWindow.require?.('electron')?.shell ?? null;
  } catch {
    return null;
  }
}

/**
 * Detects whether the current operating system is macOS, Windows, or Linux.
 */
export function getPlatformName(): 'mac' | 'windows' | 'linux' {
  if (typeof navigator !== 'undefined') {
    const userAgent = navigator.userAgent.toLowerCase();
    const platform = (navigator.platform || '').toLowerCase();
    if (platform.includes('mac') || userAgent.includes('macintosh')) return 'mac';
    if (platform.includes('win') || userAgent.includes('windows')) return 'windows';
  }
  return 'linux';
}

export function getFileManagerName(): string {
  const platform = getPlatformName();
  if (platform === 'mac') return 'Finder';
  if (platform === 'windows') return 'Windows-Explorer';
  return getLocale() === 'de' ? 'Dateimanager' : 'File Manager';
}

/**
 * Resolves any target path (vault-relative, link text, bare filename, or absolute)
 * into a definitive absolute filesystem path on disk.
 */
export function resolveToAbsolutePath(app: App, targetPath: string): string {
  if (!targetPath) return '';
  let clean = targetPath.trim().replace(/^@/, '').replace(/^file:\/\//i, '');

  // Strip query strings or hash
  clean = clean.split('?')[0].split('#')[0];

  // If already an absolute path
  if (clean.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(clean)) {
    return clean;
  }

  // Check Obsidian metadata cache for link destination or vault file
  const destFile = app.metadataCache?.getFirstLinkpathDest?.(clean, '')
    ?? app.vault?.getAbstractFileByPath?.(clean);

  const vaultPath = destFile instanceof TFile ? destFile.path : clean;

  const adapter = app.vault.adapter as typeof app.vault.adapter & {
    getFullPath?: (path: string) => string;
    getBasePath?: () => string;
  };

  if (typeof adapter.getFullPath === 'function') {
    return adapter.getFullPath(vaultPath);
  }

  if (typeof adapter.getBasePath === 'function') {
    const basePath = adapter.getBasePath().replace(/[\\/]+$/, '');
    return `${basePath}/${vaultPath.replace(/^[\\/]+/, '')}`;
  }

  return vaultPath;
}

/**
 * Reveals a file or folder in macOS Finder, Windows Explorer, or Linux File Manager.
 */
export async function revealInSystemFileManager(app: App, targetPath: string): Promise<boolean> {
  const fullPath = resolveToAbsolutePath(app, targetPath);
  const shell = getElectronShell();
  const fileManager = getFileManagerName();
  const isDe = getLocale() === 'de';

  if (shell && fullPath) {
    try {
      shell.showItemInFolder(fullPath);
      new Notice(isDe ? `Im ${fileManager} hervorgehoben` : `Revealed in ${fileManager}`);
      return true;
    } catch {
      // Fall through to adapter fallback
    }
  }

  // Obsidian vault fallback
  try {
    const destFile = app.metadataCache?.getFirstLinkpathDest?.(targetPath, '')
      ?? app.vault?.getAbstractFileByPath?.(targetPath);
    if (destFile instanceof TFile) {
      const showInFolder = (app as unknown as { showInFolder?: (p: string) => void }).showInFolder;
      if (typeof showInFolder === 'function') {
        showInFolder(destFile.path);
        new Notice(isDe ? `Im ${fileManager} hervorgehoben` : `Revealed in ${fileManager}`);
        return true;
      }
    }
  } catch {
    // Best-effort
  }

  new Notice(isDe ? `Konnte ${fileManager} nicht öffnen` : `Could not open ${fileManager}`);
  return false;
}

/**
 * Opens a file with the system default application (e.g. Quick Look, Preview, Default Editor).
 */
export async function openInDefaultApp(app: App, targetPath: string): Promise<boolean> {
  const fullPath = resolveToAbsolutePath(app, targetPath);
  const shell = getElectronShell();
  const isDe = getLocale() === 'de';

  if (shell && fullPath) {
    try {
      const errorMsg = await shell.openPath(fullPath);
      if (!errorMsg) {
        new Notice(isDe ? 'Mit Standard-App geöffnet' : 'Opened with default app');
        return true;
      }
    } catch {
      // Fallback
    }
  }

  // Fallback for media files: open in Claudian modal
  const kind = getMediaKindFromPath(targetPath);
  if (kind) {
    const fileName = targetPath.split(/[\\/]/).pop() || targetPath;
    const adapter = app.vault.adapter as typeof app.vault.adapter & { getResourcePath?: (p: string) => string };
    const src = adapter.getResourcePath ? adapter.getResourcePath(targetPath) : `file://${encodeURI(fullPath)}`;
    openMediaModal({
      src,
      title: fileName,
      kind,
    });
    return true;
  }

  // Fallback: open inside Obsidian if in vault
  const destFile = app.metadataCache?.getFirstLinkpathDest?.(targetPath, '')
    ?? app.vault?.getAbstractFileByPath?.(targetPath);
  if (destFile instanceof TFile) {
    await app.workspace.openLinkText(destFile.path, '', 'tab');
    return true;
  }

  return false;
}

/**
 * Copies the file path to the clipboard.
 */
export async function copyFilePath(app: App, targetPath: string, copyAbsolute = false): Promise<void> {
  const isDe = getLocale() === 'de';
  const pathToCopy = copyAbsolute ? resolveToAbsolutePath(app, targetPath) : targetPath;
  try {
    await navigator.clipboard.writeText(pathToCopy);
    const fileName = targetPath.split(/[\\/]/).pop() || targetPath;
    new Notice(isDe ? `Pfad kopiert: ${fileName}` : `Path copied: ${fileName}`);
  } catch {
    new Notice(isDe ? 'Konnte Pfad nicht kopieren' : 'Could not copy path');
  }
}

/**
 * Displays a contextual menu with file management options on right-click.
 */
export function showFileContextMenu(
  app: App,
  event: MouseEvent,
  targetPath: string,
  options: FileActionOptions = {},
): void {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  const isDe = getLocale() === 'de';
  const fileManager = getFileManagerName();
  const fileName = options.fileName || targetPath.split(/[\\/]/).pop() || targetPath;
  const kind = options.kind || getMediaKindFromPath(targetPath);

  const menu = new Menu();

  // 1. Quick Look / Preview for media files
  if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') {
    menu.addItem((item) => {
      item.setTitle(isDe ? 'Quick Look / Vollbild' : 'Quick Look / Preview')
        .setIcon('maximize-2')
        .onClick(() => {
          void openInDefaultApp(app, targetPath);
        });
    });
  }

  // 2. Open in Finder / Windows Explorer
  menu.addItem((item) => {
    item.setTitle(isDe ? `Im ${fileManager} anzeigen` : `Reveal in ${fileManager}`)
      .setIcon('folder')
      .onClick(() => {
        void revealInSystemFileManager(app, targetPath);
      });
  });

  // 3. Open with default app (External Preview / Script runner)
  menu.addItem((item) => {
    item.setTitle(isDe ? 'Mit Standard-App öffnen' : 'Open in Default App')
      .setIcon('external-link')
      .onClick(() => {
        void openInDefaultApp(app, targetPath);
      });
  });

  // 4. Open in Obsidian (if available in vault)
  const destFile = app.metadataCache?.getFirstLinkpathDest?.(targetPath, '')
    ?? app.vault?.getAbstractFileByPath?.(targetPath);
  if (destFile instanceof TFile) {
    menu.addItem((item) => {
      item.setTitle(isDe ? 'In Obsidian öffnen' : 'Open in Obsidian')
        .setIcon('file-text')
        .onClick(() => {
          void app.workspace.openLinkText(destFile.path, '', 'tab');
        });
    });
  }

  menu.addSeparator();

  // 5. Copy file path
  menu.addItem((item) => {
    item.setTitle(isDe ? 'Dateipfad kopieren' : 'Copy File Path')
      .setIcon('copy')
      .onClick(() => {
        void copyFilePath(app, targetPath, false);
      });
  });

  menu.addItem((item) => {
    item.setTitle(isDe ? 'Absoluten Pfad kopieren' : 'Copy Absolute Path')
      .setIcon('clipboard')
      .onClick(() => {
        void copyFilePath(app, targetPath, true);
      });
  });

  menu.showAtMouseEvent(event);
}

/**
 * Renders an Apple Liquid style compact action button cluster next to a file or in a toolbar.
 */
export function renderFileActionPill(
  container: HTMLElement,
  app: App,
  targetPath: string,
  options: FileActionOptions = {},
): HTMLElement {
  const isDe = getLocale() === 'de';
  const fileManager = getFileManagerName();

  const doc = container.ownerDocument || document;
  const pill = (typeof container.createDiv === 'function')
    ? container.createDiv({ cls: 'claudian-file-action-pill' })
    : (() => {
        const div = doc.createElement('div');
        div.className = 'claudian-file-action-pill';
        container.appendChild(div);
        return div;
      })();

  const createButton = (cls: string, label: string): HTMLButtonElement => {
    if (typeof pill.createEl === 'function') {
      return pill.createEl('button', {
        cls,
        attr: { type: 'button', 'aria-label': label, title: label },
      }) as HTMLButtonElement;
    }
    const btn = doc.createElement('button');
    btn.className = cls;
    btn.type = 'button';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    pill.appendChild(btn);
    return btn;
  };

  // 1. Reveal in Finder / Explorer
  const revealBtn = createButton(
    'claudian-file-action-btn claudian-file-action-btn--reveal',
    isDe ? `Im ${fileManager} anzeigen` : `Reveal in ${fileManager}`,
  );
  setIcon(revealBtn, 'folder');
  revealBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void revealInSystemFileManager(app, targetPath);
  });

  // 2. Open with default app / Quick Look
  const openBtn = createButton(
    'claudian-file-action-btn claudian-file-action-btn--open',
    isDe ? 'Mit Standard-App öffnen' : 'Open in Default App',
  );
  setIcon(openBtn, 'external-link');
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void openInDefaultApp(app, targetPath);
  });

  // 3. Copy path
  const copyBtn = createButton(
    'claudian-file-action-btn claudian-file-action-btn--copy',
    isDe ? 'Pfad kopieren' : 'Copy path',
  );
  setIcon(copyBtn, 'copy');
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await copyFilePath(app, targetPath, false);
    if (typeof copyBtn.addClass === 'function') copyBtn.addClass('is-copied');
    else copyBtn.classList.add('is-copied');
    window.setTimeout(() => {
      if (typeof copyBtn.removeClass === 'function') copyBtn.removeClass('is-copied');
      else copyBtn.classList.remove('is-copied');
    }, 1500);
  });

  // Context menu on right-click on the pill itself
  pill.addEventListener('contextmenu', (e) => {
    showFileContextMenu(app, e, targetPath, options);
  });

  return pill;
}
