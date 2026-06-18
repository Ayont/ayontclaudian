// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from './utils/electronCompat';
patchSetMaxListenersForElectron();

import './providers';

import * as path from 'node:path';

import type { Editor, WorkspaceLeaf } from 'obsidian';
import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';

import { DEFAULT_CLAUDIAN_SETTINGS } from './app/settings/defaultSettings';
import { SharedStorageService } from './app/storage/SharedStorageService';
import { PluginUpdater } from './app/update/PluginUpdater';
import type { SharedAppStorage } from './core/bootstrap/storage';
import { TokenBudgetTracker } from './core/budget/tokenBudget';
import {
  type ComparisonEntry,
  type ComparisonOutcome,
  formatComparisonMarkdown,
  runModelComparison,
} from './core/compare/modelComparison';
import {
  formatSmartContextMentions,
  rankSmartContextCandidates,
  type SmartContextFile,
} from './core/context/smartContext';
import { buildDiagnosticsMarkdown } from './core/diagnostics/buildDiagnostics';
import { getErrorHistory } from './core/diagnostics/errorHistory';
import {
  firstOutputLine,
  formatHealthReportMarkdown,
  type HealthCheckResult,
  probeCli,
} from './core/diagnostics/providerHealthCheck';
import {
  deleteMemory,
  ensureMemoryFolder,
  formatMemoryContext,
  loadMemoryNotes,
  rankMemoryNotes,
  storeMemory,
} from './core/memory/memoryService';
import { getProviderForModel } from './core/providers/modelRouting';
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
  setEnvironmentVariablesForScope,
} from './core/providers/providerEnvironment';
import { ProviderRegistry } from './core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from './core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from './core/providers/ProviderWorkspaceRegistry';
import type { ProviderId } from './core/providers/types';
import type { AppTabManagerState } from './core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from './core/providers/types';
import {
  chooseModelRoute,
  type ModelRouterRule,
  type ModelRouterTask,
  normalizeRouterRules,
} from './core/routing/modelRouterRules';
import { formatRunTimelineMarkdown, getLastRunTimeline } from './core/timeline/runTimeline';
import type {
  ClaudianSettings,
  Conversation,
  ConversationMeta,
} from './core/types';
import {
  VIEW_TYPE_CLAUDIAN,
} from './core/types';
import type { ChatViewPlacement, EnvironmentScope } from './core/types/settings';
import {
  expandWorkflow,
  parseWorkflowFile,
  type PromptWorkflow,
  serializeWorkflow,
  WORKFLOW_FOLDER,
  workflowPathForName,
} from './core/workflows/promptWorkflows';
import { ClaudianView } from './features/chat/ClaudianView';
import { ModelSelectModal } from './features/chat/ui/ModelSelectModal';
import { ProviderStatusBar } from './features/chat/ui/ProviderStatusBar';
import { type InlineEditContext, InlineEditModal } from './features/inline-edit/ui/InlineEditModal';
import { ClaudianSettingTab } from './features/settings/ClaudianSettings';
import { setLocale } from './i18n/i18n';
import type { Locale } from './i18n/types';
import { OPENCODE_PLAN_MODE_ID, OPENCODE_SAFE_MODE_ID } from './providers/opencode/modes';
import { extractUserDisplayContent } from './utils/context';
import { buildCursorContext } from './utils/editor';
import { getEnhancedPath } from './utils/env';
import { revealWorkspaceLeaf } from './utils/obsidianCompat';
import { getVaultPath } from './utils/path';

function isClaudianView(value: unknown): value is ClaudianView {
  return !!value
    && typeof value === 'object'
    && typeof (value as { getTabManager?: unknown }).getTabManager === 'function';
}

export default class ClaudianPlugin extends Plugin {
  settings!: ClaudianSettings;
  private providerStatusBar: ProviderStatusBar | null = null;
  private pluginUpdater: PluginUpdater | null = null;
  storage!: SharedAppStorage;
  private conversations: Conversation[] = [];
  private lastKnownTabManagerState: AppTabManagerState | null = null;
  tokenBudgetTracker = new TokenBudgetTracker();

  async onload() {
    await this.loadSettings();
    await ProviderWorkspaceRegistry.initializeAll(this);

    this.registerView(
      VIEW_TYPE_CLAUDIAN,
      (leaf) => new ClaudianView(leaf, this)
    );

    this.addRibbonIcon('bot', 'Open Claudian', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-view',
      name: 'Open chat view',
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: 'inline-edit',
      name: 'Inline edit',
      editorCallback: async (editor: Editor, ctx) => {
        const view = ctx instanceof MarkdownView
          ? ctx
          : this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
          new Notice('Inline edit unavailable: could not access the active Markdown view.');
          return;
        }

        const selectedText = editor.getSelection();
        const notePath = view.file?.path || 'unknown';

        let editContext: InlineEditContext;
        if (selectedText.trim()) {
          editContext = { mode: 'selection', selectedText };
        } else {
          const cursor = editor.getCursor();
          const cursorContext = buildCursorContext(
            (line) => editor.getLine(line),
            editor.lineCount(),
            cursor.line,
            cursor.ch
          );
          editContext = { mode: 'cursor', cursorContext };
        }

        const modal = new InlineEditModal(
          this.app,
          this,
          editor,
          view,
          editContext,
          notePath,
          () => this.getView()?.getActiveTab()?.ui.externalContextSelector?.getExternalContexts() ?? []
        );
        const result = await modal.openAndWait();

        if (result.decision === 'accept' && result.editedText !== undefined) {
          new Notice(editContext.mode === 'cursor' ? 'Inserted' : 'Edit applied');
        }
      },
    });

    this.addCommand({
      id: 'new-tab',
      name: 'New tab',
      checkCallback: (checking: boolean) => {
        if (!this.canCreateNewTab()) return false;

        if (!checking) {
          void this.openNewTab();
        }
        return true;
      },
    });

    this.addCommand({
      id: 'new-session',
      name: 'New session (in current tab)',
      checkCallback: (checking: boolean) => {
        const view = this.getView();
        if (!view) return false;

        const tabManager = view.getTabManager();
        if (!tabManager) return false;

        const activeTab = tabManager.getActiveTab();
        if (!activeTab) return false;

        if (activeTab.state.isStreaming) return false;

        if (!checking) {
          void tabManager.createNewConversation();
        }
        return true;
      },
    });

    this.addCommand({
      id: 'close-current-tab',
      name: 'Close current tab',
      checkCallback: (checking: boolean) => {
        const view = this.getView();
        if (!view) return false;

        const tabManager = view.getTabManager();
        if (!tabManager) return false;

        if (!checking) {
          const activeTabId = tabManager.getActiveTabId();
          if (activeTabId) {
            void tabManager.closeTab(activeTabId);
          }
        }
        return true;
      },
    });

    this.addCommand({
      id: 'check-for-update',
      name: 'Check for update',
      callback: () => {
        void this.pluginUpdater?.notifyIfUpdateAvailable().then(() => {
          if (!this.pluginUpdater) return;
          void this.pluginUpdater.checkForUpdate().then((update) => {
            if (!update) {
              new Notice('Ayontclaudian ist auf dem neuesten stand.');
            }
          });
        });
      },
    });

    this.addCommand({
      id: 'toggle-auto-mode',
      name: 'Toggle auto mode (double YOLO)',
      callback: () => {
        void this.toggleAutoMode();
      },
    });

    this.addCommand({
      id: 'check-provider-health',
      name: 'Check provider health',
      callback: () => {
        void this.checkProvidersHealth();
      },
    });

    this.addCommand({
      id: 'compare-models',
      name: 'Compare models (current input)',
      callback: () => {
        void this.compareModels();
      },
    });

    this.addCommand({
      id: 'copy-diagnostics',
      name: 'Copy diagnostics',
      callback: () => {
        void this.copyDiagnostics();
      },
    });

    this.addCommand({
      id: 'show-run-timeline',
      name: 'Show last run timeline',
      callback: () => {
        void this.showLastRunTimeline();
      },
    });

    this.addCommand({
      id: 'apply-model-router',
      name: 'Apply model router to current input',
      callback: () => {
        void this.applyModelRouterToCurrentInput();
      },
    });

    this.addCommand({
      id: 'create-workflow-from-input',
      name: 'Create workflow from current input',
      callback: () => {
        void this.createWorkflowFromCurrentInput();
      },
    });

    this.addCommand({
      id: 'suggest-smart-context',
      name: 'Suggest context for current input',
      callback: () => {
        void this.suggestSmartContextForCurrentInput();
      },
    });

    this.addCommand({
      id: 'store-memory',
      name: 'Store memory',
      editorCallback: async (editor: Editor) => {
        const selectedText = editor.getSelection().trim();
        const topic = selectedText ? selectedText.split('\n')[0].slice(0, 60) : 'Untitled memory';
        const content = selectedText || '';
        try {
          const folder = this.settings.memoryFolder ?? '.claudian/memory';
          await ensureMemoryFolder(this.app.vault, folder);
          const filePath = await storeMemory(this.app.vault, folder, topic, content);
          new Notice(`Memory stored: ${filePath}`);
        } catch (error) {
          new Notice(`Failed to store memory: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    });

    this.addCommand({
      id: 'recall-memories',
      name: 'Recall memories for current input',
      callback: () => {
        void this.recallMemoriesForCurrentInput();
      },
    });

    this.addCommand({
      id: 'forget-memory',
      name: 'Forget memory',
      callback: () => {
        void this.forgetMemory();
      },
    });

    this.addCommand({
      id: 'reset-token-budget',
      name: 'Reset token budget',
      callback: () => {
        this.tokenBudgetTracker.resetSession();
        this.tokenBudgetTracker.resetDaily();
        new Notice('Token budget reset.');
      },
    });

    this.addCommand({
      id: 'show-token-budget',
      name: 'Show token budget status',
      callback: () => {
        const state = this.tokenBudgetTracker.getState();
        const daily = this.settings.dailyTokenBudget ?? 0;
        const session = this.settings.sessionTokenBudget ?? 0;
        const dailyText = daily > 0 ? `${state.dailyTotal.toLocaleString()} / ${daily.toLocaleString()}` : `${state.dailyTotal.toLocaleString()} (no limit)`;
        const sessionText = session > 0 ? `${state.sessionTotal.toLocaleString()} / ${session.toLocaleString()}` : `${state.sessionTotal.toLocaleString()} (no limit)`;
        new Notice(`Tokens today: ${dailyText}\nTokens this session: ${sessionText}`);
      },
    });

    this.addSettingTab(new ClaudianSettingTab(this.app, this));

    // Status-bar item: active provider, set-up/auth state, and context usage %.
    this.providerStatusBar = new ProviderStatusBar(this.addStatusBarItem());
    this.updateProviderStatusBar();

    // In-app updater: notify once shortly after load if a GitHub release is newer.
    this.pluginUpdater = new PluginUpdater(this);
    window.setTimeout(() => {
      void this.pluginUpdater?.notifyIfUpdateAvailable();
    }, 30_000);
  }

  onunload(): void {
    this.providerStatusBar?.destroy();
    this.providerStatusBar = null;
    this.pluginUpdater = null;
    void this.persistOpenTabStates();
    void this.persistOpenConversations();
  }

  /**
   * Refreshes the status-bar item from the active chat tab: which provider is
   * active, whether it is set up/ready (enabled + CLI resolves), and the current
   * context-window usage percent. No-op until the status bar exists.
   */
  /**
   * Probes each configured provider's CLI with `--version` in parallel, copies a
   * Markdown health report to the clipboard, and shows a reachable/total summary.
   */
  async checkProvidersHealth(): Promise<void> {
    const settingsBag = this.settings as unknown as Record<string, unknown>;
    const cwd = getVaultPath(this.app) ?? process.cwd();
    new Notice('Prüfe Provider-Erreichbarkeit …');

    const results: HealthCheckResult[] = await Promise.all(
      ProviderRegistry.getRegisteredProviderIds().map(async (providerId): Promise<HealthCheckResult> => {
        const name = ProviderRegistry.getProviderDisplayName(providerId);
        const enabled = ProviderRegistry.isEnabled(providerId, settingsBag);
        const command = this.getResolvedProviderCliPath(providerId);
        if (!enabled || !command) {
          return {
            providerId,
            name,
            configured: false,
            reachable: false,
            detail: enabled ? 'CLI not found' : 'disabled',
          };
        }
        const env = {
          ...process.env,
          PATH: getEnhancedPath(process.env.PATH, path.isAbsolute(command) ? command : undefined),
        };
        const probe = await probeCli({ command, env, cwd });
        return {
          providerId,
          name,
          configured: true,
          reachable: probe.ok,
          version: probe.ok ? firstOutputLine(probe.output) : undefined,
          detail: probe.ok ? undefined : probe.detail,
        };
      }),
    );

    const markdown = formatHealthReportMarkdown(results);
    const reachable = results.filter((r) => r.reachable).length;
    const configured = results.filter((r) => r.configured).length;
    try {
      await navigator.clipboard.writeText(markdown);
      new Notice(`Provider-Health: ${reachable}/${configured} erreichbar (Report kopiert).`);
    } catch {
      new Notice(`Provider-Health: ${reachable}/${configured} erreichbar.`);
    }
  }

  /**
   * Runs the active tab's input prompt across the active model and a second model
   * the user picks, then writes the side-by-side answers to a new note.
   */
  async compareModels(): Promise<void> {
    const tab = this.getView()?.getActiveTab();
    if (!tab) {
      new Notice('Kein aktiver Chat-Tab.');
      return;
    }
    const prompt = tab.dom.inputEl.value.trim();
    if (!prompt) {
      new Notice('Gib zuerst einen Prompt ins Eingabefeld ein.');
      return;
    }

    const activeProviderId = tab.providerId;
    const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.settings, activeProviderId);
    const activeModel = String(snapshot.model ?? this.settings.model);

    const models = ProviderRegistry.getAggregatedModelOptions(this.settings as unknown as Record<string, unknown>);
    new ModelSelectModal(this.app, models, activeModel, (secondModel) => {
      void this.runComparisonForModels(prompt, activeProviderId, activeModel, secondModel);
    }).open();
  }

  private async runComparisonForModels(
    prompt: string,
    activeProviderId: ProviderId,
    activeModel: string,
    secondModel: string,
  ): Promise<void> {
    const settingsBag = this.settings as unknown as Record<string, unknown>;
    const secondProviderId = getProviderForModel(secondModel, settingsBag);
    const label = (providerId: ProviderId, model: string): string =>
      `${ProviderRegistry.getProviderDisplayName(providerId)} · ${model}`;

    const entries: ComparisonEntry[] = [
      { providerId: activeProviderId, model: activeModel, label: label(activeProviderId, activeModel) },
      { providerId: secondProviderId, model: secondModel, label: label(secondProviderId, secondModel) },
    ];

    new Notice('Vergleiche Modelle … (läuft im Hintergrund)');
    const results = await runModelComparison(entries, (entry) =>
      this.collectModelResponse(entry.providerId, entry.model, prompt),
    );
    const markdown = formatComparisonMarkdown(prompt, results);

    const folder = 'Claudian Comparisons';
    try {
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder).catch(() => { /* exists / race */ });
      }
      const filePath = `${folder}/compare-${Date.now()}.md`;
      const file = await this.app.vault.create(filePath, markdown);
      await this.app.workspace.getLeaf(true).openFile(file);
      new Notice('Modell-Vergleich erstellt.');
    } catch {
      new Notice('Vergleich konnte nicht gespeichert werden.');
    }
  }

  /** Runs one provider/model to completion for a prompt, collecting the response text. */
  private async collectModelResponse(
    providerId: ProviderId,
    model: string,
    prompt: string,
  ): Promise<ComparisonOutcome> {
    const runtime = ProviderRegistry.createChatRuntime({ plugin: this, providerId });
    try {
      const ready = await runtime.ensureReady();
      if (!ready) {
        return { text: '', error: 'Provider nicht bereit (CLI/Setup prüfen).' };
      }
      const prepared = runtime.prepareTurn({ text: prompt });
      let text = '';
      for await (const chunk of runtime.query(prepared, [], { model })) {
        if (chunk.type === 'text') {
          text += chunk.content;
        } else if (chunk.type === 'error') {
          return { text, error: chunk.content };
        }
      }
      return { text };
    } finally {
      try {
        runtime.cleanup();
      } catch {
        // best-effort cleanup
      }
    }
  }

  /** Flips the global auto mode, persists it, and refreshes the toolbar + status bar. */
  async toggleAutoMode(): Promise<void> {
    this.settings.autoMode = !this.settings.autoMode;
    await this.saveSettings();
    this.getView()?.getActiveTab()?.ui.permissionToggle?.updateDisplay();
    this.updateProviderStatusBar();
    new Notice(this.settings.autoMode ? 'Auto-Mode aktiviert (Doppel-YOLO).' : 'Auto-Mode deaktiviert.');
  }

  /**
   * Gathers a Markdown diagnostics snapshot (version, settings, provider
   * availability, active conversation session map) and copies it to the clipboard.
   */
  async copyDiagnostics(): Promise<void> {
    const settingsBag = this.settings as unknown as Record<string, unknown>;
    const providers = ProviderRegistry.getRegisteredProviderIds().map((providerId) => {
      const enabled = ProviderRegistry.isEnabled(providerId, settingsBag);
      const cliPath = this.getResolvedProviderCliPath(providerId);
      return {
        id: providerId,
        name: ProviderRegistry.getProviderDisplayName(providerId),
        enabled,
        cliResolved: Boolean(cliPath),
        cliPath,
      };
    });

    const tab = this.getView()?.getActiveTab() ?? null;
    const conversation = tab?.conversationId ? this.getConversationSync(tab.conversationId) : null;
    const activeConversation = conversation
      ? {
          id: conversation.id,
          providerId: conversation.providerId,
          sessionId: conversation.sessionId,
          goal: conversation.goal,
          providerSessionIds: Object.fromEntries(
            Object.entries(conversation.providerSessions ?? {}).map(
              ([providerId, snapshot]) => [providerId, snapshot?.sessionId ?? null],
            ),
          ),
        }
      : null;

    const markdown = buildDiagnosticsMarkdown({
      pluginVersion: this.manifest.version,
      generatedAt: new Date().toISOString(),
      permissionMode: String(this.settings.permissionMode ?? 'normal'),
      autoMode: this.settings.autoMode === true,
      providers,
      activeConversation,
      recentErrors: getErrorHistory(),
    });

    try {
      await navigator.clipboard.writeText(markdown);
      new Notice('Claudian-Diagnose in die Zwischenablage kopiert.');
    } catch {
      new Notice('Diagnose konnte nicht kopiert werden.');
    }
  }


  private async ensureVaultFolder(folderPath: string): Promise<void> {
    if (this.app.vault.getAbstractFileByPath(folderPath)) return;
    const parts = folderPath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current).catch(() => { /* exists / race */ });
      }
    }
  }

  private async createMarkdownNote(folder: string, basename: string, markdown: string): Promise<void> {
    await this.ensureVaultFolder(folder);
    const safeBase = basename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'note';
    const filePath = `${folder}/${safeBase}.md`;
    const finalPath = this.app.vault.getAbstractFileByPath(filePath)
      ? `${folder}/${safeBase}-${Date.now()}.md`
      : filePath;
    const file = await this.app.vault.create(finalPath, markdown);
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  async showLastRunTimeline(): Promise<void> {
    const timeline = getLastRunTimeline();
    if (!timeline) {
      new Notice('Noch keine Run Timeline vorhanden.');
      return;
    }

    await this.createMarkdownNote(
      'Claudian Timelines',
      `timeline-${timeline.startedAt}`,
      formatRunTimelineMarkdown(timeline),
    );
    new Notice('Run Timeline geöffnet.');
  }

  private defaultRouterRulesFromModels(): ModelRouterRule[] {
    const models = ProviderRegistry.getAggregatedModelOptions(this.settings as unknown as Record<string, unknown>);
    const findModel = (task: ModelRouterTask, patterns: RegExp[]): ModelRouterRule | null => {
      const found = models.find(model => patterns.some(pattern => pattern.test(`${model.value} ${model.label}`)));
      return found ? { task, model: found.value } : null;
    };
    return [
      findModel('code', [/kimi/i, /code/i, /sonnet/i]),
      findModel('writing', [/gpt/i, /claude/i, /sonnet/i]),
      findModel('planning', [/claude/i, /kimi/i, /reason/i]),
      findModel('vision', [/vision/i, /gpt/i, /gemini/i, /kimi/i]),
      findModel('cheap', [/haiku/i, /mini/i, /flash/i, /highspeed/i]),
    ].filter((rule): rule is ModelRouterRule => rule !== null);
  }

  async applyModelRouterToCurrentInput(): Promise<void> {
    const tab = this.getView()?.getActiveTab();
    if (!tab) {
      new Notice('Kein aktiver Chat-Tab.');
      return;
    }

    const prompt = tab.dom.inputEl.value.trim();
    if (!prompt) {
      new Notice('Gib zuerst einen Prompt ins Eingabefeld ein.');
      return;
    }

    const settingsBag = this.settings as unknown as Record<string, unknown>;
    const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.settings, tab.providerId);
    const fallbackModel = tab.draftModel ?? String(snapshot.model ?? this.settings.model);
    const availableModels = ProviderRegistry.getAggregatedModelOptions(settingsBag);
    const explicitRules = normalizeRouterRules(this.settings.modelRouterRules);
    const rules = explicitRules.length > 0 ? explicitRules : this.defaultRouterRulesFromModels();
    const decision = chooseModelRoute({ prompt, rules, availableModels, fallbackModel });

    if (decision.model === fallbackModel) {
      new Notice(`Model Router: ${decision.reason}; bleibe bei ${fallbackModel}.`);
      return;
    }

    await tab.ui.modelSelector?.selectModel(decision.model);
    new Notice(`Model Router: ${decision.task} → ${decision.model} (${decision.reason}).`);
  }

  private currentInputNameFallback(input: string): string {
    const firstWords = input
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join(' ')
      .replace(/[^\p{L}\p{N}_ -]+/gu, '')
      .trim();
    return firstWords || `workflow-${Date.now()}`;
  }

  async createWorkflowFromCurrentInput(): Promise<void> {
    const tab = this.getView()?.getActiveTab();
    const input = tab?.dom.inputEl.value.trim() ?? '';
    if (!input) {
      new Notice('Gib zuerst einen Prompt ein, aus dem ein Workflow werden soll.');
      return;
    }

    const name = this.currentInputNameFallback(input);
    const path = workflowPathForName(name);
    await this.ensureVaultFolder(WORKFLOW_FOLDER);
    const body = input.includes('{{input}}') ? input : `${input}\n\n{{input}}`;
    await this.app.vault.create(path, serializeWorkflow({
      name,
      description: 'Created from Claudian current input',
      body,
    })).catch(async () => {
      await this.app.vault.create(`${WORKFLOW_FOLDER}/${Date.now()}-${path.split('/').pop()}`, serializeWorkflow({ name, body }));
    });
    new Notice(`Workflow gespeichert: ${path}. Nutze /workflow ${path.split('/').pop()?.replace(/\.md$/, '')}`);
  }

  private async listWorkflows(): Promise<PromptWorkflow[]> {
    const folder = this.app.vault.getAbstractFileByPath(WORKFLOW_FOLDER);
    if (!folder) return [];

    const listed = await this.app.vault.adapter.list(WORKFLOW_FOLDER).catch(() => ({ files: [], folders: [] }));
    const workflows: PromptWorkflow[] = [];
    for (const path of listed.files.filter(file => file.endsWith('.md'))) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      try {
        workflows.push(parseWorkflowFile(path, await this.app.vault.cachedRead(file)));
      } catch {
        // Skip malformed/unreadable workflow files.
      }
    }
    return workflows;
  }

  async expandWorkflow(name: string, input: string, args = ''): Promise<string | null> {
    const wanted = name.trim().toLowerCase();
    const workflows = await this.listWorkflows();
    const workflow = workflows.find(candidate => (
      candidate.id.toLowerCase() === wanted
      || candidate.name.toLowerCase() === wanted
      || candidate.path.toLowerCase().endsWith(`/${wanted}.md`)
    ));
    return workflow ? expandWorkflow(workflow, input, args) : null;
  }

  async suggestSmartContextForCurrentInput(): Promise<void> {
    const tab = this.getView()?.getActiveTab();
    if (!tab) {
      new Notice('Kein aktiver Chat-Tab.');
      return;
    }
    const prompt = tab.dom.inputEl.value.trim();
    if (!prompt) {
      new Notice('Gib zuerst einen Prompt ins Eingabefeld ein.');
      return;
    }

    const markdownFiles = this.app.vault.getMarkdownFiles().slice(0, 500);
    const files: SmartContextFile[] = await Promise.all(markdownFiles.map(async (file) => ({
      path: file.path,
      basename: file.basename,
      content: (await this.app.vault.cachedRead(file).catch(() => '')).slice(0, 6000),
      mtime: file.stat.mtime,
    })));
    const candidates = rankSmartContextCandidates(prompt, files, { limit: 5 });
    const mentionBlock = formatSmartContextMentions(candidates);
    if (!mentionBlock) {
      new Notice('Keine passenden Kontext-Notizen gefunden.');
      return;
    }

    tab.dom.inputEl.value = `${mentionBlock}\n\n${tab.dom.inputEl.value}`;
    tab.dom.inputEl.focus();
    tab.dom.inputEl.setSelectionRange(tab.dom.inputEl.value.length, tab.dom.inputEl.value.length);
    new Notice(`Smart Context: ${candidates.length} Vorschläge eingefügt.`);
  }

  async recallMemoriesForCurrentInput(): Promise<void> {
    const tab = this.getView()?.getActiveTab();
    if (!tab) {
      new Notice('No active chat tab.');
      return;
    }
    const prompt = tab.dom.inputEl.value.trim();
    if (!prompt) {
      new Notice('Enter a prompt first.');
      return;
    }

    const folder = this.settings.memoryFolder ?? '.claudian/memory';
    const notes = await loadMemoryNotes(this.app.vault, folder);
    const candidates = rankMemoryNotes(prompt, notes, { limit: this.settings.memoryMaxNotes ?? 5 });
    const memoryContext = formatMemoryContext(candidates);
    if (!memoryContext) {
      new Notice('No relevant memories found.');
      return;
    }

    tab.dom.inputEl.value = `${memoryContext}\n\n${tab.dom.inputEl.value}`;
    tab.dom.inputEl.focus();
    tab.dom.inputEl.setSelectionRange(tab.dom.inputEl.value.length, tab.dom.inputEl.value.length);
    new Notice(`Memory: ${candidates.length} entries recalled.`);
  }

  async forgetMemory(): Promise<void> {
    const folder = this.settings.memoryFolder ?? '.claudian/memory';
    const notes = await loadMemoryNotes(this.app.vault, folder);
    if (notes.length === 0) {
      new Notice('No memories to forget.');
      return;
    }

    const target = notes[0];
    await deleteMemory(this.app, target.path);
    new Notice(`Forgot memory: ${target.topic}`);
  }

  updateProviderStatusBar(): void {
    if (!this.providerStatusBar) {
      return;
    }
    const tab = this.getView()?.getActiveTab() ?? null;
    if (!tab) {
      this.providerStatusBar.update(null);
      return;
    }
    const providerId = tab.providerId;
    const settingsBag = this.settings as unknown as Record<string, unknown>;
    const enabled = ProviderRegistry.isEnabled(providerId, settingsBag);
    const ready = enabled && Boolean(this.getResolvedProviderCliPath(providerId));
    const usage = tab.state.usage ?? null;
    this.providerStatusBar.update({
      providerId,
      name: ProviderRegistry.getProviderDisplayName(providerId),
      ready,
      enabled,
      streaming: tab.state.isStreaming === true,
      percentage: usage ? usage.percentage : null,
      estimated: usage ? usage.contextWindowIsAuthoritative === false : false,
      autoMode: this.settings.autoMode === true,
    });
  }

  private async persistOpenTabStates(): Promise<void> {
    // Ensures state is saved even if Obsidian quits without calling onClose()
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (tabManager) {
        const state = tabManager.getPersistedState();
        await this.persistTabManagerState(state);
      }
    }
  }

  private async persistOpenConversations(): Promise<void> {
    // Flush any in-flight conversation metadata so chats survive an Obsidian
    // reload or crash for every provider/model.
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) {
        continue;
      }
      for (const tab of tabManager.getAllTabs()) {
        const controller = tab.controllers.conversationController;
        if (controller) {
          await controller.save(false).catch(() => {
            // Best-effort: don't let one failing conversation block the rest.
          });
        }
      }
    }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN)[0];

    if (!leaf) {
      const newLeaf = this.getLeafForPlacement(this.settings.chatViewPlacement);
      if (newLeaf) {
        await newLeaf.setViewState({
          type: VIEW_TYPE_CLAUDIAN,
          active: true,
        });
        leaf = newLeaf;
      }
    }

    if (leaf) {
      await revealWorkspaceLeaf(workspace, leaf);
    }
  }

  private getLeafForPlacement(placement: ChatViewPlacement): WorkspaceLeaf | null {
    const { workspace } = this.app;
    switch (placement) {
      case 'main-tab':
        return workspace.getLeaf('tab');
      case 'left-sidebar':
        return workspace.getLeftLeaf(false);
      case 'right-sidebar':
        return workspace.getRightLeaf(false);
    }
  }

  private canCreateNewTab(): boolean {
    const hasClaudianLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN).length > 0;
    const view = this.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      return tabManager.canCreateTab();
    }

    if (hasClaudianLeaf) {
      return false;
    }

    return this.getLastKnownOpenTabCount() < this.getMaxTabsLimit();
  }

  private async ensureViewOpen(): Promise<ClaudianView | null> {
    const existingView = this.getView();
    if (existingView) {
      return existingView;
    }

    await this.activateView();
    return this.getView();
  }

  private async openNewTab(): Promise<void> {
    const existingView = this.getView();
    if (existingView) {
      await existingView.createNewTab();
      return;
    }

    const restoredTabCount = this.getLastKnownOpenTabCount();
    const view = await this.ensureViewOpen();
    if (!view) {
      return;
    }

    // A cold-open view creates its initial tab during restore. Avoid stacking
    // an extra blank tab on top when there was no prior layout to restore.
    if (restoredTabCount === 0) {
      return;
    }

    await view.createNewTab();
  }

  async loadSettings() {
    this.storage = new SharedStorageService(this);
    const { claudian } = await this.storage.initialize();
    this.lastKnownTabManagerState = await this.storage.getTabManagerState();

    this.settings = {
      ...DEFAULT_CLAUDIAN_SETTINGS,
      ...claudian,
    };

    // Plan mode is ephemeral — normalize back to normal on load so the app
    // doesn't start stuck in plan mode after a restart (prePlanPermissionMode is lost)
    if (this.settings.permissionMode === 'plan') {
      this.settings.permissionMode = 'normal';
    }
    if (
      this.settings.savedProviderPermissionMode
      && typeof this.settings.savedProviderPermissionMode === 'object'
      && !Array.isArray(this.settings.savedProviderPermissionMode)
    ) {
      for (const [providerId, mode] of Object.entries(this.settings.savedProviderPermissionMode)) {
        if (mode === 'plan') {
          this.settings.savedProviderPermissionMode[providerId] = 'normal';
        }
      }
    }
    const opencodeConfig = this.settings.providerConfigs?.opencode;
    if (
      opencodeConfig
      && typeof opencodeConfig === 'object'
      && !Array.isArray(opencodeConfig)
      && opencodeConfig.selectedMode === OPENCODE_PLAN_MODE_ID
    ) {
      opencodeConfig.selectedMode = OPENCODE_SAFE_MODE_ID;
    }

    const didNormalizeProviderSelection = ProviderSettingsCoordinator.normalizeProviderSelection(
      this.settings,
    );
    const didNormalizeModelVariants = this.normalizeModelVariantSettings();

    const allMetadata = await this.storage.sessions.listMetadata();
    this.conversations = allMetadata.map(meta => {
      const resumeSessionId = meta.sessionId !== undefined ? meta.sessionId : meta.id;

      return {
        id: meta.id,
        providerId: meta.providerId ?? DEFAULT_CHAT_PROVIDER_ID,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        lastResponseAt: meta.lastResponseAt,
        sessionId: resumeSessionId,
        providerState: meta.providerState,
        providerSessions: meta.providerSessions,
        goal: meta.goal,
        messages: meta.messages ?? [],
        currentNote: meta.currentNote,
        externalContextPaths: meta.externalContextPaths,
        enabledMcpServers: meta.enabledMcpServers,
        usage: meta.usage,
        titleGenerationStatus: meta.titleGenerationStatus,
        resumeAtMessageId: meta.resumeAtMessageId,
      };
    }).sort(
      (a, b) => (b.lastResponseAt ?? b.updatedAt) - (a.lastResponseAt ?? a.updatedAt)
    );
    setLocale(this.settings.locale as Locale);

    const backfilledConversations = this.backfillConversationResponseTimestamps();

    const { changed, invalidatedConversations } = this.reconcileModelWithEnvironment();

    ProviderSettingsCoordinator.projectActiveProviderState(
      this.settings,
    );

    if (changed || didNormalizeModelVariants || didNormalizeProviderSelection) {
      await this.saveSettings();
    }

    const conversationsToSave = new Set([...backfilledConversations, ...invalidatedConversations]);
    for (const conv of conversationsToSave) {
      await this.storage.sessions.saveMetadata(
        this.storage.sessions.toSessionMetadata(conv)
      );
    }
  }

  private backfillConversationResponseTimestamps(): Conversation[] {
    const updated: Conversation[] = [];
    for (const conv of this.conversations) {
      if (conv.lastResponseAt != null) continue;
      if (!conv.messages || conv.messages.length === 0) continue;

      for (let i = conv.messages.length - 1; i >= 0; i--) {
        const msg = conv.messages[i];
        if (msg.role === 'assistant') {
          conv.lastResponseAt = msg.timestamp;
          updated.push(conv);
          break;
        }
      }
    }
    return updated;
  }

  normalizeModelVariantSettings(): boolean {
    return ProviderSettingsCoordinator.normalizeAllModelVariants(
      this.settings,
    );
  }

  async saveSettings() {
    ProviderSettingsCoordinator.normalizeProviderSelection(
      this.settings,
    );
    ProviderSettingsCoordinator.persistProjectedProviderState(
      this.settings,
    );

    await this.storage.saveClaudianSettings(this.settings);
  }

  /** Updates and persists environment variables, restarting processes to apply changes. */
  async applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void> {
    await this.applyEnvironmentVariablesBatch([{ scope, envText }]);
  }

  async applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void> {
    const settingsBag = this.settings as unknown as Record<string, unknown>;
    const nextEnvironmentByScope = new Map<EnvironmentScope, string>();
    for (const update of updates) {
      nextEnvironmentByScope.set(update.scope, update.envText);
    }

    const changedScopes: EnvironmentScope[] = [];
    for (const [scope, envText] of nextEnvironmentByScope) {
      const currentValue = getScopedEnvironmentVariables(settingsBag, scope);
      if (currentValue !== envText) {
        changedScopes.push(scope);
      }
      setEnvironmentVariablesForScope(settingsBag, scope, envText);
    }

    if (changedScopes.length === 0) {
      await this.saveSettings();
      return;
    }

    const affectedProviderIds = this.getAffectedEnvironmentProviders(changedScopes);
    ProviderSettingsCoordinator.handleEnvironmentChange(settingsBag, affectedProviderIds);
    const { changed, invalidatedConversations } = this.reconcileModelWithEnvironment(affectedProviderIds);
    await this.saveSettings();

    if (invalidatedConversations.length > 0) {
      for (const conv of invalidatedConversations) {
        await this.storage.sessions.saveMetadata(
          this.storage.sessions.toSessionMetadata(conv)
        );
      }
    }

    const view = this.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      const affectedTabs = tabManager.getAllTabs().filter((tab) => (
        affectedProviderIds.includes(tab.providerId ?? DEFAULT_CHAT_PROVIDER_ID)
      ));
      const syncTabRuntimeState = (tab: (typeof affectedTabs)[number]): void => {
        if (!tab.service || !tab.serviceInitialized) {
          return;
        }

        const conversation = tab.conversationId
          ? this.getConversationSync(tab.conversationId)
          : null;
        const hasConversationContext = (conversation?.messages.length ?? 0) > 0;
        const externalContextPaths = tab.ui.externalContextSelector?.getExternalContexts()
          ?? (hasConversationContext
            ? conversation?.externalContextPaths ?? []
            : this.settings.persistentExternalContextPaths ?? []);

        tab.service.syncConversationState(conversation, externalContextPaths);
      };

      for (const tab of affectedTabs) {
        if (tab.state.isStreaming) {
          tab.controllers.inputController?.cancelStreaming();
        }
      }

      let failedTabs = 0;
      if (changed) {
        for (const tab of affectedTabs) {
          if (!tab.service || !tab.serviceInitialized) {
            continue;
          }
          try {
            syncTabRuntimeState(tab);
            tab.service.resetSession();
            await tab.service.ensureReady();
          } catch {
            failedTabs++;
          }
        }
      } else {
        for (const tab of affectedTabs) {
          if (!tab.service || !tab.serviceInitialized) {
            continue;
          }
          try {
            syncTabRuntimeState(tab);
            await tab.service.ensureReady({ force: true });
          } catch {
            failedTabs++;
          }
        }
      }
      if (failedTabs > 0) {
        new Notice(`Environment changes applied, but ${failedTabs} affected tab(s) failed to restart.`);
      }
    }

    for (const openView of this.getAllViews()) {
      openView.invalidateProviderCommandCaches(affectedProviderIds);
      openView.refreshModelSelector();
    }

    const noticeText = changed
      ? 'Environment variables applied. Sessions will be rebuilt on next message.'
      : 'Environment variables applied.';
    new Notice(noticeText);
  }

  /** Returns the runtime environment variables (fixed at plugin load). */
  getActiveEnvironmentVariables(
    providerId: ProviderId = ProviderRegistry.resolveSettingsProviderId(
      this.settings,
    ),
  ): string {
    return getRuntimeEnvironmentText(
      this.settings,
      providerId,
    );
  }

  getEnvironmentVariablesForScope(scope: EnvironmentScope): string {
    return getScopedEnvironmentVariables(
      this.settings,
      scope,
    );
  }

  getResolvedProviderCliPath(providerId: ProviderId): string | null {
    const cliResolver = ProviderWorkspaceRegistry.getCliResolver(providerId);
    if (!cliResolver) {
      return null;
    }

    return cliResolver.resolveFromSettings(this.settings);
  }

  private reconcileModelWithEnvironment(providerIds: ProviderId[] = ProviderRegistry.getRegisteredProviderIds()): {
    changed: boolean;
    invalidatedConversations: Conversation[];
  } {
    return ProviderSettingsCoordinator.reconcileProviders(
      this.settings,
      this.conversations,
      providerIds,
    );
  }

  private getAffectedEnvironmentProviders(scopes: EnvironmentScope[]): ProviderId[] {
    const registeredProviderIds = new Set(ProviderRegistry.getRegisteredProviderIds());
    const affectedProviderIds = new Set<ProviderId>();

    for (const scope of scopes) {
      if (scope === 'shared') {
        for (const providerId of registeredProviderIds) {
          affectedProviderIds.add(providerId);
        }
        continue;
      }

      const providerId = scope.slice('provider:'.length);
      if (registeredProviderIds.has(providerId)) {
        affectedProviderIds.add(providerId);
      }
    }

    return Array.from(affectedProviderIds);
  }

  private generateConversationId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateDefaultTitle(): string {
    const now = new Date();
    return now.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private getConversationPreview(conv: Conversation): string {
    const firstUserMsg = conv.messages.find(m => m.role === 'user');
    if (!firstUserMsg) {
      return 'New conversation';
    }
    const previewText = firstUserMsg.displayContent
      ?? extractUserDisplayContent(firstUserMsg.content)
      ?? firstUserMsg.content;
    return previewText.substring(0, 50) + (previewText.length > 50 ? '...' : '');
  }

  private async loadSdkMessagesForConversation(conversation: Conversation): Promise<void> {
    await ProviderRegistry
      .getConversationHistoryService(conversation.providerId)
      .hydrateConversationHistory(conversation, getVaultPath(this.app));
  }

  async createConversation(options?: {
    providerId?: ProviderId;
    sessionId?: string;
  }): Promise<Conversation> {
    const providerId = options?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
    const sessionId = options?.sessionId;
    const conversationId = sessionId ?? this.generateConversationId();
    const conversation: Conversation = {
      id: conversationId,
      providerId,
      title: this.generateDefaultTitle(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: sessionId ?? null,
      messages: [],
    };

    this.conversations.unshift(conversation);
    await this.storage.sessions.saveMetadata(
      this.storage.sessions.toSessionMetadata(conversation)
    );

    return conversation;
  }

  async switchConversation(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return null;

    await this.loadSdkMessagesForConversation(conversation);

    return conversation;
  }

  async deleteConversation(id: string): Promise<void> {
    const index = this.conversations.findIndex(c => c.id === id);
    if (index === -1) return;

    const conversation = this.conversations[index];
    this.conversations.splice(index, 1);

    await ProviderRegistry
      .getConversationHistoryService(conversation.providerId)
      .deleteConversationSession(conversation, getVaultPath(this.app));

    await this.storage.sessions.deleteMetadata(id);

    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      for (const tab of tabManager.getAllTabs()) {
        if (tab.conversationId === id) {
          tab.controllers.inputController?.cancelStreaming();
          await tab.controllers.conversationController?.createNew({ force: true });
        }
      }
    }
  }

  async renameConversation(id: string, title: string): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    conversation.title = title.trim() || this.generateDefaultTitle();
    conversation.updatedAt = Date.now();

    await this.storage.sessions.saveMetadata(
      this.storage.sessions.toSessionMetadata(conversation)
    );
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    // `providerId` is intentionally mutable: switching a bound conversation to
    // another provider's model mid-chat (switchBoundTabProvider) rebinds it, and
    // that must persist so the next send + a reload use the new provider. Only an
    // explicitly-`undefined` providerId is ignored, so unrelated partial updates
    // never blank an existing binding.
    const safeUpdates = { ...updates };
    if (safeUpdates.providerId === undefined) {
      delete safeUpdates.providerId;
    }
    Object.assign(conversation, safeUpdates, { updatedAt: Date.now() });

    await this.storage.sessions.saveMetadata(
      this.storage.sessions.toSessionMetadata(conversation)
    );

    // Clear image data from memory after save (data is persisted by SDK).
    // Skip for pending forks: their deep-cloned images aren't in SDK storage yet.
    if (!ProviderRegistry.getConversationHistoryService(conversation.providerId).isPendingForkConversation(conversation)) {
      for (const msg of conversation.messages) {
        if (msg.images) {
          for (const img of msg.images) {
            img.data = '';
          }
        }
      }
    }
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.find(c => c.id === id) || null;

    if (conversation) {
      await this.loadSdkMessagesForConversation(conversation);
    }

    return conversation;
  }

  getConversationSync(id: string): Conversation | null {
    return this.conversations.find(c => c.id === id) || null;
  }

  findEmptyConversation(): Conversation | null {
    return this.conversations.find(c => c.messages.length === 0) || null;
  }

  getConversationList(): ConversationMeta[] {
    return this.conversations.map(c => ({
      id: c.id,
      providerId: c.providerId,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastResponseAt: c.lastResponseAt,
      messageCount: c.messages.length,
      preview: this.getConversationPreview(c),
      titleGenerationStatus: c.titleGenerationStatus,
    }));
  }

  async persistTabManagerState(state: AppTabManagerState): Promise<void> {
    this.lastKnownTabManagerState = state;
    await this.storage.setTabManagerState(state);
  }

  getView(): ClaudianView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN);
    return leaves.map(leaf => leaf.view).find(isClaudianView) ?? null;
  }

  getAllViews(): ClaudianView[] {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN);
    return leaves.map(leaf => leaf.view).filter(isClaudianView);
  }

  findConversationAcrossViews(conversationId: string): { view: ClaudianView; tabId: string } | null {
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      const tabs = tabManager.getAllTabs();
      for (const tab of tabs) {
        if (tab.conversationId === conversationId) {
          return { view, tabId: tab.id };
        }
      }
    }
    return null;
  }

  private getLastKnownOpenTabCount(): number {
    return this.lastKnownTabManagerState?.openTabs.length ?? 0;
  }

  private getMaxTabsLimit(): number {
    const maxTabs = this.settings.maxTabs ?? 3;
    return Math.max(3, Math.min(10, maxTabs));
  }

}
