import * as fs from 'node:fs';

import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { t } from '../../../i18n/i18n';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetDshWorkspaceServices } from '../app/DshWorkspaceServices';
import {
  DSH_PROVIDER_ID,
  getDshProviderSettings,
  updateDshProviderSettings,
} from '../settings';

function validateBinaryPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const expandedPath = expandHomePath(trimmed);
  if (!fs.existsSync(expandedPath)) {
    return 'Pfad existiert nicht';
  }
  if (!fs.statSync(expandedPath).isFile()) {
    return 'Pfad muss auf eine Datei zeigen';
  }
  return null;
}

function validateHomePath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const expandedPath = expandHomePath(trimmed);
  if (!fs.existsSync(expandedPath) || !fs.statSync(expandedPath).isDirectory()) {
    return 'Ziel muss ein vorhandenes Verzeichnis sein';
  }
  return null;
}

export const dshSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const settings = getDshProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const workspace = maybeGetDshWorkspaceServices();

    // --- Setup ---

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName('DeepSeek Harness aktivieren')
      .setDesc('DeepSeek Harness (`dsh --profile headless`) als Provider starten. Jede Antwort führt einen Agenten-Lauf im Vault aus; Werkzeuge werden gemäß den dsh-eigenen Berechtigungen ausgeführt.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange(async (value) => {
          updateDshProviderSettings(settingsBag, { enabled: value });
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
      const error = validateBinaryPath(value);
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
      updateDshProviderSettings(settingsBag, { cliPathsByHost });
      await context.plugin.saveSettings();
      workspace?.cliResolver?.reset();
      context.refreshModelSelectors();
    };

    new Setting(container)
      .setName(`dsh-CLI-Pfad (${hostnameKey})`)
      .setDesc('Expliziter Pfad zum `dsh`-Binary. Leer lässt die Suche über PATH laufen (`npm i -g @deepseek-ai/dsh`).')
      .addText((text) =>
        text
          .setPlaceholder('/usr/local/bin/dsh')
          .setValue(settings.cliPathsByHost[hostnameKey] ?? '')
          .onChange((value) => {
            cliPathInputEl = text.inputEl;
            void persistCliPath(value);
          }),
      );

    new Setting(container)
      .setName('DSH_HOME (optional)')
      .setDesc('Alternatives Harness-Heimatverzeichnis statt ~/.dsh — z. B. für portable Setups. Leer lässt den Standard laufen.')
      .addText((text) =>
        text
          .setPlaceholder('~/.dsh')
          .setValue(settings.dshHome)
          .onChange(async (value) => {
            const trimmedValue = value.trim();
            const error = validateHomePath(trimmedValue);
            text.inputEl.toggleClass('claudian-input-error', Boolean(error));
            if (error) {
              return;
            }
            updateDshProviderSettings(settingsBag, { dshHome: trimmedValue });
            await context.plugin.saveSettings();
          }),
      );

    // --- Model ---

    new Setting(container).setName(t('settings.models')).setHeading();

    new Setting(container)
      .setName('Modellwahl')
      .setDesc('Das Headless-Profil nutzt immer die dsh-eigene Auswahl: agent-default-model in ~/.dsh/settings.yaml. Ein Umschalten hier ist bewusst nicht möglich — das CLI hätte sonst nichts davon.');

    // --- Environment ---

    renderEnvironmentSettingsSection({
      container,
      desc: 'Zusätzliche Umgebungsvariablen nur für dsh (`DSH_*`, API-Keys der im Harness konfigurierten Provider).',
      heading: t('settings.environment'),
      name: 'dsh-Umgebungsvariablen',
      placeholder: 'DSH_HOME=...\nOPENROUTER_API_KEY=...',
      plugin: context.plugin,
      scope: `provider:${DSH_PROVIDER_ID}`,
    });
  },
};
