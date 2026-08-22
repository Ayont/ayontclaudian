import * as fs from 'node:fs';

import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { expandHomePath } from '../../../utils/path';
import { FreebuffOrchestratorClient } from '../runtime/FreebuffOrchestratorClient';
import {
  getFreebuffProviderSettings,
  updateFreebuffProviderSettings,
} from '../settings';
import { formatFreebuffModelLabel } from '../types/models';

function validateDirectoryPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    if (!fs.statSync(expandHomePath(trimmed)).isDirectory()) {
      return 'Ziel muss ein vorhandenes Verzeichnis sein';
    }
  } catch {
    return 'Ziel muss ein vorhandenes Verzeichnis sein';
  }
  return null;
}

/**
 * Settings tab for the Freebuff provider.
 *
 * Deliberately lean compared to CLI providers: there is no binary to point at.
 * The status row probes the running desktop app live so users see WHY the
 * provider cannot answer instead of a generic failure in chat.
 */
export const freebuffSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const settings = getFreebuffProviderSettings(settingsBag);
    const client = new FreebuffOrchestratorClient();

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName('Freebuff aktivieren')
      .setDesc('Freebuff als Provider starten. Läuft über die Freebuff-Desktop-App (muss offen sein); jede Antwort ist ein Thread dort. Kostenlos mit täglichen Premium-Kontingenten — Modelle im Chat-Umschalter wählbar.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange(async (value) => {
          updateFreebuffProviderSettings(settingsBag, { enabled: value });
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        }),
      );

    const statusSetting = new Setting(container)
      .setName('Freebuff Desktop')
      .setDesc('Verbindungsstatus zur lokalen Orchestrator-API der Desktop-App.');
    const statusEl = statusSetting.controlEl.createDiv({ cls: 'claudian-setting-description' });
    statusEl.setText('Suche …');
    void (async () => {
      const port = await client.discoverPort(settings.orchestratorPort);
      if (port === null) {
        statusEl.setText('● nicht erreichbar — Freebuff-App starten');
        return;
      }
      const auth = await client.authStatus(port);
      const who = auth?.user?.name ? ` (angemeldet: ${auth.user.name})` : '';
      statusEl.setText(auth?.authed
        ? `● verbunden, Port ${port}${who}`
        : `● erreichbar auf Port ${port}, aber nicht angemeldet — in der App einloggen`);
    })();

    let portInput: HTMLInputElement | null = null;
    new Setting(container)
      .setName('Orchestrator-Port (optional)')
      .setDesc('Nur setzen, wenn die Automatik den Port der Desktop-App nicht findet (leer = automatisch suchen).')
      .addText((text) =>
        text
          .setPlaceholder('automatisch')
          .setValue(settings.orchestratorPort)
          .onChange((value) => {
            portInput = text.inputEl;
            const trimmed = value.trim();
            if (trimmed && !/^\d+$/.test(trimmed)) {
              portInput?.toggleClass('claudian-input-error', true);
              return;
            }
            portInput?.toggleClass('claudian-input-error', false);
            updateFreebuffProviderSettings(settingsBag, { orchestratorPort: trimmed });
            void context.plugin.saveSettings();
          }),
      );

    let pathInput: HTMLInputElement | null = null;
    const validationEl = container.createDiv({
      cls: 'claudian-setting-validation claudian-setting-validation-error claudian-hidden',
    });
    new Setting(container)
      .setName('Projektpfad (optional)')
      .setDesc('Arbeitsverzeichnis für neue Threads in der Freebuff-App. Leer nutzt den Vault-Pfad.')
      .addText((text) =>
        text
          .setPlaceholder(expandHomePath('~') + '/Developer/projekt')
          .setValue(settings.projectPath)
          .onChange((value) => {
            pathInput = text.inputEl;
            const error = validateDirectoryPath(value);
            validationEl.toggleClass('claudian-hidden', !error);
            pathInput?.toggleClass('claudian-input-error', Boolean(error));
            if (error) {
              validationEl.setText(error);
              return;
            }
            updateFreebuffProviderSettings(settingsBag, { projectPath: value.trim() });
            void context.plugin.saveSettings();
          }),
      );

    new Setting(container)
      .setName('Aktuelles Modell')
      .setDesc(`Aktiv: ${formatFreebuffModelLabel(settings.model)} — umschaltbar im Chat über den Modell-Umschalter.`);
  },
};