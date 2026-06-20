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

import { type App, Notice, TFile } from 'obsidian';

/** The type of artifact the AI is generating. */
export type ArtifactKind =
  | 'diff-walkthrough'
  | 'dashboard'
  | 'comparison'
  | 'interactive-controls'
  | 'timeline'
  | 'triage-board'
  | 'custom';

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
    const fullHtml = this.wrapHtml(params.html, params.title, params.icon ?? '📄');

    await this.ensureFolder();

    // Check if file already exists (republish scenario)
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    let version = 1;
    if (existing instanceof TFile) {
      // Read existing meta to increment version
      try {
        const oldContent = await this.app.vault.read(existing);
        const versionMatch = oldContent.match(/data-version="(\d+)"/);
        if (versionMatch) version = parseInt(versionMatch[1], 10) + 1;
      } catch {
        // New version 1 if we can't read
      }
      await this.app.vault.modify(existing, fullHtml);
    } else {
      await this.app.vault.create(filePath, fullHtml);
    }

    const meta: ArtifactMeta = {
      id,
      title: params.title,
      icon: params.icon ?? '📄',
      kind: params.kind ?? 'custom',
      createdAt: now,
      updatedAt: now,
      version,
      filePath,
    };

    return { ...meta, html: params.html };
  }

  /** Lists all artifacts in the vault folder, sorted by most recently updated. */
  async listArtifacts(): Promise<ArtifactMeta[]> {
    const folder = this.app.vault.getAbstractFileByPath(this.folder);
    if (!folder || !('children' in folder)) return [];

    const artifacts: ArtifactMeta[] = [];
    for (const child of (folder as any).children) {
      if (child instanceof TFile && child.extension === 'html') {
        const meta = await this.readArtifactMeta(child);
        if (meta) artifacts.push(meta);
      }
    }
    return artifacts.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Opens an artifact in the system browser via Electron's shell API. */
  async openInBrowser(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      new Notice(`Artifact not found: ${filePath}`);
      return;
    }
    // Get the absolute filesystem path and open it via Electron shell
    const adapter = this.app.vault.adapter as any;
    const fullPath = adapter.getFullPath ? adapter.getFullPath(file.path) : file.path;
    try {
      const electron = (window as any).require('electron');
      await electron.shell.openPath(fullPath);
    } catch {
      new Notice(`Could not open artifact. File: ${fullPath}`);
    }
  }

  /** Reads an artifact's full HTML content. */
  async readArtifact(filePath: string): Promise<Artifact | null> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return null;
    const html = await this.app.vault.read(file);
    const meta = await this.readArtifactMeta(file);
    if (!meta) return null;
    return { ...meta, html };
  }

  /** Deletes an artifact file from the vault. */
  async deleteArtifact(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.app.vault.delete(file);
    }
  }

  /**
   * Wraps raw HTML content in a self-contained document shell with:
   * - Strict CSP (no external requests)
   * - Embedded metadata (version, title, icon)
   * - Claudian artifact viewer styling
   * - Responsive viewport
   */
  wrapHtml(bodyHtml: string, title: string, icon: string, version: number = 1): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:;">
<title>${icon} ${this.escapeHtml(title)}</title>
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
<body data-version="${version}" data-title="${this.escapeHtml(title)}" data-icon="${icon}">
<div class="artifact-header">
  <span class="artifact-icon">${icon}</span>
  <span class="artifact-title">${this.escapeHtml(title)}</span>
  <span class="artifact-version">v${version}</span>
</div>
<div class="artifact-body">
${bodyHtml}
</div>
</body>
</html>`;
  }

  private async readArtifactMeta(file: TFile): Promise<ArtifactMeta | null> {
    try {
      const content = await this.app.vault.read(file);
      const titleMatch = content.match(/data-title="([^"]+)"/);
      const iconMatch = content.match(/data-icon="([^"]*)"/);
      const versionMatch = content.match(/data-version="(\d+)"/);

      return {
        id: file.basename,
        title: titleMatch ? titleMatch[1] : file.basename,
        icon: iconMatch ? iconMatch[1] : '📄',
        kind: 'custom',
        createdAt: file.stat.ctime,
        updatedAt: file.stat.mtime,
        version: versionMatch ? parseInt(versionMatch[1], 10) : 1,
        filePath: file.path,
      };
    } catch {
      return null;
    }
  }

  private async ensureFolder(): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(this.folder);
    if (!existing) {
      await this.app.vault.createFolder(this.folder);
    }
  }

  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `artifact-${Date.now()}`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
