import * as fs from 'node:fs';

import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { t } from '../../../i18n/i18n';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetKimiWorkspaceServices } from '../app/KimiWorkspaceServices';
import { getKimiModelOptions } from '../modelOptions';
import {
  getKimiProviderSettings,
  KIMI_PROVIDER_ID,
  updateKimiProviderSettings,
} from '../settings';
import { DEFAULT_KIMI_PRIMARY_MODEL } from '../types/models';
import { renderKimiFeatureShowcase } from './KimiFeatureShowcase';

function validateFilePath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const expandedPath = expandHomePath(trimmed);
  if (!fs.existsSync(expandedPath)) {
    return 'Path does not exist';
  }
  if (!fs.statSync(expandedPath).isFile()) {
    return 'Path must point to a file';
  }
  return null;
}

export const kimiSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const settings = getKimiProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const workspace = maybeGetKimiWorkspaceServices();

    // --- Features (read-only overview of the full Kimi Code surface) ---

    renderKimiFeatureShowcase(container, settings);

    // --- Setup ---

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName('Enable Kimi')
      .setDesc('Launch Kimi Code (`kimi --output-format stream-json`) or legacy `kimi-cli` as a provider.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange(async (value) => {
          updateKimiProviderSettings(settingsBag, { enabled: value });
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        }),
      );

    new Setting(container)
      .setName('Use ACP mode')
      .setDesc('Run `kimi acp` for a persistent interactive session with native plan mode, approvals, subagents and background tasks. Requires the modern `kimi` binary.')
      .addToggle((toggle) =>
        toggle.setValue(settings.useAcp).onChange(async (value) => {
          updateKimiProviderSettings(settingsBag, { useAcp: value });
          await context.plugin.saveSettings();
        }),
      );

    const validationEl = container.createDiv({
      cls: 'claudian-cli-path-validation claudian-setting-validation claudian-setting-validation-error claudian-hidden',
    });
    const cliPathsByHost = { ...settings.cliPathsByHost };

    const envScope: `provider:${typeof KIMI_PROVIDER_ID}` = `provider:${KIMI_PROVIDER_ID}`;

    const readApiKeyFromEnv = (): string => {
      const envText = context.plugin.getEnvironmentVariablesForScope(envScope);
      const match = envText.match(/^MOONSHOT_API_KEY=(.*)$/m);
      return match?.[1]?.trim() ?? '';
    };

    const buildEnvWithoutApiKey = (): string => {
      const envText = context.plugin.getEnvironmentVariablesForScope(envScope);
      return envText
        .split('\n')
        .filter((line) => !line.trim().startsWith('MOONSHOT_API_KEY='))
        .join('\n');
    };

    const syncApiKeyToEnv = async (apiKey: string): Promise<void> => {
      const baseEnv = buildEnvWithoutApiKey();
      const nextEnv = apiKey.trim()
        ? `${baseEnv}${baseEnv.trim() ? '\n' : ''}MOONSHOT_API_KEY=${apiKey.trim()}`
        : baseEnv;
      await context.plugin.applyEnvironmentVariables(envScope, nextEnv);
    };

    new Setting(container)
      .setName('API key')
      .setDesc('Moonshot API key for Kimi. Stored locally and injected as MOONSHOT_API_KEY.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('sk-...')
          .setValue(settings.apiKey || readApiKeyFromEnv())
          .onChange(async (value) => {
            updateKimiProviderSettings(settingsBag, { apiKey: value });
            await syncApiKeyToEnv(value);
            await context.plugin.saveSettings();
          });
      });
    let cliPathInputEl: HTMLInputElement | null = null;

    const updateValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validateFilePath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.toggleClass('claudian-hidden', false);
        inputEl?.toggleClass('claudian-input-error', true);
        return false;
      }
      validationEl.toggleClass('claudian-hidden', true);
      inputEl?.toggleClass('claudian-input-error', false);
      return true;
    };

    const persistCliPath = async (value: string): Promise<void> => {
      if (!updateValidation(value, cliPathInputEl ?? undefined)) {
        return;
      }
      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }
      updateKimiProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      workspace?.cliResolver?.reset();
      await context.plugin.saveSettings();
      context.refreshModelSelectors();
    };

    new Setting(container)
      .setName('CLI path')
      .setDesc('Optional absolute path to the `kimi-cli` binary for this computer. Leave empty to use `kimi-cli` from PATH.')
      .addText((text) => {
        const currentValue = settings.cliPathsByHost[hostnameKey] || '';
        text
          .setPlaceholder(process.platform === 'win32'
            ? 'C:\\Users\\you\\.local\\bin\\kimi-cli.exe'
            : '/Users/you/.local/bin/kimi-cli')
          .setValue(currentValue)
          .onChange((value) => {
            void persistCliPath(value);
          });
        cliPathInputEl = text.inputEl;
        updateValidation(currentValue, text.inputEl);
      });

    // --- Models ---

    new Setting(container).setName(t('settings.models')).setHeading();

    new Setting(container)
      .setName('Default model')
      .setDesc('Model passed via `-m` for new conversations. Discovered from `~/.kimi/config.toml` plus any custom models below.')
      .addDropdown((dropdown) => {
        const options = getKimiModelOptions(settingsBag);
        for (const option of options) {
          dropdown.addOption(option.value, option.label);
        }
        const currentModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
        const selected = options.some((option) => option.value === currentModel)
          ? currentModel
          : options[0]?.value ?? DEFAULT_KIMI_PRIMARY_MODEL;
        dropdown.setValue(selected).onChange(async (value) => {
          settingsBag.model = value;
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        });
      });

    new Setting(container)
      .setName('Custom models')
      .setDesc('Extra model ids to show in the selector, one per line (e.g. `kimi-k2`).')
      .addTextArea((text) => {
        text
          .setPlaceholder('kimi-k2\nkimi-code/kimi-for-coding')
          .setValue(settings.customModels)
          .onChange(async (value) => {
            updateKimiProviderSettings(settingsBag, { customModels: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          });
        text.inputEl.rows = 3;
      });

    context.renderCustomContextLimits(container, KIMI_PROVIDER_ID);

    // --- Behavior ---

    new Setting(container).setName('Behavior').setHeading();

    new Setting(container)
      .setName('Thinking by default')
      .setDesc('Start new conversations with `--thinking` enabled. Toggle per-conversation from the chat toolbar.')
      .addToggle((toggle) =>
        toggle.setValue(settings.thinkingDefault).onChange(async (value) => {
          updateKimiProviderSettings(settingsBag, { thinkingDefault: value });
          await context.plugin.saveSettings();
        }),
      );

    new Setting(container)
      .setName('Skip permissions (YOLO)')
      .setDesc('Pass `--yolo` so Kimi auto-approves all actions. Print mode already auto-approves per invocation; enable for explicit YOLO behavior.')
      .addToggle((toggle) =>
        toggle.setValue(settings.permissionMode === 'yolo').onChange(async (value) => {
          updateKimiProviderSettings(settingsBag, { permissionMode: value ? 'yolo' : 'normal' });
          await context.plugin.saveSettings();
        }),
      );

    // --- Agent ---

    new Setting(container).setName('Agent').setHeading();

    new Setting(container)
      .setName('Agent preset')
      .setDesc('Builtin agent specification passed via `--agent`.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('default', 'Default')
          .addOption('okabe', 'Okabe')
          .setValue(settings.agent)
          .onChange(async (value) => {
            updateKimiProviderSettings(settingsBag, { agent: value === 'okabe' ? 'okabe' : 'default' });
            await context.plugin.saveSettings();
          });
      });

    let agentFileInputEl: HTMLInputElement | null = null;
    const agentFileValidationEl = container.createDiv({
      cls: 'claudian-setting-validation claudian-setting-validation-error claudian-hidden',
    });

    new Setting(container)
      .setName('Custom agent file')
      .setDesc('Optional path to a custom agent spec file passed via `--agent-file`.')
      .addText((text) => {
        text
          .setPlaceholder('/Users/you/.kimi/agents/custom.toml')
          .setValue(settings.agentFile)
          .onChange(async (value) => {
            const error = validateFilePath(value);
            agentFileValidationEl.toggleClass('claudian-hidden', !error);
            agentFileInputEl?.toggleClass('claudian-input-error', Boolean(error));
            if (error) {
              agentFileValidationEl.setText(error);
              return;
            }
            updateKimiProviderSettings(settingsBag, { agentFile: value });
            await context.plugin.saveSettings();
          });
        agentFileInputEl = text.inputEl;
      });

    // --- MCP ---

    new Setting(container).setName(t('settings.mcpServers.name')).setHeading();

    let mcpInputEl: HTMLInputElement | null = null;
    const mcpValidationEl = container.createDiv({
      cls: 'claudian-setting-validation claudian-setting-validation-error claudian-hidden',
    });

    new Setting(container)
      .setName('MCP config file')
      .setDesc('Optional path to an MCP servers config file passed via `--mcp-config-file`.')
      .addText((text) => {
        text
          .setPlaceholder('/Users/you/.kimi/mcp.json')
          .setValue(settings.mcpConfigFile)
          .onChange(async (value) => {
            const error = validateFilePath(value);
            mcpValidationEl.toggleClass('claudian-hidden', !error);
            mcpInputEl?.toggleClass('claudian-input-error', Boolean(error));
            if (error) {
              mcpValidationEl.setText(error);
              return;
            }
            updateKimiProviderSettings(settingsBag, { mcpConfigFile: value });
            await context.plugin.saveSettings();
          });
        mcpInputEl = text.inputEl;
      });

    // --- Environment ---

    renderEnvironmentSettingsSection({
      container,
      desc: 'Extra environment variables passed only to Kimi (`KIMI_*`, `MOONSHOT_*`).',
      heading: t('settings.environment'),
      name: 'Kimi environment variables',
      placeholder: 'KIMI_MODEL=kimi-k2\nMOONSHOT_API_KEY=...',
      plugin: context.plugin,
      scope: `provider:${KIMI_PROVIDER_ID}`,
    });
  },
};
