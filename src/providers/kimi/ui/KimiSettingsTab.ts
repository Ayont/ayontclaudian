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
      .setName('Kimi aktivieren')
      .setDesc('Kimi Code (`kimi --output-format stream-json`) oder das ältere `kimi-cli` als Provider starten.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange(async (value) => {
          updateKimiProviderSettings(settingsBag, { enabled: value });
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        }),
      );

    new Setting(container)
      .setName('ACP-Modus verwenden')
      .setDesc('`kimi acp` für eine dauerhafte interaktive Sitzung mit nativem Plan-Modus, Freigaben, Subagenten und Hintergrundaufgaben. Setzt die neue `kimi`-Binary voraus.')
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
      .setName('API-Key')
      .setDesc('Moonshot-API-Key für Kimi. Wird lokal gespeichert und als MOONSHOT_API_KEY übergeben.')
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
      .setName('CLI-Pfad')
      .setDesc('Optionaler absoluter Pfad zur `kimi-cli`-Binary auf diesem Rechner. Leer lassen, um `kimi-cli` aus dem PATH zu nehmen.')
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
      .setName('Standardmodell')
      .setDesc('Modell, das neue Unterhaltungen via `-m` bekommen. Ermittelt aus `~/.kimi/config.toml` plus den eigenen Modellen unten.')
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
      .setName('Eigene Modelle')
      .setDesc('Zusätzliche Modell-Ids für die Auswahl, eine pro Zeile. Jede Id muss in `~/.kimi/config.toml` unter `[models.*]` deklariert sein — die verwalteten `kimi-code/*`-Modelle sind bereits enthalten.')
      .addTextArea((text) => {
        text
          .setPlaceholder('mein-eigenes-modell')
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

    new Setting(container).setName('Verhalten').setHeading();

    new Setting(container)
      .setName('Standardmäßig denken')
      .setDesc('Neue Unterhaltungen mit aktivem `--thinking` starten. Pro Unterhaltung in der Chat-Leiste umschaltbar.')
      .addToggle((toggle) =>
        toggle.setValue(settings.thinkingDefault).onChange(async (value) => {
          updateKimiProviderSettings(settingsBag, { thinkingDefault: value });
          await context.plugin.saveSettings();
        }),
      );

    new Setting(container)
      .setName('Berechtigungen überspringen (YOLO)')
      .setDesc('`--yolo` mitgeben, damit Kimi alle Aktionen selbst freigibt. Der Print-Modus gibt pro Aufruf ohnehin frei — dies ist die ausdrückliche YOLO-Variante.')
      .addToggle((toggle) =>
        toggle.setValue(settings.permissionMode === 'yolo').onChange(async (value) => {
          updateKimiProviderSettings(settingsBag, { permissionMode: value ? 'yolo' : 'normal' });
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
      .setName('Eigene Agenten-Datei')
      .setDesc('Optionaler Pfad zu einer eigenen Agenten-Spezifikation, die via `--agent-file` übergeben wird.')
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
      .setName('MCP-Konfigurationsdatei')
      .setDesc('Optionaler Pfad zu einer MCP-Server-Konfiguration, die via `--mcp-config-file` übergeben wird.')
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
      placeholder: 'KIMI_MODEL=kimi-code/k3\nMOONSHOT_API_KEY=...',
      plugin: context.plugin,
      scope: `provider:${KIMI_PROVIDER_ID}`,
    });
  },
};
