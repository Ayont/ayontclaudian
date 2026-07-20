import { getDefaultHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import { type ClaudianSettings } from '../../core/types/settings';
import { getBuiltInProviderDefaultConfigs } from '../../providers/defaultProviderConfigs';

export const DEFAULT_CLAUDIAN_SETTINGS: ClaudianSettings = {
  userName: '',

  permissionMode: 'yolo',
  autoMode: false,
  autoModePauseAfter: 25,
  modelRouterEnabled: true,
  modelRouterRules: [],
  promptTemplateFolder: 'Templates/Prompt Templates',
  conversationExportFolder: 'Claudian/Conversations',
  diffPreviewBeforeWrites: true,
  memoryEnabled: true,
  memoryFolder: '.claudian/memory',
  memoryMaxNotes: 5,
  tokenBudgetEnabled: false,
  dailyTokenBudget: 0,
  sessionTokenBudget: 0,

  ollamaEmbedding: {
    enabled: true,
    baseUrl: 'http://localhost:11434',
    model: 'nomic-embed-text',
  },

  voiceSettings: {
    enabled: true,
    language: 'auto',
    model: 'base',
    autoSetup: true,
    microphoneId: '',
    preferFastBackend: true,
    cloudEnabled: false,
    cloudBaseUrl: '',
    cloudApiKey: '',
    cloudModel: '',
  },

  model: 'haiku',
  thinkingBudget: 'off',
  effortLevel: 'high',
  serviceTier: 'default',
  enableAutoTitleGeneration: true,
  titleGenerationModel: '',

  excludedTags: [],
  mediaFolder: '',
  systemPrompt: '',
  workspaceMode: 'code',
  multiAgentTeam: [],
  multiAgentUseCustomTeam: false,
  workspaceModeModels: {},
  persistentExternalContextPaths: [],

  sharedEnvironmentVariables: '',
  envSnippets: [],
  customContextLimits: {},
  customModelAliases: {},

  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },
  requireCommandOrControlEnterToSend: false,

  locale: 'en',

  providerConfigs: getBuiltInProviderDefaultConfigs(),

  settingsProvider: 'claude',
  savedProviderModel: {},
  savedProviderEffort: {},
  savedProviderServiceTier: {},
  savedProviderThinkingBudget: {},
  savedProviderPermissionMode: {},

  lastCustomModel: '',

  maxTabs: 3,
  tabBarPosition: 'input',
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  expandFileEditsByDefault: false,
  chatViewPlacement: 'right-sidebar',

  hiddenProviderCommands: getDefaultHiddenProviderCommands(),
};
