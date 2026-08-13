import * as fs from 'node:fs';

import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { t } from '../../../i18n/i18n';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetClineWorkspaceServices } from '../app/ClineWorkspaceServices';
import { getClineModelOptions } from '../modelOptions';
import {
  CLINE_PROVIDER_ID,
  getClineProviderSettings,
  updateClineProviderSettings,
} from '../settings';
import {
  CLINE_API_PROVIDERS,
  CLINE_THINKING_LEVELS,
  DEFAULT_CLINE_PRIMARY_MODEL,
  isClineApiProvider,
  isClineThinkingLevel,
} from '../types/models';

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

export const clineSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const settings = getClineProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const workspace = maybeGetClineWorkspaceServices();

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName('Cline aktivieren')
      .setDesc('Cline CLI (`cline --acp`) mit ClinePass-Modellen und Plan/Act als Provider starten.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange(async (value) => {
          updateClineProviderSettings(settingsBag, { enabled: value });
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        }),
      );

    new Setting(container)
      .setName('Anmelden')
      .setDesc('Öffnet `cline auth` im Browser. ClinePass und Cline (Usage) teilen sich denselben Login.')
      .addButton((button) => {
        button.setButtonText('cline auth').onClick(() => {
          window.open('https://app.cline.bot/dashboard/subscription?personal=true', '_blank');
        });
      });

    new Setting(container)
      .setName('API-Provider')
      .setDesc('ClinePass für das Abo, Cline für Usage-Billing, oder BYOK (Anthropic, OpenAI, OpenRouter, …).')
      .addDropdown((dropdown) => {
        for (const provider of CLINE_API_PROVIDERS) {
          dropdown.addOption(provider.id, provider.label);
        }
        dropdown.setValue(settings.apiProvider).onChange(async (value) => {
          if (!isClineApiProvider(value)) {
            return;
          }
          updateClineProviderSettings(settingsBag, { apiProvider: value });
          await context.plugin.saveSettings();
        });
      });

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
      updateClineProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      workspace?.cliResolver?.reset();
      await context.plugin.saveSettings();
      context.refreshModelSelectors();
    };

    new Setting(container)
      .setName('CLI-Pfad')
      .setDesc('Optionaler absoluter Pfad zur `cline`-Binary. Leer lassen, um `cline` aus dem PATH zu nehmen.')
      .addText((text) => {
        const currentValue = settings.cliPathsByHost[hostnameKey] || '';
        text
          .setPlaceholder(process.platform === 'win32'
            ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\cline.cmd'
            : '/Users/you/.npm-global/bin/cline')
          .setValue(currentValue)
          .onChange((value) => {
            void persistCliPath(value);
          });
        cliPathInputEl = text.inputEl;
        updateValidation(currentValue, text.inputEl);
      });

    new Setting(container).setName(t('settings.models')).setHeading();

    new Setting(container)
      .setName('Standardmodell')
      .setDesc('ClinePass-Katalog aus `@cline/llms` plus eigene Modell-IDs unten.')
      .addDropdown((dropdown) => {
        const options = getClineModelOptions(settingsBag);
        for (const option of options) {
          dropdown.addOption(option.value, option.label);
        }
        const currentModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
        const selected = options.some((option) => option.value === currentModel)
          ? currentModel
          : options[0]?.value ?? DEFAULT_CLINE_PRIMARY_MODEL;
        dropdown.setValue(selected).onChange(async (value) => {
          settingsBag.model = value;
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        });
      });

    new Setting(container)
      .setName('Thinking')
      .setDesc('`--thinking none|low|medium|high|xhigh` für neue Cline-Turns.')
      .addDropdown((dropdown) => {
        for (const level of CLINE_THINKING_LEVELS) {
          dropdown.addOption(level, level);
        }
        dropdown.setValue(settings.thinking).onChange(async (value) => {
          if (!isClineThinkingLevel(value)) {
            return;
          }
          updateClineProviderSettings(settingsBag, { thinking: value });
          await context.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName('Eigene Modelle')
      .setDesc('Eine Modell-ID pro Zeile, z. B. `anthropic/claude-sonnet-4.6` oder `openrouter/google/gemini-3-pro`.')
      .addTextArea((area) => {
        area
          .setPlaceholder('anthropic/claude-sonnet-4.6')
          .setValue(settings.customModels)
          .onChange(async (value) => {
            updateClineProviderSettings(settingsBag, { customModels: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          });
        area.inputEl.rows = 4;
      });

    renderEnvironmentSettingsSection({
      container,
      desc: 'Zusätzliche Variablen für Cline, z. B. CLINE_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY.',
      heading: t('settings.environment'),
      name: 'Cline-Umgebungsvariablen',
      placeholder: 'CLINE_API_KEY=\nCLINE_MODEL=cline-pass/kimi-k3',
      plugin: context.plugin,
      scope: `provider:${CLINE_PROVIDER_ID}`,
    });
  },
};
