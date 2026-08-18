import * as fs from 'node:fs';

import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { t } from '../../../i18n/i18n';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetVibeWorkspaceServices } from '../app/VibeWorkspaceServices';
import { getVibeModelOptions } from '../modelOptions';
import {
  getVibeProviderSettings,
  updateVibeProviderSettings,
  VIBE_PROVIDER_ID,
} from '../settings';
import { DEFAULT_VIBE_PRIMARY_MODEL } from '../types/models';

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

export const vibeSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const settings = getVibeProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const workspace = maybeGetVibeWorkspaceServices();

    // --- Setup ---

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName('Vibe aktivieren')
      .setDesc('Vibe (`vibe -p --output streaming`) als Provider starten.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange(async (value) => {
          updateVibeProviderSettings(settingsBag, { enabled: value });
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
      updateVibeProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      workspace?.cliResolver?.reset();
      await context.plugin.saveSettings();
      context.refreshModelSelectors();
    };

    new Setting(container)
      .setName('CLI-Pfad')
      .setDesc('Optionaler absoluter Pfad zur `vibe`-Binary auf diesem Rechner. Leer lassen, um `vibe` aus dem PATH zu nehmen.')
      .addText((text) => {
        const currentValue = settings.cliPathsByHost[hostnameKey] || '';
        text
          .setPlaceholder(process.platform === 'win32'
            ? 'C:\\Users\\you\\.local\\bin\\vibe.exe'
            : '/Users/you/.local/bin/vibe')
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
      .setName('Standardmodell')
      .setDesc('Modell, das neue Unterhaltungen via `-m` bekommen. Ermittelt aus `~/.vibe/config.toml` plus den eigenen Modellen unten.')
      .addDropdown((dropdown) => {
        const options = getVibeModelOptions(settingsBag);
        for (const option of options) {
          dropdown.addOption(option.value, option.label);
        }
        const currentModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
        const selected = options.some((option) => option.value === currentModel)
          ? currentModel
          : options[0]?.value ?? DEFAULT_VIBE_PRIMARY_MODEL;
        dropdown.setValue(selected).onChange(async (value) => {
          settingsBag.model = value;
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        });
      });

    new Setting(container)
      .setName('Eigene Modelle')
      .setDesc('Zusätzliche Modell-Ids für die Auswahl, eine pro Zeile. `~/.vibe/config.toml` bestimmt, was die CLI wirklich kennt.')
      .addTextArea((text) => {
        text
          .setPlaceholder('mein-eigenes-modell')
          .setValue(settings.customModels)
          .onChange(async (value) => {
            updateVibeProviderSettings(settingsBag, { customModels: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          });
        text.inputEl.rows = 3;
      });

    context.renderCustomContextLimits(container, VIBE_PROVIDER_ID);

    // --- Behavior ---

    new Setting(container).setName('Verhalten').setHeading();

    new Setting(container)
      .setName('Standardmäßig denken')
      .setDesc('Neue Unterhaltungen mit aktivem `--thinking` starten. Pro Unterhaltung in der Chat-Leiste umschaltbar.')
      .addToggle((toggle) =>
        toggle.setValue(settings.thinkingDefault).onChange(async (value) => {
          updateVibeProviderSettings(settingsBag, { thinkingDefault: value });
          await context.plugin.saveSettings();
        }),
      );

    new Setting(container)
      .setName('Berechtigungen überspringen (YOLO)')
      .setDesc('`--yolo` plus `--agent auto-approve`: Vibe gibt alle Tool-Aufrufe frei (nötig im nicht-interaktiven `-p`-Modus).')
      .addToggle((toggle) =>
        toggle.setValue(settings.permissionMode === 'yolo').onChange(async (value) => {
          updateVibeProviderSettings(settingsBag, { permissionMode: value ? 'yolo' : 'normal' });
          await context.plugin.saveSettings();
        }),
      );

    // --- Agent ---

    new Setting(container).setName('Agent').setHeading();

    new Setting(container)
      .setName('Agenten-Preset')
      .setDesc('Eingebaute Agenten-Spezifikation, die via `--agent` übergeben wird.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('default', 'Default')
          .setValue(settings.agent)
          .onChange(async (value) => {
            updateVibeProviderSettings(settingsBag, { agent: value === 'okabe' ? 'okabe' : 'default' });
            await context.plugin.saveSettings();
          });
      });

    let agentFileInputEl: HTMLInputElement | null = null;
    const agentFileValidationEl = container.createDiv({
      cls: 'claudian-setting-validation claudian-setting-validation-error claudian-hidden',
    });

    new Setting(container)
      .setName('Eigene Agenten-Datei')
      .setDesc('Optionaler Pfad zu einer eigenen Agenten-Spezifikation, die via `--agent-file` übergeben wird.')
      .addText((text) => {
        text
          .setPlaceholder('/Users/you/.vibe/agents/custom.toml')
          .setValue(settings.agentFile)
          .onChange(async (value) => {
            const error = validateFilePath(value);
            agentFileValidationEl.toggleClass('claudian-hidden', !error);
            agentFileInputEl?.toggleClass('claudian-input-error', Boolean(error));
            if (error) {
              agentFileValidationEl.setText(error);
              return;
            }
            updateVibeProviderSettings(settingsBag, { agentFile: value });
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
      .setName('MCP-Konfigurationsdatei')
      .setDesc('Optionaler Pfad zu einer MCP-Server-Konfiguration, die via `--mcp-config-file` übergeben wird.')
      .addText((text) => {
        text
          .setPlaceholder('/Users/you/.vibe/mcp.json')
          .setValue(settings.mcpConfigFile)
          .onChange(async (value) => {
            const error = validateFilePath(value);
            mcpValidationEl.toggleClass('claudian-hidden', !error);
            mcpInputEl?.toggleClass('claudian-input-error', Boolean(error));
            if (error) {
              mcpValidationEl.setText(error);
              return;
            }
            updateVibeProviderSettings(settingsBag, { mcpConfigFile: value });
            await context.plugin.saveSettings();
          });
        mcpInputEl = text.inputEl;
      });

    // --- Environment ---

    renderEnvironmentSettingsSection({
      container,
      desc: 'Extra environment variables passed only to Vibe (`VIBE_*`, `MOONSHOT_*`).',
      heading: t('settings.environment'),
      name: 'Vibe environment variables',
      placeholder: 'VIBE_MODEL=vibe-k2\nMOONSHOT_API_KEY=...',
      plugin: context.plugin,
      scope: `provider:${VIBE_PROVIDER_ID}`,
    });
  },
};
