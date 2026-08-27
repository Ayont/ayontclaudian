/**
 * Claudian Artifact System — adapted from Claude Code's Artifacts.
 *
 * Artifacts are self-contained interactive HTML pages that the AI generates
 * from the chat session. They are saved to the vault as .html files and can
 * be opened in the browser, embedded inline in chat, or shared.
 *
 * Use cases (from Claude Code docs):
 * - Walk through a PR/diff with annotations
 * - Render dashboards from session data
 * - Compare alternatives side by side
 * - Interactive controls (sliders, toggles)
 * - Investigation timelines
 * - Triage boards with export-to-prompt
 */

import { type App, normalizePath, TFile, TFolder } from 'obsidian';

/** The type of artifact the AI is generating. */
export type ArtifactKind =
  | 'diff-walkthrough'
  | 'dashboard'
  | 'comparison'
  | 'interactive-controls'
  | 'timeline'
  | 'triage-board'
  | 'custom';

const ARTIFACT_KINDS = new Set<ArtifactKind>([
  'diff-walkthrough',
  'dashboard',
  'comparison',
  'interactive-controls',
  'timeline',
  'triage-board',
  'custom',
]);

export interface ArtifactMeta {
  /** Unique slug-based identifier (also the filename stem). */
  id: string;
  /** Human-readable title shown in the header. */
  title: string;
  /** Emoji used as browser-tab icon and gallery badge. */
  icon: string;
  /** What kind of artifact this is. */
  kind: ArtifactKind;
  /** When the artifact was first created. */
  createdAt: number;
  /** When the artifact was last updated. */
  updatedAt: number;
  /** Version number — increments on each republish. */
  version: number;
  /** Source file path in the vault. */
  filePath: string;
}

export interface Artifact extends ArtifactMeta {
  /** The full HTML content of the artifact. */
  html: string;
}

/** Snapshot needed to restore a trashed artifact at its original path. */
export interface TrashedArtifact {
  filePath: string;
  html: string;
}

/** Default folder where artifacts are saved. */
export const DEFAULT_ARTIFACT_FOLDER = '.claudian/artifacts';

/**
 * Manages the lifecycle of artifacts: creating, updating, listing, and
 * opening them. Artifacts are stored as self-contained .html files in the
 * vault so they work offline and are version-controlled with git.
 */
export class ArtifactService {
  constructor(private readonly app: App, private readonly folder: string = DEFAULT_ARTIFACT_FOLDER) {}

  /**
   * Creates a new artifact from raw HTML content. Saves it to the vault and
   * returns the metadata + content. The HTML is wrapped in a self-contained
   * document shell with a strict CSP (no external requests).
   */
  async createArtifact(params: {
    title: string;
    icon?: string;
    kind?: ArtifactKind;
    html: string;
  }): Promise<Artifact> {
    const id = this.slugify(params.title);
    const now = Date.now();
    const filePath = `${this.folder}/${id}.html`;

    await this.ensureFolder();

    // Check if file already exists (republish scenario)
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    let version = 1;
    let createdAt = now;
    if (existing instanceof TFile) {
      createdAt = existing.stat.ctime;
      try {
        const oldContent = await this.app.vault.read(existing);
        const versionMatch = oldContent.match(/data-version="(\d+)"/);
        version = versionMatch ? parseInt(versionMatch[1], 10) + 1 : 2;
      } catch (error) {
        throw new Error(
          `Bestehendes Artifact konnte nicht gelesen werden: ${this.errorMessage(error)}`,
          error instanceof Error ? { cause: error } : undefined,
        );
      }
    } else if (existing) {
      throw new Error(`Artifact kann nicht gespeichert werden: ${filePath} ist kein Datei-Pfad.`);
    }

    const fullHtml = this.wrapHtml(
      params.html,
      params.title,
      params.icon ?? '📄',
      version,
      params.kind ?? 'custom',
    );
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, fullHtml);
    } else {
      await this.app.vault.create(filePath, fullHtml);
    }

    const meta: ArtifactMeta = {
      id,
      title: params.title,
      icon: params.icon ?? '📄',
      kind: params.kind ?? 'custom',
      createdAt,
      updatedAt: now,
      version,
      filePath,
    };

    return { ...meta, html: params.html };
  }

  /** Lists all artifacts in the vault folder, sorted by most recently updated. */
  async listArtifacts(): Promise<ArtifactMeta[]> {
    const folder = this.app.vault.getAbstractFileByPath(this.folder);
    if (!folder) return [];
    if (!(folder instanceof TFolder)) {
      throw new Error(`Artifact-Ordner ist ungültig: ${this.folder}`);
    }

    const artifacts: ArtifactMeta[] = [];
    let artifactFileCount = 0;
    let firstReadError: unknown;
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'html') {
        artifactFileCount += 1;
        try {
          const meta = await this.readArtifactMeta(child);
          if (meta) artifacts.push(meta);
        } catch (error) {
          firstReadError ??= error;
          // One damaged file must not hide the remaining gallery.
        }
      }
    }
    if (artifactFileCount > 0 && artifacts.length === 0 && firstReadError !== undefined) {
      const message = artifactFileCount === 1
        ? `Die Artifact-Datei konnte nicht gelesen werden: ${this.errorMessage(firstReadError)}`
        : `Keine der ${artifactFileCount} Artifact-Dateien konnte gelesen werden: ${this.errorMessage(firstReadError)}`;
      throw new Error(message, firstReadError instanceof Error ? { cause: firstReadError } : undefined);
    }
    return artifacts.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Opens an artifact in the system browser via Electron's shell API. */
  async openInBrowser(filePath: string): Promise<void> {
    this.assertArtifactPath(filePath);
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`Artifact nicht gefunden: ${filePath}`);
    }
    const adapter = this.app.vault.adapter as typeof this.app.vault.adapter & {
      getFullPath?: (path: string) => string;
    };
    const fullPath = adapter.getFullPath ? adapter.getFullPath(file.path) : file.path;
    const electronWindow = window as typeof window & {
      require?: (moduleName: 'electron') => {
        shell: { openPath: (path: string) => Promise<string> };
      };
    };
    if (!electronWindow.require) {
      throw new Error('Electron-Shell ist nicht verfügbar.');
    }

    const result = await electronWindow.require('electron').shell.openPath(fullPath);
    if (result) {
      throw new Error(`Artifact konnte nicht geöffnet werden: ${result}`);
    }
  }

  /** Reads an artifact's full HTML content. */
  async readArtifact(filePath: string): Promise<Artifact | null> {
    this.assertArtifactPath(filePath);
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return null;
    const html = await this.app.vault.read(file);
    const meta = await this.readArtifactMeta(file);
    if (!meta) return null;
    return { ...meta, html };
  }

  /** Moves an artifact to the configured Obsidian trash and returns an undo snapshot. */
  async deleteArtifact(filePath: string): Promise<TrashedArtifact> {
    this.assertArtifactPath(filePath);
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`Artifact nicht gefunden: ${filePath}`);
    }

    const html = await this.app.vault.read(file);
    await this.app.fileManager.trashFile(file);
    return { filePath, html };
  }

  /** Restores a previously trashed artifact without overwriting a newer file. */
  async restoreArtifact(artifact: TrashedArtifact): Promise<void> {
    this.assertArtifactPath(artifact.filePath);
    if (this.app.vault.getAbstractFileByPath(artifact.filePath)) {
      throw new Error(`Artifact kann nicht wiederhergestellt werden: ${artifact.filePath} ist bereits vorhanden.`);
    }

    await this.ensureFolder();
    await this.app.vault.create(artifact.filePath, artifact.html);
  }

  /**
   * Wraps raw HTML content in a self-contained document shell with:
   * - Strict CSP (no external requests)
   * - Embedded metadata (version, title, icon)
   * - Claudian artifact viewer styling
   * - Responsive viewport
   */
  wrapHtml(
    bodyHtml: string,
    title: string,
    icon: string,
    version: number = 1,
    kind: ArtifactKind = 'custom',
  ): string {
    const safeIcon = this.escapeHtml(icon);
    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:;">
<title>${safeIcon} ${this.escapeHtml(title)}</title>
<style>
:root {
  --bg: #0d0d0f;
  --surface: #18181b;
  --border: rgba(255,255,255,0.08);
  --text: #f4f4f5;
  --muted: #a1a1aa;
  --accent: #7c3aed;
  --accent-rgb: 124, 58, 237;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  padding: 0;
}
.artifact-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 32px;
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.15), rgba(var(--accent-rgb), 0.04));
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(12px);
}
.artifact-icon { font-size: 1.8em; }
.artifact-title { font-size: 1.3em; font-weight: 700; }
.artifact-version {
  margin-left: auto;
  font-size: 0.75em;
  color: var(--muted);
  padding: 4px 12px;
  border-radius: 100px;
  background: rgba(255,255,255,0.06);
}
.artifact-body { padding: 32px; max-width: 1100px; margin: 0 auto; }
@media (max-width: 768px) {
  .artifact-body { padding: 16px; }
  .artifact-header { padding: 16px; }
}
</style>
</head>
<body data-version="${version}" data-title="${this.escapeHtml(title)}" data-icon="${safeIcon}" data-kind="${kind}">
<div class="artifact-header">
  <span class="artifact-icon">${safeIcon}</span>
  <span class="artifact-title">${this.escapeHtml(title)}</span>
  <span class="artifact-version">v${version}</span>
</div>
<div class="artifact-body">
${bodyHtml}
</div>
</body>
</html>`;
  }

  private async readArtifactMeta(file: TFile): Promise<ArtifactMeta> {
    const content = await this.app.vault.read(file);
    if (!/<body(?:\s|>)/i.test(content)) {
      throw new Error(`Ungültiges Artifact-Dokument: ${file.path}`);
    }
    const titleMatch = content.match(/data-title="([^"]+)"/);
    const iconMatch = content.match(/data-icon="([^"]*)"/);
    const versionMatch = content.match(/data-version="(\d+)"/);
    const kindMatch = content.match(/data-kind="([^"]+)"/);
    const kind = kindMatch && ARTIFACT_KINDS.has(kindMatch[1] as ArtifactKind)
      ? kindMatch[1] as ArtifactKind
      : 'custom';

    return {
      id: file.basename,
      title: titleMatch ? this.unescapeHtml(titleMatch[1]) : file.basename,
      icon: iconMatch ? this.unescapeHtml(iconMatch[1]) : '📄',
      kind,
      createdAt: file.stat.ctime,
      updatedAt: file.stat.mtime,
      version: versionMatch ? parseInt(versionMatch[1], 10) : 1,
      filePath: file.path,
    };
  }

  private async ensureFolder(): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(this.folder);
    if (!existing) {
      await this.app.vault.createFolder(this.folder);
    } else if (!(existing instanceof TFolder)) {
      throw new Error(`Artifact-Ordner kann nicht erstellt werden: ${this.folder} ist bereits eine Datei.`);
    }
  }

  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `artifact-${Date.now()}`;
  }

  private assertArtifactPath(filePath: string): void {
    const folder = normalizePath(this.folder);
    const normalizedPath = normalizePath(filePath);
    const prefix = `${folder}/`;
    const relativePath = normalizedPath.startsWith(prefix)
      ? normalizedPath.slice(prefix.length)
      : '';
    if (!relativePath || relativePath.includes('/') || !relativePath.endsWith('.html')) {
      throw new Error(`Ungültiger Artifact-Pfad: ${filePath}`);
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private unescapeHtml(text: string): string {
    return text
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error && error.message.trim()
      ? error.message
      : 'Unbekannter Fehler';
  }
}
