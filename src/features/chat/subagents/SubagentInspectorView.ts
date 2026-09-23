import { ItemView, MarkdownRenderer, Notice, TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type ClaudianPlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { revealInSystemFileManager } from '../services/FileActionService';
import { SubagentInspectorPanel } from './SubagentInspectorPanel';
import type { SubagentSource } from './subagentLocator';
import { subagentTitle } from './subagentPresentation';

export const VIEW_TYPE_SUBAGENT_INSPECTOR = 'claudian-subagent-inspector';

export interface SubagentInspectorState {
  subagentId: string;
  conversationId?: string | null;
}

function parseState(state: unknown): SubagentInspectorState | null {
  if (!state || typeof state !== 'object') return null;
  const record = state as Record<string, unknown>;
  if (typeof record.subagentId !== 'string' || !record.subagentId) return null;
  return {
    subagentId: record.subagentId,
    conversationId: typeof record.conversationId === 'string' ? record.conversationId : null,
  };
}

/**
 * A workspace tab that follows one subagent live. Its state (subagent and
 * conversation id) is saved with the workspace, so after a restart it shows
 * the stored run, and it reattaches as soon as that chat runs again.
 */
export class SubagentInspectorView extends ItemView {
  private state: SubagentInspectorState | null = null;
  private source: SubagentSource | null = null;
  private unsubscribe: (() => void) | null = null;
  private panel: SubagentInspectorPanel | null = null;
  private renderScheduled = false;
  private reconnecting = false;
  private closed = false;
  /** Bumped on every connect so a slower, older connect cannot win. */
  private connectGeneration = 0;
  private lastTitle = '';
  /** Until the first lookup finished, "not available" would be a false claim. */
  private resolved = false;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ClaudianPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SUBAGENT_INSPECTOR;
  }

  getDisplayText(): string {
    return this.lastTitle ? `Subagent · ${this.lastTitle}` : 'Subagent-Inspektor';
  }

  getIcon(): string {
    return 'bot';
  }

  getSubagentId(): string | null {
    return this.state?.subagentId ?? null;
  }

  getState(): Record<string, unknown> {
    return this.state ? { ...this.state } : {};
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const parsed = parseState(state);
    if (parsed && parsed.subagentId !== this.state?.subagentId) {
      this.state = parsed;
      await this.connect();
    }
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('claudian-inspector-view');
    this.panel = new SubagentInspectorPanel(this.contentEl, {
      onStop: () => {
        void this.source?.stop().then(() => this.scheduleRender());
      },
      onLocate: () => this.source?.locate?.(),
      onOpenFile: (path) => {
        void this.openFile(path);
      },
      renderMarkdown: (markdown, el) => {
        void MarkdownRenderer.render(this.app, markdown, el, '', this);
      },
    });
    this.registerInterval(window.setInterval(() => this.panel?.tick(), 1000));
    if (!this.state) this.resolved = true;
    if (this.state && !this.source) await this.connect();
    this.renderNow();
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.connectGeneration++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.panel?.destroy();
    this.panel = null;
  }

  private async connect(): Promise<void> {
    if (!this.state || this.closed) return;
    const generation = ++this.connectGeneration;
    const { subagentId, conversationId } = this.state;
    const source = await this.plugin.resolveSubagentSource(subagentId, conversationId);
    if (generation !== this.connectGeneration || this.closed) return;
    this.unsubscribe?.();
    this.source = source;
    this.unsubscribe = source ? source.subscribe(() => this.scheduleRender()) : null;
    this.resolved = true;
    this.renderNow();
  }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    window.requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (!this.panel || !this.resolved) return;
    const info = this.source?.getInfo();
    // The chat tab cleared or switched its conversation: read the saved run.
    if (!info && this.source?.live && !this.reconnecting) {
      this.reconnecting = true;
      void this.connect().finally(() => {
        this.reconnecting = false;
      });
      return;
    }
    const providerId = info?.providerId;
    this.panel.render(info, {
      live: this.source?.live ?? false,
      stopScope: this.source?.stopScope() ?? 'none',
      ...(providerId ? { providerLabel: ProviderRegistry.getProviderRegistrationSafe(providerId)?.displayName ?? providerId } : {}),
      ...(this.source?.conversationTitle ? { conversationTitle: this.source.conversationTitle } : {}),
    });
    const title = info ? subagentTitle(info) : '';
    if (title !== this.lastTitle) {
      this.lastTitle = title;
      // Not in the public typings, but present: refreshes the tab header text.
      (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
    }
  }

  /**
   * The file list comes from paths the agent wrote. Only an existing vault
   * file opens; anything else is at most shown in the file manager, never
   * opened with its default app (a written `~/x.command` must not run).
   */
  private async openFile(path: string): Promise<void> {
    const normalized = path.replace(/\\/g, '/');
    const vaultPath = (getVaultPath(this.app) ?? '').replace(/\\/g, '/').replace(/\/$/, '');
    const relative = vaultPath && normalized.startsWith(`${vaultPath}/`)
      ? normalized.slice(vaultPath.length + 1)
      : normalized.replace(/^\.\//, '');
    const file = this.app.vault.getAbstractFileByPath(relative);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf('tab').openFile(file);
      return;
    }
    const isAbsolute = normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized);
    if (isAbsolute && await revealInSystemFileManager(this.app, path)) return;
    new Notice(`Datei nicht gefunden: ${path}`);
  }
}
