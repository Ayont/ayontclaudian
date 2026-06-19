import { getProviderConfig } from '@/core/providers/providerConfig';
import {
  repairAllProviderConfigs,
  repairProviderConfig,
  validateAllProviderConfigs,
  validateProviderConfig,
} from '@/core/providers/providerConfigValidator';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderConfigValidator, ProviderRegistration } from '@/core/providers/types';

const TEST_PROVIDER_ID = 'test-provider';

function createTestRegistration(overrides: Partial<ProviderRegistration> = {}): ProviderRegistration {
  return {
    blankTabOrder: 1,
    capabilities: {
      providerId: TEST_PROVIDER_ID,
      supportsPersistentRuntime: false,
      supportsNativeHistory: false,
      supportsPlanMode: false,
      supportsRewind: false,
      supportsFork: false,
      supportsProviderCommands: false,
      supportsImageAttachments: false,
      supportsInstructionMode: false,
      supportsMcpTools: false,
      reasoningControl: 'none',
    },
    chatUIConfig: {
      getModelOptions: () => [],
      ownsModel: () => false,
      isAdaptiveReasoningModel: () => false,
      getReasoningOptions: () => [],
      getDefaultReasoningValue: () => '',
      getContextWindowSize: () => 100_000,
      isDefaultModel: () => false,
      applyModelDefaults: () => {},
      normalizeModelVariant: (model: string) => model,
      getCustomModelIds: () => new Set<string>(),
    },
    createInlineEditService: jest.fn(),
    createInstructionRefineService: jest.fn(),
    createRuntime: jest.fn(),
    createTitleGenerationService: jest.fn(),
    defaultConfig: {
      enabled: false,
      cliPath: '',
      environmentVariables: '',
      customModels: '',
      thinkingDefault: true,
      agent: 'default',
      agentFile: '',
      mcpConfigFile: '',
      permissionMode: 'normal',
      apiKey: '',
      useAcp: false,
      cliPathsByHost: {},
    },
    displayName: 'Test Provider',
    historyService: {} as unknown as ProviderRegistration['historyService'],
    isEnabled: () => true,
    settingsReconciler: {
      reconcileModelWithEnvironment: () => ({ changed: false, invalidatedConversations: [] }),
      normalizeModelVariantSettings: () => false,
    },
    taskResultInterpreter: {} as unknown as ProviderRegistration['taskResultInterpreter'],
    ...overrides,
  };
}

describe('providerConfigValidator', () => {
  beforeAll(() => {
    ProviderRegistry.register(TEST_PROVIDER_ID, createTestRegistration());
  });

  describe('validateProviderConfig', () => {
    it('reports missing provider config fields when registration has defaults', () => {
      const settings: Record<string, unknown> = { providerConfigs: {} };
      const { issues, repairable } = validateProviderConfig(TEST_PROVIDER_ID, settings);

      expect(repairable).toBe(true);
      expect(issues).toContainEqual(
        expect.objectContaining({
          providerId: TEST_PROVIDER_ID,
          code: 'missing-field',
          severity: 'error',
        }),
      );
    });

    it('reports missing fields and unknown fields', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          [TEST_PROVIDER_ID]: {
            enabled: true,
            unknownField: 'value',
          },
        },
      };

      const { issues, repairable } = validateProviderConfig(TEST_PROVIDER_ID, settings);
      const missingFields = issues.filter((issue) => issue.code === 'missing-field');
      const unknownFields = issues.filter((issue) => issue.code === 'unknown-field');

      expect(missingFields.length).toBeGreaterThan(0);
      expect(unknownFields).toHaveLength(1);
      expect(unknownFields[0]).toMatchObject({
        providerId: TEST_PROVIDER_ID,
        field: 'unknownField',
        severity: 'warning',
        autoRepairable: false,
      });
      expect(repairable).toBe(false);
    });

    it('reports type mismatches', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          [TEST_PROVIDER_ID]: {
            enabled: 'yes',
            cliPath: '',
            environmentVariables: '',
            customModels: '',
            thinkingDefault: true,
            agent: 'default',
            agentFile: '',
            mcpConfigFile: '',
            permissionMode: 'normal',
            apiKey: '',
            useAcp: false,
            cliPathsByHost: {},
          },
        },
      };

      const { issues } = validateProviderConfig(TEST_PROVIDER_ID, settings);
      const typeMismatches = issues.filter((issue) => issue.code === 'type-mismatch');

      expect(typeMismatches).toContainEqual(
        expect.objectContaining({ field: 'enabled', severity: 'error', autoRepairable: true }),
      );
    });
  });

  describe('repairProviderConfig', () => {
    it('creates a default config when missing', () => {
      const settings: Record<string, unknown> = { providerConfigs: {} };
      const { repaired, issues } = repairProviderConfig(TEST_PROVIDER_ID, settings);

      expect(repaired).toBe(true);
      expect(issues).toHaveLength(0);
      const config = getProviderConfig(settings, TEST_PROVIDER_ID);
      expect(config.enabled).toBe(false);
      expect(config.cliPath).toBe('');
    });

    it('coerces wrong types back to defaults without touching valid fields', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          [TEST_PROVIDER_ID]: {
            enabled: 'yes',
            cliPath: '/custom/cli',
            environmentVariables: '',
            customModels: '',
            thinkingDefault: true,
            agent: 'default',
            agentFile: '',
            mcpConfigFile: '',
            permissionMode: 'normal',
            apiKey: '',
            useAcp: false,
            cliPathsByHost: {},
          },
        },
      };

      const { repaired, issues } = repairProviderConfig(TEST_PROVIDER_ID, settings);

      expect(repaired).toBe(true);
      expect(issues).toHaveLength(0);
      const config = getProviderConfig(settings, TEST_PROVIDER_ID);
      expect(config.enabled).toBe(false);
      expect(config.cliPath).toBe('/custom/cli');
    });
  });

  describe('validateAllProviderConfigs', () => {
    it('aggregates issues across registered providers', () => {
      const settings: Record<string, unknown> = { providerConfigs: {} };
      const { issues, repairable } = validateAllProviderConfigs(settings);

      const testIssues = issues.filter((issue) => issue.providerId === TEST_PROVIDER_ID);
      expect(testIssues.length).toBeGreaterThan(0);
      expect(repairable).toBe(true);
    });
  });

  describe('repairAllProviderConfigs', () => {
    it('repairs all registered providers and returns per-provider results', () => {
      const settings: Record<string, unknown> = { providerConfigs: {} };
      const { repaired, results } = repairAllProviderConfigs(settings);

      expect(repaired).toBe(true);
      expect(results[TEST_PROVIDER_ID]).toMatchObject({ repaired: true });
    });
  });

  describe('provider-specific validator hook', () => {
    it('includes issues from the registered configValidator', () => {
      const validator: ProviderConfigValidator = {
        validate: () => [
          {
            severity: 'error',
            code: 'custom-rule',
            message: 'Custom validation failed',
            autoRepairable: false,
            field: 'customField',
          },
        ],
      };

      ProviderRegistry.register(
        TEST_PROVIDER_ID,
        createTestRegistration({ configValidator: validator }),
      );

      const settings: Record<string, unknown> = {
        providerConfigs: {
          [TEST_PROVIDER_ID]: {
            enabled: true,
            cliPath: '',
            environmentVariables: '',
            customModels: '',
            thinkingDefault: true,
            agent: 'default',
            agentFile: '',
            mcpConfigFile: '',
            permissionMode: 'normal',
            apiKey: '',
            useAcp: false,
            cliPathsByHost: {},
          },
        },
      };

      const { issues } = validateProviderConfig(TEST_PROVIDER_ID, settings);
      expect(issues).toContainEqual(
        expect.objectContaining({
          providerId: TEST_PROVIDER_ID,
          code: 'custom-rule',
          field: 'customField',
        }),
      );
    });
  });
});
