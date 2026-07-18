// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from './utils/electronCompat';
patchSetMaxListenersForElectron();

import './providers';

import * as path from 'node:path';

import type { Editor, WorkspaceLeaf } from 'obsidian';
import { FuzzySuggestModal,MarkdownView, Notice, Plugin, TFile } from 'obsidian';

import { DEFAULT_CLAUDIAN_SETTINGS } from './app/settings/defaultSettings';
import { SharedStorageService } from './app/storage/SharedStorageService';
import { PluginUpdater } from './app/update/PluginUpdater';
import { whisperServerManager } from './core/audio/WhisperServerManager';
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
import { AuditLogService } from './core/control/audit/AuditLogService';
import {
  type ScheduledWorkflow,
  WorkflowEngine,
  type WorkflowStep,
} from './core/control/workflows/WorkflowEngine';
import { buildDiagnosticsMarkdown } from './core/diagnostics/buildDiagnostics';
import { getErrorHistory } from './core/diagnostics/errorHistory';
import {
  firstOutputLine,
  formatHealthReportMarkdown,
  type HealthCheckResult,
  probeCli,
} from './core/diagnostics/providerHealthCheck';
import { globalEventBus } from './core/events/EventBus';
import type { EmbeddingService } from './core/intelligence/embeddings/EmbeddingService';
import { KeywordEmbeddingProvider } from './core/intelligence/embeddings/KeywordEmbeddingProvider';
import { OllamaEmbeddingProvider } from './core/intelligence/embeddings/OllamaEmbeddingProvider';
import { AgenticMemoryService } from './core/intelligence/memory/AgenticMemoryService';
import {
  BUILT_IN_SPECIALIST_AGENTS,
  DEFAULT_INLINE_TEAM_AGENT_IDS,
} from './core/intelligence/multiAgent/agentRegistry';
import {
  multiAgentAvailabilityService,
} from './core/intelligence/multiAgent/MultiAgentAvailabilityService';
import {
  type AgentExecutor,
  buildSynthesisPrompt,
  isRateLimitErrorMessage,
  type MissionStateStorage as IMissionStateStorage,
  MissionStateStorage,
  MultiAgentService,
  type SpecialistAgent,
} from './core/intelligence/multiAgent/MultiAgentService';
import { ProjectService } from './core/intelligence/projects/ProjectService';
import {
  buildRelatedQueryText,
  rankRelatedNotes,
  RELATED_QUERY_LIMIT,
  RELATED_RESULT_LIMIT,
  type RelatedNote,
} from './core/intelligence/rag/relatedNotes';
import { VaultRAGService } from './core/intelligence/rag/VaultRAGService';
import { VectorStore } from './core/intelligence/vectorStore/VectorStore';
import { VisionService } from './core/intelligence/vision/VisionService';
import { CachedMemoryStore } from './core/memory/CachedMemoryStore';
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
  getRuntimeEnvironmentVariables,
  setEnvironmentVariablesForScope,
} from './core/providers/providerEnvironment';
import { ProviderRegistry } from './core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from './core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from './core/providers/ProviderWorkspaceRegistry';
import type { ProviderId } from './core/providers/types';
import type { AppTabManagerState } from './core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from './core/providers/types';
import {
  AUTO_MODEL_VALUE,
  chooseModelRoute,
  type ModelRouteContext,
  type ModelRouteDecision,
  type ModelRouterRule,
  type ModelRouterTask,
  normalizeRouterRules,
} from './core/routing/modelRouterRules';
import {
  listSnippets,
  saveSnippet,
  type Snippet,
} from './core/snippets/snippetService';
import { MetadataStore } from './core/storage/metadata/MetadataStore';
import { clearRunTimelines, formatRunTimelineMarkdown, getLastRunTimeline } from './core/timeline/runTimeline';
import { RunTimelineStore } from './core/timeline/RunTimelineStore';
import type {
  ChatMessage,
  ClaudianSettings,
  Conversation,
  ConversationMeta,
  ImageAttachment,
} from './core/types';
import {
  VIEW_TYPE_CLAUDIAN,
} from './core/types';
import type { ChatViewPlacement, EnvironmentScope } from './core/types/settings';
import { TurnUndoService } from './core/undo/TurnUndoService';
import {
  expandWorkflow,
  parseWorkflowFile,
  type PromptWorkflow,
  serializeWorkflow,
  WORKFLOW_FOLDER,
  workflowPathForName,
} from './core/workflows/promptWorkflows';
import { ArtifactService } from './features/artifacts/ArtifactService';
import { ClaudianView } from './features/chat/ClaudianView';
import { exportConversationToNote } from './features/chat/export/ConversationExportWriter';
import {
  exportConversationToHtml,
  exportConversationToPdf,
} from './features/chat/export/ConversationHtmlExporter';
import { ImageStagingService } from './features/chat/services/ImageStagingService';
import { PacketTracerService } from './features/chat/services/PacketTracerService';
import type { TabData } from './features/chat/tabs/types';
import { ModelSelectModal } from './features/chat/ui/ModelSelectModal';
import { ProviderStatusBar } from './features/chat/ui/ProviderStatusBar';
import { ClaudianDashboardView, VIEW_TYPE_CLAUDIAN_DASHBOARD } from './features/dashboard/ClaudianDashboardView';
import { dashboardStrings } from './features/dashboard/dashboardI18n';
import { NewProjectModal, projectSlug } from './features/dashboard/NewProjectModal';
import { type InlineEditContext, InlineEditModal } from './features/inline-edit/ui/InlineEditModal';
import { MultiAgentModal } from './features/multiAgent/MultiAgentModal';
import {
  CommandCenterModal,
  ConversationTreeModal,
  ModelComparisonModal,
  SkillMarketplaceModal,
} from './features/productivity/ProductivityModals';
import { RelatedNotesModal } from './features/related/RelatedNotesModal';
import { RelatedNotesView, VIEW_TYPE_CLAUDIAN_RELATED } from './features/related/RelatedNotesView';
import { ClaudianSettingTab } from './features/settings/ClaudianSettings';
import {
  DEFAULT_TEMPLATE_FOLDER,
  PromptTemplateService,
} from './features/templates/PromptTemplateService';
import { VaultHealthService } from './features/templates/VaultHealthService';
import { setLocale } from './i18n/i18n';
import type { Locale } from './i18n/types';
import { OPENCODE_PLAN_MODE_ID, OPENCODE_SAFE_MODE_ID } from './providers/opencode/modes';
import { extractUserDisplayContent } from './utils/context';
import { buildCursorContext } from './utils/editor';
import { clearEnvPathCache, getEnhancedPath } from './utils/env';
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
  metadataStore!: MetadataStore;
  auditLogService!: AuditLogService;
  workflowEngine!: WorkflowEngine;
  projectService!: ProjectService;
  agenticMemoryService!: AgenticMemoryService;
  /**
   * Cached wrapper around loadMemoryNotes. The always-on auto-recall runs on
   * every send; this cache avoids re-scanning all vault markdown files each turn.
   * Invalidation is event-driven (vault create/modify/delete/rename + memory:updated).
   */
  cachedMemoryStore!: CachedMemoryStore;
  vectorStore!: VectorStore;
  embeddingService!: EmbeddingService;
  vaultRAGService!: VaultRAGService;
  multiAgentService!: MultiAgentService;
  missionStateStorage!: IMissionStateStorage;
  visionService!: VisionService;
  imageStagingService!: ImageStagingService;
  packetTracerService!: PacketTracerService;
  runTimelineStore!: RunTimelineStore;
  promptTemplateService!: PromptTemplateService;
  vaultHealthService!: VaultHealthService;
  artifactService!: ArtifactService;
  turnUndoService!: TurnUndoService;

  async onload() {
    await this.loadSettings();
    await this.initializeClaudianOSServices();

    // Initialize image staging service and clean up stale compose drafts.
    this.imageStagingService = new ImageStagingService(this.app.vault);
    void this.imageStagingService.cleanup(7).catch(() => {
      // Best-effort cleanup on startup.
    });
    this.packetTracerService = new PacketTracerService(this.app.vault);
    this.runTimelineStore = new RunTimelineStore(this.storage.getAdapter());
    this.turnUndoService = new TurnUndoService(this.app.vault);

    // Initialize prompt templates and vault health services.
    this.promptTemplateService = new PromptTemplateService(
      this.app,
      this.settings.promptTemplateFolder ?? DEFAULT_TEMPLATE_FOLDER,
    );
    this.vaultHealthService = new VaultHealthService(this.app);

    // Initialize the artifact system (Claude Code Artifacts adapted for Obsidian).
    this.artifactService = new ArtifactService(this.app);

    await ProviderWorkspaceRegistry.initializeAll(this);

    this.registerView(
      VIEW_TYPE_CLAUDIAN,
      (leaf) => new ClaudianView(leaf, this)
    );

    this.registerView(
      VIEW_TYPE_CLAUDIAN_DASHBOARD,
      (leaf) => new ClaudianDashboardView(leaf, this)
    );

    this.registerView(
      VIEW_TYPE_CLAUDIAN_RELATED,
      (leaf) => new RelatedNotesView(leaf, this)
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
      id: 'related-notes',
      name: 'Verwandte Notizen finden',
      callback: () => {
        void this.showRelatedNotesForActiveNote();
      },
    });

    this.addCommand({
      id: 'related-notes-panel',
      name: 'Verwandte-Notizen-Panel öffnen',
      callback: () => {
        void this.openRelatedNotesPanel();
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
      id: 'search-in-chat',
      name: 'Search in current chat',
      checkCallback: (checking: boolean) => {
        const tab = this.getView()?.getActiveTab();
        if (!tab?.ui.chatSearch) return false;
        if (!checking) {
          tab.ui.chatSearch.toggle();
        }
        return true;
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
      id: 'open-productivity-center',
      name: 'Produktivitätszentrale öffnen',
      callback: () => this.openCommandCenter(),
    });

    this.addCommand({
      id: 'show-conversation-tree',
      name: 'Show conversation branch tree',
      callback: () => this.openConversationTree(),
    });

    this.addCommand({
      id: 'open-skill-marketplace',
      name: 'Open skill marketplace',
      callback: () => new SkillMarketplaceModal(this.app).open(),
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
      id: 'clear-run-timeline-history',
      name: 'Clear persisted run timeline history',
      callback: () => {
        void this.clearRunTimelineHistory();
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

    this.addCommand({
      id: 'open-dashboard',
      name: 'Open Claudian OS dashboard',
      callback: () => {
        void this.openDashboard();
      },
    });

    this.addCommand({
      id: 'index-vault-rag',
      name: 'Index vault for RAG',
      callback: () => {
        void this.indexVaultRAG();
      },
    });

    this.addCommand({
      id: 'remember-fact',
      name: 'Remember fact',
      editorCallback: async (editor) => {
        const selectedText = editor.getSelection().trim();
        if (!selectedText) {
          new Notice('Select text to remember.');
          return;
        }
        const topic = selectedText.split('\n')[0].slice(0, 60);
        await this.agenticMemoryService.remember({
          topic,
          content: selectedText,
          tags: ['manual'],
          confidence: 0.9,
        });
        new Notice(`Remembered: ${topic}`);
      },
    });

    this.addCommand({
      id: 'create-project',
      name: 'Create Claudian project',
      callback: () => {
        void this.createClaudianProject();
      },
    });

    this.addCommand({
      id: 'show-audit-log',
      name: 'Show audit log',
      callback: () => {
        void this.showAuditLog();
      },
    });

    this.addCommand({
      id: 'run-multi-agent',
      name: 'Run multi-agent task',
      callback: () => {
        void this.runMultiAgentTask();
      },
    });

    this.addCommand({
      id: 'analyze-image',
      name: 'Analyze image',
      editorCallback: async (editor, ctx) => {
        const file = ctx instanceof MarkdownView ? ctx.file : null;
        if (!file) {
          new Notice('No active image.');
          return;
        }
        const result = await this.visionService.analyzeImage(file as TFile);
        new Notice(result.description.slice(0, 200));
      },
    });

    this.addCommand({
      id: 'export-conversation',
      name: 'Export conversation to note',
      callback: () => { void this.exportActiveConversation(); },
    });

    this.addCommand({
      id: 'export-conversation-html',
      name: 'Export conversation as styled HTML',
      callback: () => { void this.exportActiveConversationHtml(); },
    });

    this.addCommand({
      id: 'export-conversation-pdf',
      name: 'Export conversation as PDF',
      callback: () => { void this.exportActiveConversationPdf(); },
    });

    this.addCommand({
      id: 'undo-last-agent-turn',
      name: 'Undo file changes from last agent turn',
      callback: () => { void this.undoLastAgentTurn(); },
    });

    this.addCommand({
      id: 'save-prompt-snippet',
      name: 'Save current input as prompt snippet',
      callback: async () => {
        const tab = this.getView()?.getActiveTab();
        if (!tab) return;
        const body = tab.dom.inputEl.value.trim();
        if (!body) {
          new Notice('Eingabefeld ist leer — nichts zu speichern.');
          return;
        }
        const name = body.slice(0, 40).replace(/\n/g, ' ').trim();
        await saveSnippet(this.app.vault, name, body);
        new Notice(`Snippet gespeichert: ${name}`);
      },
    });

    this.addCommand({
      id: 'insert-prompt-snippet',
      name: 'Insert a saved prompt snippet',
      callback: async () => {
        const tab = this.getView()?.getActiveTab();
        if (!tab) return;
        const snippets = await listSnippets(this.app.vault);
        if (snippets.length === 0) {
          new Notice('Keine Snippets gespeichert. Schreibe einen Prompt und nutze „Save current input as prompt snippet".');
          return;
        }
        const onChoose = (item: Snippet) => {
          const ta = tab.dom.inputEl;
          const start = ta.selectionStart ?? ta.value.length;
          const end = ta.selectionEnd ?? ta.value.length;
          const needsSpace = start > 0 && !/\s/.test(ta.value[start - 1]);
          ta.setRangeText((needsSpace ? '\n' : '') + item.body, start, end, 'end');
          ta.focus();
        };
        new class extends FuzzySuggestModal<Snippet> {
          getItems(): Snippet[] { return snippets; }
          getItemText(s: Snippet): string { return `${s.name} ${s.tags.join(' ')}`; }
          onChooseItem(item: Snippet | null): void { if (item) onChoose(item); }
        }(this.app).open();
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

    // RAG: load any persisted index, top it up in the background, and keep it
    // fresh on vault changes so the chat's vault_context works out of the box.
    this.setupVaultRAGAutoIndex();
  }

  // ── RAG auto-indexing ─────────────────────────────────────────────────────

  private readonly RAG_INDEX_PATH = '.claudian/rag/index.json';
  private ragSaveTimer: number | null = null;
  private ragDirty = false;

  /**
   * Boots the RAG index without any manual command: restores the persisted
   * vector store, schedules a background full index when empty, and registers
   * debounced vault listeners for incremental updates. Gated on the memory
   * feature so users who disable it pay nothing.
   */
  private setupVaultRAGAutoIndex(): void {
    if (this.settings.memoryEnabled === false) return;
    if (typeof this.app.workspace?.onLayoutReady !== 'function') return;

    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        // Probe/swap to Ollama embeddings here (off the onload critical path)
        // before the index is loaded, so the dimension guard below sees the
        // final provider's dimension and rebuilds once if it changed.
        await this.upgradeEmbeddingProviderIfConfigured();

        await this.loadRAGIndex();

        // If the embedding model changed since the index was built (e.g. keyword
        // 256-dim → Ollama 768-dim), the stored vectors are incompatible and
        // every query would silently return nothing. Drop them and re-index.
        const storedDim = this.vectorStore.dimension();
        const currentDim = this.embeddingService.getDimension();
        if (storedDim > 0 && storedDim !== currentDim) {
          console.warn(`[Claudian] RAG embedding dimension changed (${storedDim} → ${currentDim}); rebuilding index.`);
          this.vectorStore.clear();
        }

        // Empty index (fresh install or never indexed) → background full pass.
        if (this.vectorStore.size() === 0 && !this.vaultRAGService.indexing) {
          try {
            await this.vaultRAGService.indexVault({ limit: 1000 });
            await this.saveRAGIndex();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('[Claudian] background RAG index failed:', message);
          }
        }

        this.registerVaultRAGListeners();
      })();
    });
  }

  /** Debounced incremental index updates as markdown files change. */
  private registerVaultRAGListeners(): void {
    const reindex = (file: TFile): void => {
      if (file.extension !== 'md') return;
      void this.vaultRAGService.indexFile(file)
        .then(() => this.scheduleRAGSave())
        .catch(() => {});
    };

    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (file instanceof TFile) reindex(file);
    }));
    this.registerEvent(this.app.vault.on('create', (file) => {
      if (file instanceof TFile) reindex(file);
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        this.vaultRAGService.removeFile(file.path);
        this.scheduleRAGSave();
      }
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile && file.extension === 'md') {
        this.vaultRAGService.removeFile(oldPath);
        reindex(file);
      }
    }));
  }

  /** Coalesces frequent edits into a single index write (5s debounce). */
  private scheduleRAGSave(): void {
    this.ragDirty = true;
    if (this.ragSaveTimer !== null) return;
    this.ragSaveTimer = window.setTimeout(() => {
      this.ragSaveTimer = null;
      if (this.ragDirty) void this.saveRAGIndex();
    }, 5_000);
  }

  /** Persists the vector store so the index survives restarts. */
  private async saveRAGIndex(): Promise<void> {
    this.ragDirty = false;
    try {
      const adapter = this.app.vault.adapter;
      const folder = '.claudian/rag';
      if (!(await adapter.exists(folder))) {
        await adapter.mkdir(folder);
      }
      await adapter.write(this.RAG_INDEX_PATH, this.vectorStore.serialize());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Claudian] failed to persist RAG index:', message);
    }
  }

  /** Restores a persisted vector store, if present. */
  private async loadRAGIndex(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      if (await adapter.exists(this.RAG_INDEX_PATH)) {
        const raw = await adapter.read(this.RAG_INDEX_PATH);
        this.vectorStore.load(raw);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Claudian] failed to load RAG index:', message);
    }
  }

  onunload(): void {
    // Stop the warm whisper-server background process (if voice input ever
    // started one this session) — otherwise it would keep running after the
    // plugin unloads.
    whisperServerManager.stop();
    this.workflowEngine?.stop();
    this.providerStatusBar?.destroy();
    this.providerStatusBar = null;
    this.pluginUpdater = null;
    // Clear the debounced RAG-save timer and flush any pending index changes so
    // the last edits aren't lost and the timer doesn't fire on a torn-down plugin.
    if (this.ragSaveTimer !== null) {
      window.clearTimeout(this.ragSaveTimer);
      this.ragSaveTimer = null;
    }
    if (this.ragDirty) void this.saveRAGIndex();
    this.cachedMemoryStore?.dispose();
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
    new ModelComparisonModal(this.app, prompt, results).open();
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

  /**
   * Runs a single agent prompt against the active chat provider. Streams
   * partial output via `onChunk` and returns the final assembled text.
   */
  async runAgentPrompt(
    agent: { systemPrompt: string; name: string; model?: string },
    prompt: string,
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    const fullPrompt = `${agent.systemPrompt}\n\nUser request: ${prompt}\n\nRespond as ${agent.name}.`;
    return this.runRawPrompt(fullPrompt, onChunk, agent.model);
  }

  /**
   * Synthesis pass: a lead coordinator merges several specialists' independent
   * answers to the same task into one coherent, de-duplicated final answer.
   */
  async runSynthesisPrompt(
    prompt: string,
    contributions: { agent: { name: string; role: string }; output: string }[],
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    return this.runRawPrompt(buildSynthesisPrompt(prompt, contributions), onChunk);
  }

  /**
   * Runs a single agent prompt on a specific provider, streaming partial output
   * via `onChunk`. Used by the multi-agent team engine so each specialist can
   * run on its preferred provider. When the resolved provider is unavailable,
   * callers fall back to the active provider before invoking this method.
   */
  async runAgentPromptWithProvider(
    agent: { systemPrompt: string; name: string; model?: string },
    prompt: string,
    providerId: ProviderId,
    model: string | undefined,
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    const fullPrompt = `${agent.systemPrompt}\n\nUser request: ${prompt}\n\nRespond as ${agent.name}.`;
    return this.runRawPrompt(fullPrompt, onChunk, model, providerId);
  }

  /**
   * Resolves the effective provider for a specialist: its preferred provider
   * when that provider is enabled and multi-agent-capable, otherwise the
   * active chat provider. Passed to `runMission` as `resolveAgentProviderId`.
   */
  resolveMultiAgentProviderId(agent: SpecialistAgent): ProviderId {
    const activeProviderId = this.getActiveMultiAgentProviderId();
    const preferred = agent.providerId;
    if (preferred && this.isProviderMultiAgentAvailable(preferred)) {
      return preferred;
    }
    return activeProviderId;
  }

  /** True when the provider is registered, enabled, and supports multi-agent. */
  isProviderMultiAgentAvailable(providerId: ProviderId): boolean {
    const settingsBag = this.settings as unknown as Record<string, unknown>;
    return ProviderRegistry.isEnabled(providerId, settingsBag)
      && multiAgentAvailabilityService.isAvailable(providerId);
  }

  /** The active chat provider id, used as the multi-agent fallback. */
  getActiveMultiAgentProviderId(): ProviderId {
    const tab = this.getView()?.getActiveTab();
    return tab?.providerId ?? ProviderRegistry.resolveSettingsProviderId(this.settings);
  }

  /**
   * Builds a provider-aware executor for the multi-agent service. Each agent
   * runs on its resolved provider, falling back to the active provider when the
   * preferred one is unavailable (a setup error, not a rate limit).
   */
  buildMultiAgentExecutor(): AgentExecutor {
    const activeProviderId = this.getActiveMultiAgentProviderId();
    return {
      execute: (agent, prompt, onChunk) => this.runAgentPrompt(agent, prompt, onChunk ? (chunk) => onChunk(agent.id, chunk) : undefined),
      executeWithProvider: async (agent, prompt, providerId, model, onChunk) => {
        try {
          const resolved = providerId && this.isProviderMultiAgentAvailable(providerId)
            ? providerId
            : activeProviderId;
          return await this.runAgentPromptWithProvider(agent, prompt, resolved, model, onChunk ? (chunk) => onChunk(agent.id, chunk) : undefined);
        } catch (error) {
          // If the resolved preferred provider fails for a non-rate-limit
          // reason (e.g. not ready), retry once on the active provider before
          // surfacing the error to the service's failover logic.
          const message = error instanceof Error ? error.message : String(error);
          if (
            providerId
            && providerId !== activeProviderId
            && !isRateLimitErrorMessage(message)
          ) {
            return this.runAgentPromptWithProvider(agent, prompt, activeProviderId, undefined, onChunk ? (chunk) => onChunk(agent.id, chunk) : undefined);
          }
          throw error;
        }
      },
      isRateLimitError: (error) => isRateLimitErrorMessage(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }

  /** Runs a raw prompt on the active provider runtime, streaming text via onChunk. */
  async runRawPrompt(
    fullPrompt: string,
    onChunk?: (chunk: string) => void,
    modelOverride?: string,
    providerIdOverride?: ProviderId,
  ): Promise<string> {
    const tab = this.getView()?.getActiveTab();
    const activeProviderId = tab?.providerId ?? ProviderRegistry.resolveSettingsProviderId(this.settings);
    const providerId = providerIdOverride ?? activeProviderId;
    // Use the real model VALUE (not the selector's display label) so query() routes correctly.
    const model = modelOverride ?? this.getTabModel(providerId);

    const runtime = ProviderRegistry.createChatRuntime({ plugin: this, providerId });
    try {
      const ready = await runtime.ensureReady();
      if (!ready) {
        throw new Error(`Provider ${ProviderRegistry.getProviderDisplayName(providerId)} is not ready.`);
      }
      const prepared = runtime.prepareTurn({ text: fullPrompt });
      let text = '';
      for await (const chunk of runtime.query(prepared, [], { model })) {
        if (chunk.type === 'text') {
          text += chunk.content;
          onChunk?.(chunk.content);
        } else if (chunk.type === 'error') {
          throw new Error(chunk.content);
        }
      }
      return text;
    } finally {
      try {
        runtime.cleanup();
      } catch {
        // best-effort cleanup
      }
    }
  }

  private getTabModel(providerId: ProviderId): string {
    const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.settings, providerId);
    return snapshot.model as string;
  }

  /**
   * Runs a real one-shot vision prompt: picks a vision-capable provider
   * (prefers the active one), attaches the image, and returns the model's text.
   *
   * Public so the InputController can call it as a fallback when the active
   * provider's model rejects image input ("this model does not support image
   * input"). The descriptions produced here are then injected as text so the
   * conversation can continue without forcing the user to switch models.
   */
  async runVisionPrompt(image: ImageAttachment, prompt: string): Promise<string> {
    const settingsBag = this.settings as unknown as Record<string, unknown>;
    const activeProviderId =
      this.getView()?.getActiveTab()?.providerId ??
      ProviderRegistry.resolveSettingsProviderId(this.settings);

    const supportsImages = (id: ProviderId): boolean => {
      try {
        return ProviderRegistry.getCapabilities(id).supportsImageAttachments === true;
      } catch {
        return false;
      }
    };

    // Prefer the active provider; otherwise the first enabled provider that can
    // actually see images.
    let providerId: ProviderId | null = supportsImages(activeProviderId) ? activeProviderId : null;
    if (!providerId) {
      providerId = ProviderRegistry.getEnabledProviderIds(settingsBag).find(supportsImages) ?? null;
    }
    if (!providerId) {
      throw new Error('Kein bildfähiger Provider aktiviert. Aktiviere z. B. Claude, Pi oder Antigravity.');
    }

    const model = this.getTabModel(providerId);
    const runtime = ProviderRegistry.createChatRuntime({ plugin: this, providerId });
    try {
      const ready = await runtime.ensureReady();
      if (!ready) {
        throw new Error(`Provider ${ProviderRegistry.getProviderDisplayName(providerId)} ist nicht bereit.`);
      }
      // The image rides inside the prepared turn (request.images); the 2nd
      // query arg is conversation history, which is empty for a one-shot.
      const prepared = runtime.prepareTurn({ text: prompt, images: [image] });
      let text = '';
      for await (const chunk of runtime.query(prepared, [], { model })) {
        if (chunk.type === 'text') {
          text += chunk.content;
        } else if (chunk.type === 'error') {
          throw new Error(chunk.content);
        }
      }
      if (text.trim() === '') {
        throw new Error('Der Provider lieferte keine Bildbeschreibung zurück.');
      }
      return text;
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
    const timeline = getLastRunTimeline() ?? await this.runTimelineStore.getLatest();
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

  private async clearRunTimelineHistory(): Promise<void> {
    try {
      await this.runTimelineStore.clear();
      clearRunTimelines();
      new Notice('Persistente Run Timelines gelöscht.');
    } catch {
      new Notice('Run Timelines konnten nicht gelöscht werden.');
    }
  }

  private defaultRouterRulesFromModels(): ModelRouterRule[] {
    const models = ProviderRegistry.getAggregatedModelOptions(this.settings as unknown as Record<string, unknown>);
    const findModel = (task: ModelRouterTask, patterns: RegExp[]): ModelRouterRule | null => {
      const found = models.find(model => patterns.some(pattern => pattern.test(`${model.value} ${model.label}`)));
      return found ? { task, model: found.value } : null;
    };
    return [
      findModel('code', [/kimi.*code/i, /kimi.*for.*coding/i, /codex/i, /code/i, /sonnet/i, /claude/i]),
      findModel('writing', [/claude.*sonnet/i, /claude/i, /gpt/i, /sonnet/i]),
      findModel('planning', [/claude.*opus/i, /claude/i, /kimi/i, /reason/i, /o1/i, /o3/i]),
      findModel('vision', [/vision/i, /gpt-4o/i, /gpt-5/i, /gemini/i, /kimi/i, /claude/i]),
      findModel('analysis', [/kimi/i, /gpt/i, /claude/i, /sonnet/i]),
      findModel('document', [/claude/i, /gpt/i, /kimi/i]),
      findModel('cheap', [/haiku/i, /mini/i, /flash/i, /highspeed/i, /nano/i, /air/i]),
      findModel('longcontext', [/claude/i, /gemini/i, /kimi/i]),
    ].filter((rule): rule is ModelRouterRule => rule !== null);
  }

  /**
   * Silent model routing: returns the routing decision (or null if no switch
   * is needed) without UI side effects. Used by the auto-mode send hook.
   */
  resolveModelRouteForInput(prompt: string, tab: TabData): ModelRouteDecision | null {
    const settingsBag = this.settings as unknown as Record<string, unknown>;
    const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.settings, tab.providerId);
    // When Auto is active, draftModel is the sentinel '__auto__' — use the real
    // provider model (or the last routed model) as the routing fallback instead.
    const realDraftModel = tab.draftModel && tab.draftModel !== AUTO_MODEL_VALUE
      ? tab.draftModel
      : null;
    const fallbackModel = realDraftModel
      ?? tab.routedModel
      ?? String(snapshot.model ?? this.settings.model);
    const availableModels = ProviderRegistry.getAggregatedModelOptions(settingsBag);
    const explicitRules = normalizeRouterRules(this.settings.modelRouterRules);
    const rules = explicitRules.length > 0 ? explicitRules : this.defaultRouterRulesFromModels();

    // Context-aware routing: detect images, file extensions, and token estimate
    const context: ModelRouteContext = {};
    const imageContextManager = (this as any).imageStagingService;
    if (imageContextManager) {
      const images = imageContextManager.getAttachedImages?.() ?? [];
      if (images.length > 0) context.hasImages = true;
    }
    // Estimate tokens from prompt length (~4 chars/token)
    context.estimatedTokens = Math.ceil(prompt.length / 4);

    const decision = chooseModelRoute({ prompt, rules, availableModels, fallbackModel, context });

    if (decision.model === fallbackModel) {
      return null;
    }
    return decision;
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

    const decision = this.resolveModelRouteForInput(prompt, tab);
    if (!decision) {
      const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.settings, tab.providerId);
      const fallbackModel = tab.draftModel ?? String(snapshot.model ?? this.settings.model);
      new Notice(`Model Router: bleibe bei ${fallbackModel}.`);
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

  async createScheduledJob(args: string): Promise<ScheduledWorkflow> {
    const match = args.trim().match(/^(hourly|daily(?:@\d{2}:\d{2})?)\s+([\s\S]+)$/i);
    if (!match) throw new Error('Format: /schedule hourly <Aufgabe> oder /schedule daily@08:00 <Aufgabe>');
    const cron = match[1].toLowerCase();
    const prompt = match[2].trim();
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const workflow: ScheduledWorkflow = {
      id,
      name: this.currentInputNameFallback(prompt),
      enabled: true,
      trigger: { type: 'schedule', schedule: { cron } },
      steps: [{ id: `${id}-prompt`, action: 'agent-prompt', params: { prompt } }],
    };
    this.workflowEngine.register(workflow);
    return workflow;
  }

  private async executeWorkflowStep(step: WorkflowStep): Promise<void> {
    if (step.action === 'agent-prompt') {
      const prompt = String(step.params.prompt ?? '').trim();
      if (!prompt) throw new Error('Geplanter Agent-Job enthält keinen Prompt.');
      let response = '';
      await this.runRawPrompt(prompt, (chunk) => { response += chunk; });
      await this.ensureVaultFolder('Claudian/Scheduled');
      const path = `Claudian/Scheduled/${Date.now()}-${step.id.replace(/[^a-z0-9_-]/gi, '-')}.md`;
      await this.app.vault.create(path, [
        '---',
        'tags: [claudian, scheduled-job]',
        `created: ${new Date().toISOString()}`,
        `workflow_step: ${step.id}`,
        '---',
        '',
        '# Geplanter Agent-Lauf',
        '',
        '## Aufgabe',
        '',
        prompt,
        '',
        '## Ergebnis',
        '',
        response.trim() || '_(Keine Ausgabe)_',
      ].join('\n'));
      return;
    }
    if (step.action === 'vault-health') {
      const result = await this.vaultHealthService.orphanCheck();
      await this.createMarkdownNote('Claudian/Scheduled', `vault-health-${Date.now()}`, [
        '# Vault Health', '', result.summary, '', ...result.items.map((item) => `- ${item.path}: ${item.description}`),
      ].join('\n'));
      return;
    }
    throw new Error(`Unbekannte Workflow-Aktion: ${step.action}`);
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

  async openDashboard(): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice('Could not open dashboard.');
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_CLAUDIAN_DASHBOARD });
    this.app.workspace.revealLeaf(leaf);
  }

  async openRelatedNotesPanel(): Promise<void> {
    // Reuse an already-open panel instead of stacking duplicates.
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN_RELATED)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice('Konnte das Verwandte-Notizen-Panel nicht öffnen.');
      return;
    }
    if (!existing) {
      await leaf.setViewState({ type: VIEW_TYPE_CLAUDIAN_RELATED });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Exports a conversation (the active one by default) to a Markdown note in the
   * vault. The note preserves provider provenance and is auto-indexed by RAG.
   */
  async exportActiveConversation(conversationId?: string): Promise<void> {
    const id = conversationId ?? this.getView()?.getActiveTab()?.conversationId ?? null;
    if (!id) {
      new Notice('Keine aktive Konversation zum Exportieren.');
      return;
    }
    const conversation = await this.getConversationById(id);
    if (!conversation || conversation.messages.length === 0) {
      new Notice('Diese Konversation hat noch keine Nachrichten.');
      return;
    }
    try {
      await exportConversationToNote(this.app, conversation, {
        folder: this.settings.conversationExportFolder,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Export fehlgeschlagen: ${message}`);
    }
  }

  async undoLastAgentTurn(): Promise<void> {
    const conversationId = this.getView()?.getActiveTab()?.state.currentConversationId ?? undefined;
    try {
      const restored = await this.turnUndoService.revertLatest(conversationId)
        ?? await this.turnUndoService.revertLatest();
      if (!restored) {
        new Notice('Keine rückgängig machbaren Agent-Änderungen gefunden.');
        return;
      }
      const count = restored.changes.length;
      new Notice(`${count} Datei${count === 1 ? '' : 'en'} aus dem letzten Agent-Turn wiederhergestellt.`);
    } catch (error) {
      new Notice(`Agent-Undo fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  openCommandCenter(): void {
    new CommandCenterModal(this.app, this).open();
  }

  openConversationTree(): void {
    new ConversationTreeModal(this.app, this).open();
  }

  async exportActiveConversationHtml(conversationId?: string): Promise<void> {
    const id = conversationId ?? this.getView()?.getActiveTab()?.state.currentConversationId;
    if (!id) {
      new Notice('Keine aktive Konversation zum Exportieren.');
      return;
    }
    const conversation = await this.getConversationById(id);
    if (!conversation) return;
    try {
      const path = await exportConversationToHtml(this.app, conversation);
      new Notice(`HTML-Export gespeichert: ${path}`);
    } catch (error) {
      new Notice(`HTML-Export fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async exportActiveConversationPdf(conversationId?: string): Promise<void> {
    const id = conversationId ?? this.getView()?.getActiveTab()?.state.currentConversationId;
    if (!id) {
      new Notice('Keine aktive Konversation zum Exportieren.');
      return;
    }
    const conversation = await this.getConversationById(id);
    if (!conversation) return;
    try {
      const path = await exportConversationToPdf(this.app, conversation);
      new Notice(`PDF-Export gespeichert: ${path}`);
    } catch (error) {
      new Notice(`PDF-Export fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async indexVaultRAG(): Promise<void> {
    new Notice('Indexing vault for RAG...');
    const count = await this.vaultRAGService.indexVault({ limit: 1000 });
    await this.saveRAGIndex();
    new Notice(`RAG index complete: ${count} chunks indexed.`);
  }

  /**
   * Flagship recall: show notes semantically related to the active note, reusing
   * the RAG embeddings/vector store. Zero-prompt — the note's own content is the
   * query.
   */
  async showRelatedNotesForActiveNote(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!file) {
      new Notice('Öffne zuerst eine Notiz, um verwandte Notizen zu finden.');
      return;
    }
    if (this.settings.memoryEnabled === false) {
      new Notice('Aktiviere „Memory/RAG" in den Claudian-Einstellungen, um verwandte Notizen zu finden.');
      return;
    }
    if (this.vectorStore.size() === 0) {
      new Notice(this.vaultRAGService.indexing
        ? 'Der Vault-Index wird gerade aufgebaut — versuche es gleich erneut.'
        : 'Der Vault-Index ist noch leer. Führe „Reindex vault for RAG" aus.');
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    if (!buildRelatedQueryText(content)) {
      new Notice('Diese Notiz ist leer — es gibt nichts zu vergleichen.');
      return;
    }

    const related = await this.computeRelatedNotes(file);
    new RelatedNotesModal(this.app, file.path, related).open();
  }

  /**
   * Shared related-notes computation for the command modal and the ambient
   * side panel: embed the active note's (capped) content, search the vector
   * store, and collapse the chunk hits into a ranked per-note list. Returns []
   * for an empty note or empty index — callers render their own guidance.
   */
  async computeRelatedNotes(file: TFile): Promise<RelatedNote[]> {
    if (this.settings.memoryEnabled === false || this.vectorStore.size() === 0) {
      return [];
    }
    const content = await this.app.vault.cachedRead(file);
    const queryText = buildRelatedQueryText(content);
    if (!queryText) {
      return [];
    }
    const chunks = await this.vaultRAGService.query(queryText, { limit: RELATED_QUERY_LIMIT });
    return rankRelatedNotes(chunks, file.path, RELATED_RESULT_LIMIT);
  }

  async createClaudianProject(): Promise<void> {
    const existing = await this.projectService.listProjects().catch(() => []);
    const existingSlugs = new Set(existing.map(project => projectSlug(project.name)));

    new NewProjectModal(this.app, existingSlugs, (values) => {
      void (async () => {
        try {
          const slug = projectSlug(values.name);
          const id = await this.projectService.createProject({
            name: values.name,
            description: values.description,
            instructions: values.instructions,
            memoryFolder: `.claudian/projects/${slug}`,
            skills: [],
            mcpServers: [],
          });
          new Notice(dashboardStrings().npCreated(values.name, id));
        } catch (error) {
          new Notice(dashboardStrings().npFailed(error instanceof Error ? error.message : String(error)));
        }
      })();
    }).open();
  }

  async showAuditLog(): Promise<void> {
    const entries = this.auditLogService.query({ limit: 20 });
    const lines = entries.map(e => `- ${new Date(e.timestamp).toLocaleString()}: ${e.action} (${e.actor})`);
    const content = `# Audit Log\n\n${lines.join('\n') || '_No entries yet._'}`;
    const filePath = `.claudian/audit-log-${Date.now()}.md`;
    await this.app.vault.create(filePath, content);
    new Notice(`Audit log written to ${filePath}`);
  }

  async runMultiAgentTask(initialPrompt = ''): Promise<void> {
    await MultiAgentModal.open(this, initialPrompt);
  }

  /**
   * Runs an inline multi-agent team directly in the chat stream. The default
   * cross-provider roster runs in parallel, the lead synthesizer combines their
   * outputs, and the final answer appears as a normal chat message. Failovers
   * and per-agent progress surface via the global event bus (dashboard feed).
   */
  async runInlineTeamTask(
    taskPrompt: string,
    agentIds: string[] = DEFAULT_INLINE_TEAM_AGENT_IDS,
  ): Promise<{ synthesis: string; results: { agentId: string; output: string }[] }> {
    const executor = this.buildMultiAgentExecutor();
    const synthesizer = this.buildInlineTeamSynthesizer();
    const taskId = `inline-team-${Date.now()}`;

    const activeProviderId = this.getActiveMultiAgentProviderId();
    const result = await this.multiAgentService.runMission(
      { id: taskId, prompt: taskPrompt, agents: agentIds },
      executor,
      synthesizer,
      undefined,
      () => Date.now(),
      {
        defaultProviderId: activeProviderId,
        resolveAgentProviderId: (agent) => this.resolveMultiAgentProviderId(agent),
        maxFailovers: 3,
      },
    );
    return result;
  }

  /** Synthesizer that runs on the active provider and streams into the chat. */
  private buildInlineTeamSynthesizer(): { synthesize: (prompt: string, contributions: { agent: { name: string; role: string }; output: string }[], onChunk: (chunk: string) => void) => Promise<string> } {
    return {
      synthesize: async (taskPrompt, contributions, onChunk) => {
        const { buildSynthesisPrompt } = await import('./core/intelligence/multiAgent/MultiAgentService');
        const fullPrompt = buildSynthesisPrompt(taskPrompt, contributions);
        return this.runRawPrompt(fullPrompt, onChunk);
      },
    };
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

  private async initializeClaudianOSServices(): Promise<void> {
    const metadataPath = '.claudian/metadata/db.json';
    this.metadataStore = new MetadataStore(
      async () => this.app.vault.adapter.read(metadataPath).catch(() => '{}'),
      async (content) => this.app.vault.adapter.write(metadataPath, content),
    );
    await this.metadataStore.initialize();

    this.auditLogService = new AuditLogService(this.metadataStore);
    const workflowPath = '.claudian/scheduled-jobs.json';
    this.workflowEngine = new WorkflowEngine(async (step) => {
      globalEventBus.emit('agent:run-started', { stepId: step.id, action: step.action });
      try {
        await this.executeWorkflowStep(step);
        globalEventBus.emit('agent:run-completed', { stepId: step.id });
      } catch (error) {
        globalEventBus.emit('agent:run-error', { stepId: step.id, error });
        throw error;
      }
    }, {
      load: async () => {
        if (!(await this.app.vault.adapter.exists(workflowPath))) return [];
        const parsed = JSON.parse(await this.app.vault.adapter.read(workflowPath)) as unknown;
        return Array.isArray(parsed) ? parsed as ScheduledWorkflow[] : [];
      },
      save: async (workflows) => {
        if (!(await this.app.vault.adapter.exists('.claudian'))) await this.app.vault.adapter.mkdir('.claudian');
        await this.app.vault.adapter.write(workflowPath, JSON.stringify(workflows, null, 2));
      },
    });
    await this.workflowEngine.load();
    this.workflowEngine.start();

    this.projectService = new ProjectService(this.app.vault);
    this.agenticMemoryService = new AgenticMemoryService(this.app.vault);
    this.cachedMemoryStore = new CachedMemoryStore(this.app.vault);
    this.multiAgentService = new MultiAgentService();
    this.missionStateStorage = new MissionStateStorage(this.storage.getAdapter());
    this.visionService = new VisionService(this.app.vault);
    // Wire a real, provider-backed image analyzer (no mock): route the image to
    // a vision-capable provider runtime and return the model's description.
    this.visionService.setAnalyzer((image, prompt) => this.runVisionPrompt(image, prompt));

    // Register the full specialist pool (20 cross-provider agents). Each agent
    // may declare a preferred provider; the mission executor falls back to the
    // active provider when a preferred provider is unavailable, and the service
    // transfers context to a teammate on a different provider on rate limits.
    for (const agent of BUILT_IN_SPECIALIST_AGENTS) {
      this.multiAgentService.registerAgent(agent);
    }

    this.vectorStore = new VectorStore();
    // Start with the keyword provider so onload never blocks on a network probe.
    // If Ollama embeddings are enabled, the probe + provider swap happens later
    // in setupVaultRAGAutoIndex's onLayoutReady block (off the critical path),
    // before the index is loaded — the existing dimension guard then rebuilds
    // the vectors if the embedding dimension changed.
    this.embeddingService = new KeywordEmbeddingProvider();
    this.vaultRAGService = new VaultRAGService(this.app.vault, this.embeddingService, this.vectorStore);
  }

  /**
   * When Ollama embeddings are enabled, probe availability and swap the keyword
   * provider for Ollama. Runs off the onload critical path (from onLayoutReady)
   * because `isAvailable()` is a localhost HTTP round-trip that could otherwise
   * stall startup for seconds. Keeps the keyword fallback on any failure.
   */
  private async upgradeEmbeddingProviderIfConfigured(): Promise<void> {
    const ollamaSettings = this.settings.ollamaEmbedding ?? DEFAULT_CLAUDIAN_SETTINGS.ollamaEmbedding;
    if (!ollamaSettings?.enabled) return;

    const ollama = new OllamaEmbeddingProvider({
      baseUrl: ollamaSettings.baseUrl || 'http://localhost:11434',
      model: ollamaSettings.model || 'nomic-embed-text',
    });
    try {
      if (await ollama.isAvailable()) {
        this.embeddingService = ollama;
        // Rebuild the RAG service around the new provider, reusing the same
        // vector store; the dimension guard in setupVaultRAGAutoIndex re-indexes
        // if keyword (256-dim) → Ollama (768-dim) invalidated the stored vectors.
        this.vaultRAGService = new VaultRAGService(this.app.vault, this.embeddingService, this.vectorStore);
      }
    } catch {
      // isAvailable is defensive, but keep the keyword fallback on any error.
    }
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

    // A settings save may have changed a provider's CLI path or PATH-affecting
    // env vars, so drop the memoized PATH/Node resolutions to avoid serving a
    // stale enhanced PATH on the next turn.
    clearEnvPathCache();

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
    // Session metadata keeps image ids but intentionally omits base64. Preserve
    // it before provider hydration so images can be restored from the local
    // archive for CLIs whose transcript format drops binary attachments.
    const cachedMessages = conversation.messages;
    await ProviderRegistry
      .getConversationHistoryService(conversation.providerId)
      .hydrateConversationHistory(conversation, getVaultPath(this.app), {
        environment: {
          ...process.env,
          ...getRuntimeEnvironmentVariables(
            this.settings as unknown as Record<string, unknown>,
            conversation.providerId,
          ),
        },
        hostPlatform: process.platform,
        settings: this.settings as unknown as Record<string, unknown>,
        vaultPath: getVaultPath(this.app),
      });
    await this.restoreConversationImageData(conversation, cachedMessages);
  }

  /** Restores archived user images after native conversation hydration. */
  private async restoreConversationImageData(
    conversation: Conversation,
    cachedMessages: ChatMessage[],
  ): Promise<void> {
    // Positional pairing: the Nth cached user message corresponds to the Nth
    // hydrated user message. Computed once — O(messages), not O(messages²).
    const cachedUserMessages = cachedMessages.filter((message) => message.role === 'user');
    const hydratedUserMessages = conversation.messages.filter(
      (message) => message.role === 'user',
    );

    // Collect every message still missing bytes, then batch-load all image ids
    // with a single manifest read and parallel binary reads.
    const pending: { target: ChatMessage; imageIds: string[] }[] = [];
    cachedUserMessages.forEach((cachedMessage, userIndex) => {
      const targetMessage = hydratedUserMessages[userIndex] ?? cachedMessage;

      // File attachments (video/PDF cards) live only in local session metadata —
      // provider-native transcripts drop them. Carry them onto the hydrated
      // message so the media cards survive restarts.
      if ((cachedMessage.attachments?.length ?? 0) > 0 && !targetMessage.attachments?.length) {
        targetMessage.attachments = cachedMessage.attachments;
      }

      if ((cachedMessage.images?.length ?? 0) === 0) return;

      // Claude's own transcript includes image bytes. Prefer those rather than
      // duplicating the image from the local archive.
      if (targetMessage.images?.some((image) => image.data)) return;

      pending.push({
        target: targetMessage,
        imageIds: (cachedMessage.images ?? []).map((image) => image.id),
      });
    });
    if (pending.length === 0) return;

    const loaded = await this.imageStagingService.loadImages(
      pending.flatMap((item) => item.imageIds),
    );
    for (const { target, imageIds } of pending) {
      const images = imageIds
        .map((id) => loaded.get(id))
        .filter((image): image is ImageAttachment => image !== undefined);
      if (images.length > 0) {
        target.images = images;
      }
    }
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

    // Clear image data from memory after save. The durable image archive keeps
    // historic thumbnails available even for providers whose SDK transcript
    // does not retain base64 image content.
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

  getConversationSnapshots(): Conversation[] {
    return this.conversations.map((conversation) => ({
      ...conversation,
      messages: [...conversation.messages],
      providerState: conversation.providerState ? { ...conversation.providerState } : undefined,
    }));
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
