import * as fs from 'node:fs';

import { type DropdownComponent, Setting } from 'obsidian';

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
    return 'Der Pfad existiert nicht.';
  }
  if (!fs.statSync(expandedPath).isFile()) {
    return 'Der Pfad muss auf eine Datei zeigen.';
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
      .setName('Grok aktivieren')
      .setDesc('Grok (`grok -p` mit `--output-format streaming-json`) als Provider starten.')
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
      .setName('CLI-Pfad')
      .setDesc('Optionaler absoluter Pfad zur `grok`-Binary auf diesem Rechner. Leer lassen, um `grok` aus dem PATH zu nehmen.')
      .addText((text) => {
        const currentValue = settings.cliPathsByHost[hostnameKey] || '';
        text
          .setPlaceholder(process.platform === 'win32'
            ? 'C:\\Users\\you\\.local\\bin\\grok.exe'
            : '/Users/you/.local/bin/grok')
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
      .setDesc('Modell, das neue Unterhaltungen via `-m` bekommen. Ermittelt aus `~/.grok/config.toml` plus den eigenen Modellen unten.')
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
      .setName('Eigene Modelle')
      .setDesc('Zusätzliche Modell-Ids für die Auswahl, eine pro Zeile. `grok models` zeigt, was die CLI tatsächlich ausliefert — alles andere wird beim Start abgelehnt.')
      .addTextArea((text) => {
        text
          .setPlaceholder('mein-eigenes-modell')
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

    new Setting(container).setName('Verhalten').setHeading();

    new Setting(container)
      .setName('Berechtigungen überspringen (YOLO)')
      .setDesc('`--always-approve` übergeben, damit Grok Werkzeugaktionen ohne Rückfrage ausführt. Nur für vertrauenswürdige Aufgaben aktivieren.')
      .addToggle((toggle) =>
        toggle.setValue(settings.permissionMode === 'yolo').onChange(async (value) => {
          updateGrokProviderSettings(settingsBag, { permissionMode: value ? 'yolo' : 'normal' });
          await context.plugin.saveSettings();
        }),
      );

    // --- Agent ---

    new Setting(container).setName('Agent').setHeading();

    const catalog = workspace?.agentCatalog;
    let botBusy = false;
    let botDropdown: DropdownComponent;
    const botStatus = new Setting(container).setName('Bot-Status');
    const updateBotOptions = () => {
      const selected = getGrokProviderSettings(settingsBag).botName;
      botDropdown.selectEl.empty();
      botDropdown.addOption('', 'CLI-Standard');
      for (const agent of catalog?.getAgents() ?? []) {
        botDropdown.addOption(agent.name, agent.name);
      }
      if (selected && !catalog?.getAgents().some(agent => agent.name === selected)) {
        botDropdown.addOption(selected, `${selected} (nicht verfügbar)`);
      }
      botDropdown.setValue(selected);
      if (!catalog) {
        botStatus.setDesc('Grok-Arbeitsbereich nicht verfügbar. Einstellungen erneut öffnen, sobald der Provider geladen ist. Die gespeicherte Bot-Auswahl bleibt erhalten.');
        return;
      }
      if (catalog?.getLastError()) {
        botStatus.setDesc('Bot-Aktualisierung fehlgeschlagen. CLI-Pfad und Grok-Konfiguration prüfen und erneut aktualisieren. Die gespeicherte Auswahl bleibt erhalten; angezeigte Bots sind möglicherweise veraltet.');
        return;
      }
      const environment = catalog?.getEnvironment();
      const selectionStatus = selected && !catalog?.hasAgent(selected)
        ? `Der gespeicherte Bot „${selected}“ ist nicht verfügbar. Bitte aktualisieren oder bewusst einen anderen Bot wählen. `
        : selected ? `Ausgewählt: ${selected}. ` : 'CLI-Standard ausgewählt. ';
      botStatus.setDesc(selectionStatus + (environment
        ? `${environment.agents.length} Bots gefunden. Projekt ${environment.projectTrusted ? 'vertraut' : 'nicht vertraut'}; Vertrauen bei Bedarf in der Grok-CLI prüfen.`
        : 'Bot-Katalog noch nicht geladen. Bitte aktualisieren.'));
    };
    new Setting(container)
      .setName('Grok-Bot')
      .setDesc('Entdeckter Bot für neue Grok-Sitzungen (`--agent`). CLI-Standard verwendet die native Standardkonfiguration.')
      .addDropdown((dropdown) => {
        botDropdown = dropdown;
        updateBotOptions();
        dropdown.onChange(async (value) => {
          if (botBusy) return;
          if (value && (!catalog?.isLoaded() || catalog.getLastError() || !catalog.hasAgent(value))) {
            updateBotOptions();
            botStatus.setDesc('Bot-Auswahl nicht bestätigt. Bitte zuerst die Bots erfolgreich aktualisieren. Die gespeicherte Auswahl bleibt erhalten.');
            return;
          }
          const previous = getGrokProviderSettings(settingsBag).botName;
          botBusy = true;
          dropdown.setDisabled(true);
          try {
            updateGrokProviderSettings(settingsBag, { botName: value });
            await context.plugin.saveSettings();
            updateBotOptions();
          } catch {
            updateGrokProviderSettings(settingsBag, { botName: previous });
            updateBotOptions();
            botStatus.setDesc('Bot-Auswahl konnte nicht gespeichert werden. Die vorherige Auswahl wurde wiederhergestellt. Bitte erneut versuchen.');
          } finally {
            botBusy = false;
            dropdown.setDisabled(false);
          }
        });
      });
    new Setting(container)
      .setName('Bots aktualisieren')
      .setDesc('Liest die für diesen Vault verfügbaren Bots mit `grok inspect --json`. Erstellt keine Bots und sendet keine Modellanfrage.')
      .addButton(button => {
        const refreshBots = async () => {
          if (botBusy || !catalog) return;
          botBusy = true;
          button.setDisabled(true);
          botDropdown.setDisabled(true);
          botStatus.setDesc('Bots werden geladen …');
          try {
            await catalog.refresh();
            updateBotOptions();
          } catch {
            botStatus.setDesc('Bot-Aktualisierung fehlgeschlagen. CLI-Pfad und Grok-Konfiguration prüfen und erneut versuchen.');
          } finally {
            botBusy = false;
            button.setDisabled(false);
            botDropdown.setDisabled(false);
          }
        };
        button.setButtonText('Aktualisieren').setDisabled(!catalog).onClick(refreshBots);
        if (catalog && !catalog.isLoaded()) void refreshBots();
      });

    new Setting(container)
      .setName('Eigene Bots')
      .setDesc('Bots werden aus der nativen Grok-Konfiguration entdeckt. Nur Bots, die `grok inspect --json` für diesen Vault meldet, sind hier auswählbar. Nach externen Änderungen die Liste aktualisieren. Alte Agenten-Datei-Einstellungen werden nicht verwendet.');

    new Setting(container)
      .setName(t('settings.mcpServers.name'))
      .setDesc('MCP-Server mit `grok mcp` in der Grok-CLI verwalten. Eine separate MCP-Datei wird vom Plugin nicht übergeben.');

    // --- Environment ---

    renderEnvironmentSettingsSection({
      container,
      desc: 'Zusätzliche Umgebungsvariablen nur für Grok (`GROK_*`, `MOONSHOT_*`). Nach Änderungen die Bot-Liste aktualisieren.',
      heading: t('settings.environment'),
      name: 'Grok-Umgebungsvariablen',
      placeholder: 'GROK_MODEL=grok-k2\nMOONSHOT_API_KEY=...',
      plugin: context.plugin,
      scope: `provider:${GROK_PROVIDER_ID}`,
    });
  },
};
