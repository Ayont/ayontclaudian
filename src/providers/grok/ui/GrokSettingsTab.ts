import * as fs from 'node:fs';

import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { t } from '../../../i18n/i18n';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetGrokWorkspaceServices } from '../app/GrokWorkspaceServices';
import { getGrokModelOptions } from '../modelOptions';
import {
  getGrokProviderSettings,
  GROK_PROVIDER_ID,
  updateGrokProviderSettings,
} from '../settings';
import { DEFAULT_GROK_PRIMARY_MODEL } from '../types/models';

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

export const grokSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const settings = getGrokProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const workspace = maybeGetGrokWorkspaceServices();

    // --- Setup ---

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName('Enable Grok')
      .setDesc('Launch Grok (`grok-cli --print --output-format stream-json`) as a provider.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange(async (value) => {
          updateGrokProviderSettings(settingsBag, { enabled: value });
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        }),
      );

    const validationEl = container.createDiv({
      cls: 'claudian-cli-path-validation claudian-setting-validation claudian-setting-validation-error claudian-hidden',
    });
    const cliPathsByHost = { ...settings.cliPathsByHost };
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
      updateGrokProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      workspace?.cliResolver?.reset();
      await context.plugin.saveSettings();
      context.refreshModelSelectors();
    };

    new Setting(container)
      .setName('CLI path')
      .setDesc('Optional absolute path to the `grok-cli` binary for this computer. Leave empty to use `grok-cli` from PATH.')
      .addText((text) => {
        const currentValue = settings.cliPathsByHost[hostnameKey] || '';
        text
          .setPlaceholder(process.platform === 'win32'
            ? 'C:\\Users\\you\\.local\\bin\\grok-cli.exe'
            : '/Users/you/.local/bin/grok-cli')
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
      .setDesc('Model passed via `-m` for new conversations. Discovered from `~/.grok/config.toml` plus any custom models below.')
      .addDropdown((dropdown) => {
        const options = getGrokModelOptions(settingsBag);
        for (const option of options) {
          dropdown.addOption(option.value, option.label);
        }
        const currentModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
        const selected = options.some((option) => option.value === currentModel)
          ? currentModel
          : options[0]?.value ?? DEFAULT_GROK_PRIMARY_MODEL;
        dropdown.setValue(selected).onChange(async (value) => {
          settingsBag.model = value;
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        });
      });

    new Setting(container)
      .setName('Custom models')
      .setDesc('Extra model ids to show in the selector, one per line (e.g. `grok-k2`).')
      .addTextArea((text) => {
        text
          .setPlaceholder('grok-k2\ngrok-code/grok-for-coding')
          .setValue(settings.customModels)
          .onChange(async (value) => {
            updateGrokProviderSettings(settingsBag, { customModels: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          });
        text.inputEl.rows = 3;
      });

    context.renderCustomContextLimits(container, GROK_PROVIDER_ID);

    // --- Behavior ---

    new Setting(container).setName('Behavior').setHeading();

    new Setting(container)
      .setName('Thinking by default')
      .setDesc('Start new conversations with `--thinking` enabled. Toggle per-conversation from the chat toolbar.')
      .addToggle((toggle) =>
        toggle.setValue(settings.thinkingDefault).onChange(async (value) => {
          updateGrokProviderSettings(settingsBag, { thinkingDefault: value });
          await context.plugin.saveSettings();
        }),
      );

    new Setting(container)
      .setName('Skip permissions (YOLO)')
      .setDesc('Pass `--yolo` so Grok auto-approves all actions. Print mode already auto-approves per invocation; enable for explicit YOLO behavior.')
      .addToggle((toggle) =>
        toggle.setValue(settings.permissionMode === 'yolo').onChange(async (value) => {
          updateGrokProviderSettings(settingsBag, { permissionMode: value ? 'yolo' : 'normal' });
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
          .setValue(settings.agent)
          .onChange(async (value) => {
            updateGrokProviderSettings(settingsBag, { agent: value === 'okabe' ? 'okabe' : 'default' });
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
          .setPlaceholder('/Users/you/.grok/agents/custom.toml')
          .setValue(settings.agentFile)
          .onChange(async (value) => {
            const error = validateFilePath(value);
            agentFileValidationEl.toggleClass('claudian-hidden', !error);
            agentFileInputEl?.toggleClass('claudian-input-error', Boolean(error));
            if (error) {
              agentFileValidationEl.setText(error);
              return;
            }
            updateGrokProviderSettings(settingsBag, { agentFile: value });
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
          .setPlaceholder('/Users/you/.grok/mcp.json')
          .setValue(settings.mcpConfigFile)
          .onChange(async (value) => {
            const error = validateFilePath(value);
            mcpValidationEl.toggleClass('claudian-hidden', !error);
            mcpInputEl?.toggleClass('claudian-input-error', Boolean(error));
            if (error) {
              mcpValidationEl.setText(error);
              return;
            }
            updateGrokProviderSettings(settingsBag, { mcpConfigFile: value });
            await context.plugin.saveSettings();
          });
        mcpInputEl = text.inputEl;
      });

    // --- Environment ---

    renderEnvironmentSettingsSection({
      container,
      desc: 'Extra environment variables passed only to Grok (`GROK_*`, `MOONSHOT_*`).',
      heading: t('settings.environment'),
      name: 'Grok environment variables',
      placeholder: 'GROK_MODEL=grok-k2\nMOONSHOT_API_KEY=...',
      plugin: context.plugin,
      scope: `provider:${GROK_PROVIDER_ID}`,
    });
  },
};
