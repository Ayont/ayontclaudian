import type {
  ChatMessage,
  Conversation,
  ConversationMeta,
  EnvSnippet,
  StreamChunk,
  ToolCallInfo
} from '@/core/types';
import {
  VIEW_TYPE_CLAUDIAN
} from '@/core/types';
import type { ClaudianSettings } from '@/core/types/settings';
import { getClaudeProviderSettings } from '@/providers/claude/settings';
import {
  CONTEXT_WINDOW_1M,
  CONTEXT_WINDOW_STANDARD,
  DEFAULT_CLAUDE_MODELS,
  DEFAULT_EFFORT_LEVEL,
  filterVisibleModelOptions,
  getContextWindowSize,
  isDefaultClaudeModel,
  isUltracodeEffort,
  normalizeEffortLevel,
  normalizeVisibleModelVariant,
  supportsXHighEffort,
  toApiEffortLevel,
} from '@/providers/claude/types/models';
import {
  createPermissionRule,
  DEFAULT_SETTINGS,
  parseCCPermissionRule,
} from '@/providers/claude/types/settings';

describe('types.ts', () => {
  describe('VIEW_TYPE_CLAUDIAN', () => {
    it('should be defined as the correct view type', () => {
      expect(VIEW_TYPE_CLAUDIAN).toBe('claudian-view');
    });
  });

  describe('DEFAULT_SETTINGS', () => {
    it('should default to yolo permission mode', () => {
      expect(DEFAULT_SETTINGS.permissionMode).toBe('yolo');
    });

    it('should have sharedEnvironmentVariables as empty string by default', () => {
      expect(DEFAULT_SETTINGS.sharedEnvironmentVariables).toBe('');
    });

    it('should have envSnippets as empty array by default', () => {
      expect(DEFAULT_SETTINGS.envSnippets).toEqual([]);
    });

    it('should have custom model aliases as an empty map by default', () => {
      expect(DEFAULT_SETTINGS.customModelAliases).toEqual({});
    });

    it('should have lastClaudeModel set to haiku by default', () => {
      expect(getClaudeProviderSettings(DEFAULT_SETTINGS).lastModel).toBe('haiku');
    });

    it('should have empty custom Claude models by default', () => {
      expect(getClaudeProviderSettings(DEFAULT_SETTINGS).customModels).toBe('');
    });

    it('should have lastCustomModel as empty string by default', () => {
      expect(DEFAULT_SETTINGS.lastCustomModel).toBe('');
    });

    it('should collapse file edits by default', () => {
      expect(DEFAULT_SETTINGS.expandFileEditsByDefault).toBe(false);
    });
  });

  describe('ClaudianSettings type', () => {
    it('should be assignable with valid settings', () => {
      const settings: ClaudianSettings = {
        userName: '',
        model: 'haiku',
        enableAutoTitleGeneration: true,
        titleGenerationModel: '',
        thinkingBudget: 'off',
        serviceTier: 'default',
        permissionMode: 'yolo',
        claudeSafeMode: 'acceptEdits',
        codexSafeMode: 'workspace-write',
        excludedTags: [],
        mediaFolder: '',
        sharedEnvironmentVariables: '',
        envSnippets: [],
        customContextLimits: {},
        customModelAliases: {},
        systemPrompt: '',

        persistentExternalContextPaths: [],
        keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' },
        requireCommandOrControlEnterToSend: false,
        locale: 'en',
        providerConfigs: {},
        claudeCliPath: '',
        claudeCliPathsByHost: {},
        loadUserClaudeSettings: false,
        maxTabs: 3,
        enableChrome: false,
        enableBangBash: false,
        enableOpus1M: false,
        enableSonnet1M: false,
        tabBarPosition: 'input',
        enableAutoScroll: true,
        deferMathRenderingDuringStreaming: true,
        expandFileEditsByDefault: false,
        chatViewPlacement: 'right-sidebar',
        hiddenProviderCommands: {
          claude: [],
          codex: [],
        },
        effortLevel: 'high',
        settingsProvider: 'claude',
        codexEnabled: false,
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
        savedProviderThinkingBudget: {},
        savedProviderPermissionMode: {},
      };

      expect(settings.permissionMode).toBe('yolo');
      expect(settings.model).toBe('haiku');
    });

    it('should accept custom model strings', () => {
      const settings: ClaudianSettings = {
        userName: '',
        model: 'anthropic/custom-model-v1',
        enableAutoTitleGeneration: true,
        titleGenerationModel: '',
        thinkingBudget: 'medium',
        serviceTier: 'default',
        permissionMode: 'normal',
        claudeSafeMode: 'acceptEdits',
        codexSafeMode: 'workspace-write',
        excludedTags: ['private'],
        mediaFolder: 'attachments',
        sharedEnvironmentVariables: 'API_KEY=test',
        envSnippets: [],
        customContextLimits: {},
        customModelAliases: {},
        systemPrompt: '',

        persistentExternalContextPaths: [],
        keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' },
        requireCommandOrControlEnterToSend: false,
        locale: 'zh-CN',
        providerConfigs: {},
        claudeCliPath: '',
        claudeCliPathsByHost: {},
        loadUserClaudeSettings: false,
        maxTabs: 3,
        enableChrome: false,
        enableBangBash: false,
        enableOpus1M: false,
        enableSonnet1M: false,
        tabBarPosition: 'input',
        enableAutoScroll: true,
        deferMathRenderingDuringStreaming: true,
        expandFileEditsByDefault: false,
        chatViewPlacement: 'right-sidebar',
        hiddenProviderCommands: {
          claude: [],
          codex: [],
        },
        effortLevel: 'high',
        settingsProvider: 'claude',
        codexEnabled: false,
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
        savedProviderThinkingBudget: {},
        savedProviderPermissionMode: {},
      };

      expect(settings.model).toBe('anthropic/custom-model-v1');
    });

    it('should accept optional lastClaudeModel and lastCustomModel', () => {
      const settings: ClaudianSettings = {
        userName: '',
        model: 'sonnet',
        enableAutoTitleGeneration: true,
        titleGenerationModel: '',
        lastClaudeModel: 'opus',
        lastCustomModel: 'custom/model',
        thinkingBudget: 'high',
        serviceTier: 'default',
        permissionMode: 'yolo',
        claudeSafeMode: 'acceptEdits',
        codexSafeMode: 'workspace-write',
        excludedTags: [],
        mediaFolder: '',
        sharedEnvironmentVariables: '',
        envSnippets: [],
        customContextLimits: {},
        customModelAliases: {},
        systemPrompt: '',

        persistentExternalContextPaths: [],
        keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' },
        requireCommandOrControlEnterToSend: true,
        locale: 'en',
        providerConfigs: {},
        claudeCliPath: '',
        claudeCliPathsByHost: {},
        loadUserClaudeSettings: false,
        maxTabs: 5,
        enableChrome: false,
        enableBangBash: false,
        enableOpus1M: false,
        enableSonnet1M: false,
        tabBarPosition: 'header',
        enableAutoScroll: false,
        deferMathRenderingDuringStreaming: true,
        expandFileEditsByDefault: true,
        chatViewPlacement: 'right-sidebar',
        hiddenProviderCommands: {
          claude: [],
          codex: [],
        },
        effortLevel: 'high',
        settingsProvider: 'claude',
        codexEnabled: false,
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
        savedProviderThinkingBudget: {},
        savedProviderPermissionMode: {},
      };

      expect(settings.lastClaudeModel).toBe('opus');
      expect(settings.lastCustomModel).toBe('custom/model');
    });
  });

  describe('EnvSnippet type', () => {
    it('should store all required fields', () => {
      const snippet: EnvSnippet = {
        id: 'snippet-123',
        name: 'Production Config',
        description: 'Production environment variables',
        envVars: 'API_KEY=prod-key\nDEBUG=false',
        modelAliases: {
          'custom-model': 'Production model',
        },
      };

      expect(snippet.id).toBe('snippet-123');
      expect(snippet.name).toBe('Production Config');
      expect(snippet.description).toBe('Production environment variables');
      expect(snippet.envVars).toContain('API_KEY=prod-key');
      expect(snippet.modelAliases?.['custom-model']).toBe('Production model');
    });

    it('should allow empty description', () => {
      const snippet: EnvSnippet = {
        id: 'snippet-789',
        name: 'Quick Config',
        description: '',
        envVars: 'KEY=value',
      };

      expect(snippet.description).toBe('');
    });
  });

  describe('ChatMessage type', () => {
    it('should accept user role', () => {
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };

      expect(msg.role).toBe('user');
    });

    it('should accept assistant role', () => {
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Hi there!',
        timestamp: Date.now(),
      };

      expect(msg.role).toBe('assistant');
    });

    it('should accept optional toolCalls array', () => {
      const toolCalls: ToolCallInfo[] = [
        {
          id: 'tool-1',
          name: 'Read',
          input: { file_path: '/test.txt' },
          status: 'completed',
          result: 'file contents',
        },
      ];

      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Reading file...',
        timestamp: Date.now(),
        toolCalls,
      };

      expect(msg.toolCalls).toEqual(toolCalls);
    });
  });

  describe('ToolCallInfo type', () => {
    it('should store tool name, input, status, and result', () => {
      const toolCall: ToolCallInfo = {
        id: 'tool-123',
        name: 'Bash',
        input: { command: 'ls -la' },
        status: 'completed',
        result: 'file1.txt\nfile2.txt',
      };

      expect(toolCall.id).toBe('tool-123');
      expect(toolCall.name).toBe('Bash');
      expect(toolCall.input).toEqual({ command: 'ls -la' });
      expect(toolCall.status).toBe('completed');
      expect(toolCall.result).toBe('file1.txt\nfile2.txt');
    });

    it('should accept running status', () => {
      const toolCall: ToolCallInfo = {
        id: 'tool-123',
        name: 'Read',
        input: { file_path: '/test.txt' },
        status: 'running',
      };

      expect(toolCall.status).toBe('running');
    });

    it('should accept error status', () => {
      const toolCall: ToolCallInfo = {
        id: 'tool-123',
        name: 'Read',
        input: { file_path: '/test.txt' },
        status: 'error',
        result: 'File not found',
      };

      expect(toolCall.status).toBe('error');
    });
  });

  describe('StreamChunk type', () => {
    it('should accept text type', () => {
      const chunk: StreamChunk = {
        type: 'text',
        content: 'Hello world',
      };

      expect(chunk.type).toBe('text');
      // eslint-disable-next-line jest/no-conditional-expect
      if (chunk.type === 'text') expect(chunk.content).toBe('Hello world');
    });

    it('should accept tool_use type', () => {
      const chunk: StreamChunk = {
        type: 'tool_use',
        id: 'tool-123',
        name: 'Read',
        input: { file_path: '/test.txt' },
      };

      expect(chunk.type).toBe('tool_use');
      if (chunk.type === 'tool_use') {
        // Type narrowing block - eslint-disable-next-line jest/no-conditional-expect
        expect(chunk.id).toBe('tool-123'); // eslint-disable-line jest/no-conditional-expect
        expect(chunk.name).toBe('Read'); // eslint-disable-line jest/no-conditional-expect
        expect(chunk.input).toEqual({ file_path: '/test.txt' }); // eslint-disable-line jest/no-conditional-expect
      }
    });

    it('should accept tool_result type', () => {
      const chunk: StreamChunk = {
        type: 'tool_result',
        id: 'tool-123',
        content: 'File contents here',
      };

      expect(chunk.type).toBe('tool_result');
      if (chunk.type === 'tool_result') {
        expect(chunk.id).toBe('tool-123'); // eslint-disable-line jest/no-conditional-expect
        expect(chunk.content).toBe('File contents here'); // eslint-disable-line jest/no-conditional-expect
      }
    });

    it('should accept error type', () => {
      const chunk: StreamChunk = {
        type: 'error',
        content: 'Something went wrong',
      };

      expect(chunk.type).toBe('error');
      // eslint-disable-next-line jest/no-conditional-expect
      if (chunk.type === 'error') expect(chunk.content).toBe('Something went wrong');
    });

    it('should accept warning notice type', () => {
      const chunk: StreamChunk = {
        type: 'notice',
        content: 'Command blocked: rm -rf',
        level: 'warning',
      };

      expect(chunk.type).toBe('notice');
      // eslint-disable-next-line jest/no-conditional-expect
      if (chunk.type === 'notice') expect(chunk.content).toBe('Command blocked: rm -rf');
    });

    it('should accept done type', () => {
      const chunk: StreamChunk = {
        type: 'done',
      };

      expect(chunk.type).toBe('done');
    });
  });

  describe('Conversation type', () => {
    it('should store conversation with all required fields', () => {
      const conversation: Conversation = {
        id: 'conv-123',
        providerId: 'claude',
        title: 'Test Conversation',
        createdAt: 1700000000000,
        updatedAt: 1700000001000,
        sessionId: 'session-abc',
        messages: [],
      };

      expect(conversation.id).toBe('conv-123');
      expect(conversation.title).toBe('Test Conversation');
      expect(conversation.createdAt).toBe(1700000000000);
      expect(conversation.updatedAt).toBe(1700000001000);
      expect(conversation.sessionId).toBe('session-abc');
      expect(conversation.messages).toEqual([]);
    });

    it('should allow null sessionId for new conversations', () => {
      const conversation: Conversation = {
        id: 'conv-456',
        providerId: 'claude',
        title: 'New Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: null,
        messages: [],
      };

      expect(conversation.sessionId).toBeNull();
    });

    it('should store messages array with ChatMessage objects', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
        { id: 'msg-2', role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
      ];

      const conversation: Conversation = {
        id: 'conv-789',
        providerId: 'claude',
        title: 'Chat with Messages',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'session-xyz',
        messages,
      };

      expect(conversation.messages).toHaveLength(2);
      expect(conversation.messages[0].role).toBe('user');
      expect(conversation.messages[1].role).toBe('assistant');
    });
  });

  describe('ConversationMeta type', () => {
    it('should store conversation metadata without messages', () => {
      const meta: ConversationMeta = {
        id: 'conv-123',
        providerId: 'claude',
        title: 'Test Conversation',
        createdAt: 1700000000000,
        updatedAt: 1700000001000,
        messageCount: 5,
        preview: 'Hello, how can I...',
      };

      expect(meta.id).toBe('conv-123');
      expect(meta.title).toBe('Test Conversation');
      expect(meta.createdAt).toBe(1700000000000);
      expect(meta.updatedAt).toBe(1700000001000);
      expect(meta.messageCount).toBe(5);
      expect(meta.preview).toBe('Hello, how can I...');
    });

    it('should have preview for empty conversations', () => {
      const meta: ConversationMeta = {
        id: 'conv-empty',
        providerId: 'claude',
        title: 'Empty Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        preview: 'New conversation',
      };

      expect(meta.messageCount).toBe(0);
      expect(meta.preview).toBe('New conversation');
    });
  });

  describe('Permission Conversion Utilities', () => {
    describe('parseCCPermissionRule', () => {
      it('should parse rule with pattern', () => {
        const result = parseCCPermissionRule(createPermissionRule('Bash(git status)'));
        expect(result.tool).toBe('Bash');
        expect(result.pattern).toBe('git status');
      });

      it('should parse rule with complex pattern', () => {
        const result = parseCCPermissionRule(createPermissionRule('WebFetch(domain:github.com)'));
        expect(result.tool).toBe('WebFetch');
        expect(result.pattern).toBe('domain:github.com');
      });

      it('should parse rule without pattern', () => {
        const result = parseCCPermissionRule(createPermissionRule('Read'));
        expect(result.tool).toBe('Read');
        expect(result.pattern).toBeUndefined();
      });

      it('should handle nested parentheses in pattern', () => {
        const result = parseCCPermissionRule(createPermissionRule('Bash(echo "hello (world)")'));
        expect(result.tool).toBe('Bash');
        expect(result.pattern).toBe('echo "hello (world)"');
      });

      it('should handle path patterns', () => {
        const result = parseCCPermissionRule(createPermissionRule('Read(/Users/test/vault/notes)'));
        expect(result.tool).toBe('Read');
        expect(result.pattern).toBe('/Users/test/vault/notes');
      });

      it('should return rule as tool for malformed input', () => {
        const result = parseCCPermissionRule(createPermissionRule('not-valid-format'));
        expect(result.tool).toBe('not-valid-format');
        expect(result.pattern).toBeUndefined();
      });
    });
  });

  describe('getContextWindowSize', () => {
    it('should return the standard window only for models that actually ship 200K', () => {
      // Verified against the CLI's own `modelUsage.contextWindow` (Claude Code
      // 2.1.226): `haiku` -> claude-haiku-4-5 -> 200000.
      expect(getContextWindowSize('haiku')).toBe(CONTEXT_WINDOW_STANDARD);
    });

    it('should report 1M for the bare `sonnet` and `opus` aliases', () => {
      // Regression: both aliases were reported at 200K, which made the usage
      // badge read 5x too full on the two models users select most.
      // `claude --model sonnet` -> claude-sonnet-5 -> contextWindow=1000000
      // `claude --model opus`   -> claude-opus-4-8 -> contextWindow=1000000
      expect(getContextWindowSize('sonnet')).toBe(CONTEXT_WINDOW_1M);
      expect(getContextWindowSize('opus')).toBe(CONTEXT_WINDOW_1M);
    });

    it('should use custom limits when provided', () => {
      const customLimits = { 'custom-model': 256000 };
      expect(getContextWindowSize('custom-model', customLimits)).toBe(256000);
    });

    it('should fall back to default when model not in custom limits', () => {
      const customLimits = { 'other-model': 256000 };
      expect(getContextWindowSize('sonnet', customLimits)).toBe(CONTEXT_WINDOW_1M);
    });

    it('should handle empty custom limits object', () => {
      expect(getContextWindowSize('sonnet', {})).toBe(CONTEXT_WINDOW_1M);
    });

    it('should handle undefined custom limits', () => {
      expect(getContextWindowSize('sonnet', undefined)).toBe(CONTEXT_WINDOW_1M);
    });

    describe('defensive validation for invalid custom limit values', () => {
      it('should fall back to default for NaN custom limit', () => {
        const customLimits = { 'custom-model': NaN };
        expect(getContextWindowSize('custom-model', customLimits)).toBe(CONTEXT_WINDOW_STANDARD);
      });

      it('should fall back to default for negative custom limit', () => {
        const customLimits = { 'custom-model': -100000 };
        expect(getContextWindowSize('custom-model', customLimits)).toBe(CONTEXT_WINDOW_STANDARD);
      });

      it('should fall back to default for zero custom limit', () => {
        const customLimits = { 'custom-model': 0 };
        expect(getContextWindowSize('custom-model', customLimits)).toBe(CONTEXT_WINDOW_STANDARD);
      });

      it('should fall back to default for Infinity custom limit', () => {
        const customLimits = { 'custom-model': Infinity };
        expect(getContextWindowSize('custom-model', customLimits)).toBe(CONTEXT_WINDOW_STANDARD);
      });

      it('should fall back to default for -Infinity custom limit', () => {
        const customLimits = { 'custom-model': -Infinity };
        expect(getContextWindowSize('custom-model', customLimits)).toBe(CONTEXT_WINDOW_STANDARD);
      });

      it('should accept valid positive custom limit', () => {
        const customLimits = { 'custom-model': 256000 };
        expect(getContextWindowSize('custom-model', customLimits)).toBe(256000);
      });
    });

    describe('[1m] suffix detection', () => {
      it('should return 1M context window for models with [1m] suffix', () => {
        expect(getContextWindowSize('opus[1m]')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('sonnet[1m]')).toBe(CONTEXT_WINDOW_1M);
      });

      it('should treat [1M] and [1m] suffixes equivalently', () => {
        expect(getContextWindowSize('opus[1M]')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('claude-opus-4-6[1M]')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('claude-sonnet-4-6[1M]')).toBe(CONTEXT_WINDOW_1M);
      });

      it('should return 1M for full model IDs with [1m] suffix', () => {
        expect(getContextWindowSize('claude-opus-4-6[1m]')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('claude-sonnet-4-6[1m]')).toBe(CONTEXT_WINDOW_1M);
      });

      it('should prefer custom limits over [1m] suffix', () => {
        const customLimits = { 'opus[1m]': 500000 };
        expect(getContextWindowSize('opus[1m]', customLimits)).toBe(500000);
      });

      it('should match custom limits case-insensitively for [1M] suffixes', () => {
        const customLimits = { 'claude-opus-4-6[1m]': 500000 };
        expect(getContextWindowSize('claude-opus-4-6[1M]', customLimits)).toBe(500000);
      });

      it('should return 1M for Fable (1M context is the default)', () => {
        // Fable 5 ships with 1M context by default — no [1m] suffix needed or gated.
        expect(getContextWindowSize('fable')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('fable[1m]')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('FABLE')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('claude-fable-5')).toBe(CONTEXT_WINDOW_1M);
      });

      it('should return 1M for the pinned ids that really default to 1M', () => {
        // Measured from `modelUsage.contextWindow` on a live turn, per model id.
        expect(getContextWindowSize('claude-opus-4-8')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('claude-opus-4-7')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('claude-sonnet-5')).toBe(CONTEXT_WINDOW_1M);
      });

      it('should report 200K for pinned ids that default to 200K', () => {
        // Regression, and it reverses an earlier assumption: a third-party
        // summary claimed Opus 5 was "1M default and maximum". The CLI disagrees
        // — `claude-opus-5` reports contextWindow=200000 (maxOutput=32000) while
        // `claude-opus-5[1m]` reports 1000000. Opus 4.6 is 200K as well; 1M as a
        // *default* only starts at Opus 4.7.
        expect(getContextWindowSize('claude-opus-5')).toBe(CONTEXT_WINDOW_STANDARD);
        expect(getContextWindowSize('claude-opus-4-6')).toBe(CONTEXT_WINDOW_STANDARD);
      });

      it('should honour an explicit [1m] opt-in on a 200K-default pinned id', () => {
        expect(getContextWindowSize('claude-opus-5[1m]')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('CLAUDE-OPUS-5[1M]')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('claude-opus-4-8[1M]')).toBe(CONTEXT_WINDOW_1M);
      });

      it('should still report 200K for pre-4.6 Opus ids and non-Opus families', () => {
        expect(getContextWindowSize('claude-opus-4-5')).toBe(CONTEXT_WINDOW_STANDARD);
        expect(getContextWindowSize('claude-opus-4-1')).toBe(CONTEXT_WINDOW_STANDARD);
        expect(getContextWindowSize('claude-sonnet-4-5')).toBe(CONTEXT_WINDOW_STANDARD);
        expect(getContextWindowSize('claude-haiku-4-5')).toBe(CONTEXT_WINDOW_STANDARD);
      });

      it('reports 1M for both spellings of the floating `opus` alias', () => {
        // The alias resolves to claude-opus-4-8 today, which is 1M either way.
        expect(getContextWindowSize('opus')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('opus[1m]')).toBe(CONTEXT_WINDOW_1M);
      });
    });

    describe('filterVisibleModelOptions', () => {
      it('should hide 1M variants when toggles are disabled', () => {
        const models = filterVisibleModelOptions(DEFAULT_CLAUDE_MODELS, false, false).map((model) => model.value);
        expect(models).toEqual(['haiku', 'sonnet', 'opus', 'claude-opus-5', 'claude-opus-4-8', 'fable']);
      });

      it('should swap in 1M variants when toggles are enabled', () => {
        const models = filterVisibleModelOptions(DEFAULT_CLAUDE_MODELS, true, true).map((model) => model.value);
        expect(models).toEqual(['haiku', 'sonnet[1m]', 'opus[1m]', 'claude-opus-5[1m]', 'claude-opus-4-8', 'fable']);
      });

      it('should swap only opus when enableOpus1M is true and enableSonnet1M is false', () => {
        const models = filterVisibleModelOptions(DEFAULT_CLAUDE_MODELS, true, false).map((model) => model.value);
        expect(models).toEqual(['haiku', 'sonnet', 'opus[1m]', 'claude-opus-5[1m]', 'claude-opus-4-8', 'fable']);
      });

      it('should swap only sonnet when enableSonnet1M is true and enableOpus1M is false', () => {
        const models = filterVisibleModelOptions(DEFAULT_CLAUDE_MODELS, false, true).map((model) => model.value);
        expect(models).toEqual(['haiku', 'sonnet[1m]', 'opus', 'claude-opus-5', 'claude-opus-4-8', 'fable']);
      });

      it('should leave a pinned id without a [1m] sibling visible under either toggle', () => {
        // Opus 4.8 is 1M by default and has no 200K spelling to switch back to,
        // so it must survive both settings rather than being filtered as a pair.
        for (const enableOpus1M of [false, true]) {
          const models = filterVisibleModelOptions(DEFAULT_CLAUDE_MODELS, enableOpus1M, false)
            .map((model) => model.value);
          expect(models).toContain('claude-opus-4-8');
          expect(models).toContain('fable');
          expect(models).toContain('haiku');
        }
      });

      it('should keep exactly one Opus 5 spelling visible under either toggle', () => {
        // Opus 5 defaults to 200K and offers 1M as an opt-in, so it behaves like the
        // `opus`/`opus[1m]` pair: never both, never neither.
        for (const enableOpus1M of [false, true]) {
          const opus5 = filterVisibleModelOptions(DEFAULT_CLAUDE_MODELS, enableOpus1M, false)
            .map(m => m.value)
            .filter(value => value.startsWith('claude-opus-5'));
          expect(opus5).toEqual([enableOpus1M ? 'claude-opus-5[1m]' : 'claude-opus-5']);
        }
      });

      it('should always show fable (1M context is its default, no toggle)', () => {
        // Fable must appear regardless of the 1M toggles (which only gate Sonnet/Opus).
        expect(filterVisibleModelOptions(DEFAULT_CLAUDE_MODELS, false, false).map(m => m.value)).toContain('fable');
        expect(filterVisibleModelOptions(DEFAULT_CLAUDE_MODELS, true, true).map(m => m.value)).toContain('fable');
      });
    });

    describe('normalizeVisibleModelVariant', () => {
      it('should normalize built-in variants to the visible option', () => {
        expect(normalizeVisibleModelVariant('sonnet', true, true)).toBe('sonnet[1m]');
        expect(normalizeVisibleModelVariant('sonnet[1m]', false, false)).toBe('sonnet');
        expect(normalizeVisibleModelVariant('opus', true, false)).toBe('opus[1m]');
        expect(normalizeVisibleModelVariant('opus[1m]', false, true)).toBe('opus');
      });

      it('should normalize built-in variants regardless of 1M suffix casing', () => {
        expect(normalizeVisibleModelVariant('sonnet[1M]', false, false)).toBe('sonnet');
        expect(normalizeVisibleModelVariant('opus[1M]', true, false)).toBe('opus[1m]');
      });

      it('should normalize pinned ids that ship both a plain and a [1m] spelling', () => {
        expect(normalizeVisibleModelVariant('claude-opus-5', true, false)).toBe('claude-opus-5[1m]');
        expect(normalizeVisibleModelVariant('claude-opus-5[1m]', false, false)).toBe('claude-opus-5');
        expect(normalizeVisibleModelVariant('CLAUDE-OPUS-5[1M]', false, false)).toBe('claude-opus-5');
      });

      it('should leave pinned ids without a [1m] sibling untouched', () => {
        expect(normalizeVisibleModelVariant('claude-opus-4-8', true, true)).toBe('claude-opus-4-8');
        expect(normalizeVisibleModelVariant('fable', true, true)).toBe('fable');
      });

      it('should leave unrelated model ids unchanged', () => {
        expect(normalizeVisibleModelVariant('', true, true)).toBe('');
        expect(normalizeVisibleModelVariant('haiku', true, true)).toBe('haiku');
        expect(normalizeVisibleModelVariant('custom-model', true, true)).toBe('custom-model');
      });
    });
  });

  // Regression: verified live against the installed CLI (Claude Code 2.1.219) —
  // `claude --model claude-opus-5 -p ...` and `claude --model claude-opus-4-8 -p ...`
  // both responded (not the "model may not exist" error a bogus id produces), and
  // `claude --model opus -p "what is your exact model id?"` self-reported
  // `claude-opus-5`. So the floating `opus` alias already tracks the newest release,
  // while the pinned dated ids let a user stay on a specific generation deliberately.
  describe('DEFAULT_CLAUDE_MODELS pinned Opus generations', () => {
    it('offers both the floating `opus` alias and pinned Opus 5 / Opus 4.8 ids', () => {
      const values = DEFAULT_CLAUDE_MODELS.map(m => m.value);
      expect(values).toContain('opus');
      expect(values).toContain('claude-opus-5');
      expect(values).toContain('claude-opus-4-8');
    });

    it('recognizes the pinned ids as default (non-custom) models', () => {
      expect(isDefaultClaudeModel('claude-opus-5')).toBe(true);
      expect(isDefaultClaudeModel('claude-opus-4-8')).toBe(true);
      expect(isDefaultClaudeModel('CLAUDE-OPUS-5')).toBe(true);
    });

    it('gives the pinned ids a default effort level of high', () => {
      expect(DEFAULT_EFFORT_LEVEL['claude-opus-5']).toBe('high');
      expect(DEFAULT_EFFORT_LEVEL['claude-opus-4-8']).toBe('high');
    });
  });

  describe('supportsXHighEffort', () => {
    it('returns true for opus aliases and 4.7+ opus ids', () => {
      expect(supportsXHighEffort('opus')).toBe(true);
      expect(supportsXHighEffort('opus[1m]')).toBe(true);
      expect(supportsXHighEffort('opus[1M]')).toBe(true);
      expect(supportsXHighEffort('claude-opus-4-7')).toBe(true);
      expect(supportsXHighEffort('claude-opus-4-8')).toBe(true);
      expect(supportsXHighEffort('claude-opus-5')).toBe(true);
    });

    it('returns true for Fable (Mythos-class flagship, xhigh-capable)', () => {
      expect(supportsXHighEffort('fable')).toBe(true);
      expect(supportsXHighEffort('fable[1m]')).toBe(true);
      expect(supportsXHighEffort('FABLE')).toBe(true);
      expect(supportsXHighEffort('claude-fable-5')).toBe(true);
    });

    // Regression: `sonnet` used to be asserted as NOT xhigh-capable, which hid the
    // level in the picker and made normalizeEffortLevel() silently rewrite a user's
    // `xhigh` to `high` when they switched to Sonnet. The bundled SDK is explicit:
    // "'xhigh' — Deeper than high (Fable 5, Opus 4.7+, Sonnet 5)", and it documents
    // the alias resolution 'sonnet' -> 'claude-sonnet-5'.
    it('returns true for the sonnet alias and Sonnet 5+ ids', () => {
      expect(supportsXHighEffort('sonnet')).toBe(true);
      expect(supportsXHighEffort('sonnet[1m]')).toBe(true);
      expect(supportsXHighEffort('claude-sonnet-5')).toBe(true);
    });

    it('returns false for pre-xhigh ids in both families', () => {
      // xhigh landed in Opus 4.7 and Sonnet 5 — one minor version later than `max`.
      expect(supportsXHighEffort('claude-sonnet-4-6')).toBe(false);
      expect(supportsXHighEffort('claude-sonnet-4-5')).toBe(false);
      expect(supportsXHighEffort('claude-opus-4-6')).toBe(false);
      expect(supportsXHighEffort('haiku')).toBe(false);
    });
  });

  describe('normalizeEffortLevel', () => {
    it('preserves supported effort levels', () => {
      expect(normalizeEffortLevel('claude-opus-4-7', 'xhigh')).toBe('xhigh');
      expect(normalizeEffortLevel('claude-sonnet-4-6', 'max')).toBe('max');
    });

    // Regression: `max` was offered on every model, including ones where the SDK
    // documents it as an error rather than a silent downgrade.
    it('clamps max on models where the SDK rejects it', () => {
      expect(normalizeEffortLevel('haiku', 'max')).toBe('high');
      expect(normalizeEffortLevel('claude-haiku-4-5', 'max')).toBe('high');
      expect(normalizeEffortLevel('claude-sonnet-4-5', 'max')).toBe('high');
    });

    it('keeps max on unknown/custom model ids', () => {
      // supportsMaxEffort is a deny-list on purpose: stripping `max` from custom
      // gateway models to prevent a mislabel would be the worse trade.
      expect(normalizeEffortLevel('my-gateway-model', 'max')).toBe('max');
      expect(normalizeEffortLevel('claude-opus-9', 'max')).toBe('max');
    });

    it('clamps unsupported xhigh values to the model default', () => {
      expect(normalizeEffortLevel('claude-sonnet-4-5', 'xhigh')).toBe('high');
      expect(normalizeEffortLevel('haiku', 'xhigh')).toBe('high');
    });

    it('falls back to high for unknown or missing effort values', () => {
      expect(normalizeEffortLevel('claude-sonnet-4-5', 'invalid')).toBe('high');
      expect(normalizeEffortLevel('claude-sonnet-4-5', undefined)).toBe('high');
    });
  });

  describe('ultracode effort', () => {
    it('allows ultracode on xhigh-capable models and clamps elsewhere', () => {
      expect(normalizeEffortLevel('opus', 'ultracode')).toBe('ultracode');
      expect(normalizeEffortLevel('opus[1m]', 'ultracode')).toBe('ultracode');
      // Sonnet resolves to Sonnet 5, which is xhigh-capable, so ultracode applies.
      expect(normalizeEffortLevel('sonnet', 'ultracode')).toBe('ultracode');
      // Non-xhigh models cannot select ultracode -> clamped to the model default.
      expect(normalizeEffortLevel('haiku', 'ultracode')).toBe('high');
      expect(normalizeEffortLevel('claude-sonnet-4-6', 'ultracode')).toBe('high');
    });

    it('isUltracodeEffort only matches the ultracode value', () => {
      expect(isUltracodeEffort('ultracode')).toBe(true);
      expect(isUltracodeEffort('xhigh')).toBe(false);
      expect(isUltracodeEffort('max')).toBe(false);
      expect(isUltracodeEffort(undefined)).toBe(false);
    });

    it('toApiEffortLevel maps ultracode to xhigh and passes other levels through', () => {
      expect(toApiEffortLevel('ultracode')).toBe('xhigh');
      expect(toApiEffortLevel('xhigh')).toBe('xhigh');
      expect(toApiEffortLevel('high')).toBe('high');
      expect(toApiEffortLevel('max')).toBe('max');
    });
  });
});
