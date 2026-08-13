import * as fs from 'node:fs';

import { Notice, Setting } from 'obsidian';

import { firstOutputLine } from '../../../core/diagnostics/providerHealthCheck';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { t } from '../../../i18n/i18n';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetClineWorkspaceServices } from '../app/ClineWorkspaceServices';
import {
  formatClineAuthStatus,
  launchClineAuthInTerminal,
  readClineAuthStatus,
} from '../auth/ClineAuth';
import { getClineModelOptions } from '../modelOptions';
import { repairClineCompiledBinary } from '../runtime/ClineBinaryRepair';
import { probeClineVersion } from '../runtime/ClineProcess';
import {
  CLINE_PROVIDER_ID,
  getClineProviderSettings,
  updateClineProviderSettings,
} from '../settings';
import {
  CLINE_API_PROVIDERS,
  CLINE_COMPACTION_MODES,
  CLINE_THINKING_LEVELS,
  DEFAULT_CLINE_PRIMARY_MODEL,
  isClineApiProvider,
  isClineCompactionMode,
  isClineThinkingLevel,
} from '../types/models';
import { renderClineFeatureShowcase } from './ClineFeatureShowcase';

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
    const resolvedCliPath = context.plugin.getResolvedProviderCliPath(CLINE_PROVIDER_ID);

    renderClineFeatureShowcase(container, settings);

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName('Cline aktivieren')
      .setDesc('Cline CLI (`cline --json`) mit ClinePass-Modellen und Plan/Act als Provider starten.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange(async (value) => {
          updateClineProviderSettings(settingsBag, { enabled: value });
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        }),
      );

    const authStatusEl = container.createDiv({
      cls: 'claudian-cline-status-card claudian-cline-auth-status',
      text: formatClineAuthStatus(readClineAuthStatus(), settings.apiProvider),
    });

    const refreshAuthStatus = (): void => {
      authStatusEl.setText(formatClineAuthStatus(readClineAuthStatus(), settings.apiProvider));
    };

    new Setting(container)
      .setName('Anmelden')
      .setDesc('Startet `cline auth cline` im Terminal. ClinePass und Cline (Usage) teilen sich denselben Login — nicht die Abo-Seite.')
      .addButton((button) => {
        button.setButtonText('Im Terminal anmelden').onClick(() => {
          const command = context.plugin.getResolvedProviderCliPath(CLINE_PROVIDER_ID) || 'cline';
          const current = getClineProviderSettings(settingsBag);
          const repair = repairClineCompiledBinary(command);
          launchClineAuthInTerminal(command, current.apiProvider);
          new Notice(repair.repaired
            ? 'Cline-Binary neu signiert. Terminal geöffnet — dort anmelden.'
            : 'Terminal geöffnet. Melde dich dort an, danach ist Cline hier bereit.');
          window.setTimeout(refreshAuthStatus, 4000);
        });
      })
      .addButton((button) => {
        button.setButtonText('Status prüfen').onClick(() => {
          refreshAuthStatus();
          new Notice(authStatusEl.getText());
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
          refreshAuthStatus();
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
      .setDesc(
        resolvedCliPath
          ? `Optionaler absoluter Pfad zur \`cline\`-Binary. Erkannt: ${resolvedCliPath}`
          : 'Optionaler absoluter Pfad zur `cline`-Binary. Leer lassen, um `cline` aus dem PATH zu nehmen.',
      )
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

    const runtimeStatusEl = container.createDiv({
      cls: 'claudian-setting-validation claudian-cline-runtime-status',
      text: resolvedCliPath ? `Erkannt: ${resolvedCliPath}` : 'Noch nicht geprüft.',
    });
    new Setting(container)
      .setName('Cline-CLI prüfen')
      .setDesc('Startet `cline --version` mit bereinigter Umgebung. Ein fehlgeschlagener Versions-Check blockiert den Chat nicht.')
      .addButton((button) => button
        .setButtonText('Jetzt prüfen')
        .onClick(async () => {
          button.setDisabled(true);
          runtimeStatusEl.setText('Cline wird geprüft …');
          workspace?.cliResolver?.reset();
          const command = context.plugin.getResolvedProviderCliPath(CLINE_PROVIDER_ID);
          if (!command) {
            runtimeStatusEl.setText('Cline wurde nicht gefunden. Empfohlen: `npm i -g cline`.');
            button.setDisabled(false);
            return;
          }

          const repair = repairClineCompiledBinary(command);
          const result = await probeClineVersion(command);
          const repaired = repair.repaired ? ' · Binary neu signiert' : '';
          runtimeStatusEl.setText(result.ok
            ? `Bereit: ${firstOutputLine(result.output) || 'Version erkannt'} · ${command}${repaired}`
            : `Version-Check: ${result.detail ?? 'keine Antwort'} · ${command}. macOS killt oft eine kaputte Cline-Signatur — „Jetzt prüfen“ signiert neu.`);
          button.setDisabled(false);
        }));

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
      .setName('Modus')
      .setDesc('`--yolo` für Act ohne Freigaben, `--plan` für Plan-Modus. Headless-Turns brauchen YOLO, weil Freigaben hier nicht angezeigt werden.')
      .addDropdown((dropdown) => {
        dropdown.addOption('yolo', 'YOLO (Act)');
        dropdown.addOption('plan', 'Plan');
        dropdown.addOption('normal', 'Safe');
        dropdown.setValue(settings.permissionMode).onChange(async (value) => {
          if (value !== 'yolo' && value !== 'plan' && value !== 'normal') {
            return;
          }
          updateClineProviderSettings(settingsBag, { permissionMode: value });
          await context.plugin.saveSettings();
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
      .setName('Kompaktierung')
      .setDesc('`--compaction agentic|basic|off`. Agentic ist der CLI-Default; basic ist schneller bei langen Chats.')
      .addDropdown((dropdown) => {
        for (const mode of CLINE_COMPACTION_MODES) {
          dropdown.addOption(mode, mode);
        }
        dropdown.setValue(settings.compaction).onChange(async (value) => {
          if (!isClineCompactionMode(value)) {
            return;
          }
          updateClineProviderSettings(settingsBag, { compaction: value });
          await context.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName('Retries')
      .setDesc('`--retries` bei internen CLI-Fehlern (1–10).')
      .addSlider((slider) => {
        slider
          .setLimits(1, 10, 1)
          .setValue(settings.retries)
          .setDynamicTooltip()
          .onChange(async (value) => {
            updateClineProviderSettings(settingsBag, { retries: value });
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
