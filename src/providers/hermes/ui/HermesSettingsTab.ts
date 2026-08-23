import * as fs from 'fs';
import { Setting } from 'obsidian';

import { firstOutputLine, probeCli } from '../../../core/diagnostics/providerHealthCheck';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { getEnhancedPath, getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetHermesWorkspaceServices } from '../app/HermesWorkspaceServices';
import { clearHermesDiscoveryState } from '../discoveryState';
import { sameStringList } from '../internal/compareCollections';
import { describeHermesModel, type HermesDiscoveredModel } from '../models';
import { getEffectiveHermesModes, normalizeHermesSelectedMode } from '../modes';
import { HermesChatRuntime } from '../runtime/HermesChatRuntime';
import {
  getHermesProviderSettings,
  HERMES_PROVIDER_ID,
  normalizeHermesVisibleModels,
  updateHermesProviderSettings,
} from '../settings';

const ALL_PROVIDERS_KEY = 'all';
/** `hermes acp --check` imports the whole adapter, so it needs more headroom. */
const ACP_CHECK_TIMEOUT_MS = 60_000;

interface EnrichedModel {
  description: string;
  isAvailable: boolean;
  modelLabel: string;
  providerKey: string;
  providerLabel: string;
  rawId: string;
}

export const hermesSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const hermesWorkspace = maybeGetHermesWorkspaceServices();
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const hostnameKey = getHostnameKey();

    const recycleHermesRuntime = async (): Promise<void> => {
      for (const view of context.plugin.getAllViews()) {
        const tabManager = view.getTabManager();
        if (tabManager?.broadcastToProviderTabs) {
          await tabManager.broadcastToProviderTabs(
            HERMES_PROVIDER_ID,
            (service) => Promise.resolve(service.cleanup()),
          );
        } else {
          await tabManager?.broadcastToAllTabs((service) => Promise.resolve(service.cleanup()));
        }
        view.invalidateProviderCommandCaches?.([HERMES_PROVIDER_ID]);
        view.refreshModelSelector?.();
      }
    };

    // ── Setup ───────────────────────────────────────────────────────────────
    new Setting(container).setName('Einrichtung').setHeading();

    new Setting(container)
      .setName('Hermes aktivieren')
      .setDesc('`hermes acp` als Provider starten. Voraussetzung: Hermes ist per `hermes model` eingerichtet.')
      .addToggle((toggle) =>
        toggle
          .setValue(getHermesProviderSettings(settingsBag).enabled)
          .onChange(async (value) => {
            updateHermesProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    const cliPathSetting = new Setting(container)
      .setName('CLI-Pfad')
      .setDesc('Optionaler absoluter Pfad zur Hermes-CLI auf diesem Rechner. Leer lassen, um `hermes` aus dem PATH zu nehmen.');

    const validationEl = container.createDiv({
      cls: 'claudian-cli-path-validation claudian-setting-validation claudian-setting-validation-error claudian-hidden',
    });

    let cliPathInputEl: HTMLInputElement | null = null;
    const updateCliPathValidation = (value: string): boolean => {
      const error = validateCliPath(value);
      validationEl.setText(error ?? '');
      validationEl.toggleClass('claudian-hidden', !error);
      cliPathInputEl?.toggleClass('claudian-input-error', Boolean(error));
      return !error;
    };

    const cliPathsByHost = { ...getHermesProviderSettings(settingsBag).cliPathsByHost };
    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(process.platform === 'win32'
          ? 'C:\\Users\\you\\AppData\\Local\\hermes\\bin\\hermes.exe'
          : '~/.local/bin/hermes')
        .setValue(cliPathsByHost[hostnameKey] || '')
        .onChange(async (value) => {
          if (!updateCliPathValidation(value)) {
            return;
          }

          const trimmed = value.trim();
          if (trimmed) {
            cliPathsByHost[hostnameKey] = trimmed;
          } else {
            delete cliPathsByHost[hostnameKey];
          }

          updateHermesProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
          clearHermesDiscoveryState(settingsBag);
          await context.plugin.saveSettings();
          hermesWorkspace?.cliResolver?.reset();
          await recycleHermesRuntime();
        });

      text.inputEl.addClass('claudian-settings-cli-path-input');
      cliPathInputEl = text.inputEl;
      updateCliPathValidation(cliPathsByHost[hostnameKey] || '');
    });

    const runtimeStatusEl = container.createDiv({
      cls: 'claudian-setting-validation',
      text: 'Noch nicht geprüft.',
    });
    new Setting(container)
      .setName('Hermes-Runtime prüfen')
      .setDesc('Führt `hermes --version` und `hermes acp --check` aus. Damit fallen fehlende ACP-Abhängigkeiten auf, bevor der erste Chat startet.')
      .addButton((button) => button
        .setButtonText('Jetzt prüfen')
        .onClick(async () => {
          button.setDisabled(true);
          runtimeStatusEl.setText('Hermes wird geprüft …');
          hermesWorkspace?.cliResolver?.reset();

          const command = context.plugin.getResolvedProviderCliPath(HERMES_PROVIDER_ID);
          if (!command) {
            runtimeStatusEl.setText('Hermes wurde nicht gefunden. Installation: https://hermes-agent.nousresearch.com');
            button.setDisabled(false);
            return;
          }

          const env = { ...process.env, PATH: getEnhancedPath(process.env.PATH, command) };
          const version = await probeCli({ command, env });
          if (!version.ok) {
            runtimeStatusEl.setText(`Fehler: ${version.detail ?? 'Hermes antwortet nicht'} · ${command}`);
            button.setDisabled(false);
            return;
          }

          const acpCheck = await probeCli({
            args: ['acp', '--check'],
            command,
            env,
            timeoutMs: ACP_CHECK_TIMEOUT_MS,
          });
          runtimeStatusEl.setText(acpCheck.ok
            ? `Bereit: ${firstOutputLine(version.output) || 'Version erkannt'} · ACP OK · ${command}`
            : `ACP nicht bereit: ${firstOutputLine(acpCheck.output) || acpCheck.detail || 'unbekannter Fehler'} · ${command}`);
          button.setDisabled(false);
        }));

    // ── Models ──────────────────────────────────────────────────────────────
    new Setting(container).setName('Modelle').setHeading();

    new Setting(container)
      .setName('Sichtbare Modelle')
      .setDesc('Wähle, welche Hermes-Modelle in der Chat-Auswahl erscheinen. Der Katalog kommt live aus Hermes und enthält alle Provider, bei denen du angemeldet bist. Das Modell einer laufenden Sitzung bleibt sichtbar, auch wenn es hier abgewählt ist.');

    const pickerEl = container.createDiv({ cls: 'claudian-provider-model-picker' });
    let searchQuery = '';
    let providerFilter = ALL_PROVIDERS_KEY;
    let loadingModelCatalog = false;
    let modelCatalogLoadFailed = false;

    const summaryEl = pickerEl.createDiv({ cls: 'claudian-provider-model-picker-summary' });
    const selectedEl = pickerEl.createDiv({ cls: 'claudian-provider-model-picker-selected' });
    const catalogEl = pickerEl.createEl('details', { cls: 'claudian-provider-model-picker-catalog' });
    catalogEl.open = getHermesProviderSettings(settingsBag).visibleModels.length === 0;

    const catalogSummaryEl = catalogEl.createEl('summary', {
      cls: 'claudian-provider-model-picker-catalog-summary',
    });
    catalogSummaryEl.createSpan({ cls: 'claudian-provider-model-picker-catalog-caret', text: '▸' });
    catalogSummaryEl.createSpan({
      cls: 'claudian-provider-model-picker-catalog-title',
      text: 'Modelle durchsuchen',
    });
    const catalogSummaryCountEl = catalogSummaryEl.createSpan({
      cls: 'claudian-provider-model-picker-catalog-count',
    });

    const controlsEl = catalogEl.createDiv({ cls: 'claudian-provider-model-picker-controls' });
    const searchInput = controlsEl.createEl('input', {
      cls: 'claudian-provider-model-picker-search',
      type: 'search',
    });
    searchInput.placeholder = 'Nach Modell, Provider oder ID filtern …';
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      renderList();
    });

    const providerSelectEl = controlsEl.createEl('select', {
      cls: 'claudian-provider-model-picker-provider',
    });
    providerSelectEl.addEventListener('change', () => {
      providerFilter = providerSelectEl.value;
      renderList();
    });

    const listEl = catalogEl.createDiv({ cls: 'claudian-provider-model-picker-list' });

    const getEnrichedModels = (): EnrichedModel[] => {
      const current = getHermesProviderSettings(settingsBag);
      return buildEnrichedModels(current.discoveredModels, current.visibleModels);
    };

    const persistVisibleModels = async (visibleModels: string[]): Promise<void> => {
      const current = getHermesProviderSettings(settingsBag).visibleModels;
      const normalized = normalizeHermesVisibleModels(visibleModels);
      if (sameStringList(current, normalized)) {
        return;
      }

      updateHermesProviderSettings(settingsBag, { visibleModels: normalized });
      await context.plugin.saveSettings();
      renderAll();
      context.refreshModelSelectors();
    };

    const persistModelAliases = async (modelAliases: Record<string, string>): Promise<void> => {
      updateHermesProviderSettings(settingsBag, { modelAliases });
      await context.plugin.saveSettings();
      renderSelected();
      context.refreshModelSelectors();
    };

    const renderSummary = (): void => {
      summaryEl.empty();
      const current = getHermesProviderSettings(settingsBag);
      const providerCount = new Set(getEnrichedModels().map((model) => model.providerKey)).size;

      summaryEl.createSpan({ text: 'Sichtbar: ' });
      summaryEl.createSpan({
        cls: 'claudian-provider-model-picker-summary-value',
        text: String(current.visibleModels.length),
      });
      summaryEl.createSpan({
        text: ` von ${current.discoveredModels.length} gefunden · ${providerCount} Provider`,
      });

      catalogSummaryCountEl.setText(
        loadingModelCatalog
          ? 'Modelle werden geladen …'
          : current.discoveredModels.length > 0
          ? `${current.discoveredModels.length} verfügbar`
          : 'Noch keine Modelle gefunden',
      );
    };

    const renderSelected = (): void => {
      selectedEl.empty();
      const current = getHermesProviderSettings(settingsBag);
      selectedEl.toggleClass('claudian-hidden', current.visibleModels.length === 0);
      if (current.visibleModels.length === 0) {
        return;
      }

      const enrichedByRawId = new Map(getEnrichedModels().map((model) => [model.rawId, model] as const));
      const headerEl = selectedEl.createDiv({ cls: 'claudian-provider-model-picker-selected-header' });
      headerEl.createEl('span', {
        cls: 'claudian-provider-model-picker-selected-label',
        text: `Ausgewählt (${current.visibleModels.length})`,
      });
      const clearAllBtn = headerEl.createEl('button', {
        cls: 'claudian-provider-model-picker-selected-clear',
        text: 'Alle entfernen',
      });
      clearAllBtn.setAttribute('aria-label', 'Alle ausgewählten Modelle entfernen');
      clearAllBtn.addEventListener('click', () => {
        void persistVisibleModels([]);
      });

      const rowsEl = selectedEl.createDiv({ cls: 'claudian-provider-model-picker-selected-rows' });
      for (const rawId of current.visibleModels) {
        const enriched = enrichedByRawId.get(rawId);
        const defaultLabel = enriched
          ? `${enriched.providerLabel} · ${enriched.modelLabel}`
          : rawId;

        const rowEl = rowsEl.createDiv({ cls: 'claudian-provider-model-picker-selected-row' });
        if (enriched && !enriched.isAvailable) {
          rowEl.classList.add('claudian-provider-model-picker-selected-row--unavailable');
        }

        const infoEl = rowEl.createDiv({ cls: 'claudian-provider-model-picker-selected-info' });
        const titleEl = infoEl.createDiv({ cls: 'claudian-provider-model-picker-selected-title' });
        if (enriched) {
          titleEl.createEl('span', {
            cls: 'claudian-provider-model-picker-selected-badge',
            text: enriched.providerLabel,
          });
        }
        titleEl.createEl('span', {
          cls: 'claudian-provider-model-picker-selected-name',
          text: enriched?.modelLabel ?? rawId,
        });

        if (enriched && !enriched.isAvailable) {
          infoEl.createEl('div', {
            cls: 'claudian-provider-model-picker-selected-unavailable',
            text: 'Wird von Hermes derzeit nicht gemeldet',
          });
        }

        infoEl.createEl('div', { cls: 'claudian-provider-model-picker-selected-id', text: rawId });

        const rowControlsEl = rowEl.createDiv({ cls: 'claudian-provider-model-picker-selected-controls' });
        const aliasInput = rowControlsEl.createEl('input', {
          cls: 'claudian-provider-model-picker-selected-alias',
          type: 'text',
        });
        aliasInput.placeholder = defaultLabel;
        aliasInput.value = current.modelAliases[rawId] ?? '';
        aliasInput.setAttribute('aria-label', `Alias für ${defaultLabel}`);
        aliasInput.title = 'Eigener Name in der Modellauswahl. Leer lassen für den Standard.';

        const commitAlias = (): void => {
          const latest = getHermesProviderSettings(settingsBag);
          const existing = latest.modelAliases[rawId] ?? '';
          const next = aliasInput.value.trim();
          if (next === existing) {
            aliasInput.value = existing;
            return;
          }

          const nextAliases = { ...latest.modelAliases };
          if (next) {
            nextAliases[rawId] = next;
          } else {
            delete nextAliases[rawId];
          }
          void persistModelAliases(nextAliases);
        };

        aliasInput.addEventListener('blur', commitAlias);
        aliasInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            aliasInput.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            aliasInput.value = getHermesProviderSettings(settingsBag).modelAliases[rawId] ?? '';
            aliasInput.blur();
          }
        });

        const removeBtn = rowControlsEl.createEl('button', {
          cls: 'claudian-provider-model-picker-selected-remove',
          text: '×',
        });
        removeBtn.setAttribute('aria-label', `${defaultLabel} entfernen`);
        removeBtn.addEventListener('click', () => {
          void persistVisibleModels(current.visibleModels.filter((entry) => entry !== rawId));
        });
      }
    };

    const renderProviderSelect = (): void => {
      const enriched = getEnrichedModels();
      const providers = new Map<string, { count: number; label: string }>();
      for (const model of enriched) {
        const existing = providers.get(model.providerKey);
        if (existing) {
          existing.count += 1;
        } else {
          providers.set(model.providerKey, { count: 1, label: model.providerLabel });
        }
      }

      providerSelectEl.empty();
      providerSelectEl.createEl('option', {
        text: `Alle Provider (${enriched.length})`,
        value: ALL_PROVIDERS_KEY,
      });
      for (const [key, { count, label }] of Array.from(providers.entries())
        .sort(([, left], [, right]) => left.label.localeCompare(right.label))) {
        providerSelectEl.createEl('option', { text: `${label} (${count})`, value: key });
      }

      if (providerFilter !== ALL_PROVIDERS_KEY && !providers.has(providerFilter)) {
        providerFilter = ALL_PROVIDERS_KEY;
      }
      providerSelectEl.value = providerFilter;
    };

    const renderList = (): void => {
      listEl.empty();
      const selectedIds = new Set(getHermesProviderSettings(settingsBag).visibleModels);
      const enriched = getEnrichedModels();
      const filtered = enriched.filter((model) => {
        if (providerFilter !== ALL_PROVIDERS_KEY && model.providerKey !== providerFilter) {
          return false;
        }
        if (!searchQuery) {
          return true;
        }
        return model.rawId.toLowerCase().includes(searchQuery)
          || model.modelLabel.toLowerCase().includes(searchQuery)
          || model.providerLabel.toLowerCase().includes(searchQuery)
          || model.description.toLowerCase().includes(searchQuery);
      });

      if (filtered.length === 0) {
        listEl.createDiv({
          cls: 'claudian-provider-model-picker-empty',
          text: loadingModelCatalog
            ? 'Hermes-Modellkatalog wird geladen …'
            : modelCatalogLoadFailed
            ? 'Der Hermes-Modellkatalog konnte nicht geladen werden. CLI-Pfad und `hermes acp --check` prüfen, dann diesen Bereich erneut öffnen.'
            : enriched.length === 0
            ? 'Starte Hermes einmal, damit Claudian den Modellkatalog laden kann.'
            : 'Kein Modell passt zum Filter.',
        });
        return;
      }

      for (const model of filtered) {
        const rowEl = listEl.createEl('label', { cls: 'claudian-provider-model-picker-row' });
        const isSelected = selectedIds.has(model.rawId);
        rowEl.classList.toggle('claudian-provider-model-picker-row--selected', isSelected);
        rowEl.title = model.rawId;

        const checkboxEl = rowEl.createEl('input', { type: 'checkbox' });
        checkboxEl.checked = isSelected;
        checkboxEl.addEventListener('change', () => {
          const currentVisibleModels = getHermesProviderSettings(settingsBag).visibleModels;
          void persistVisibleModels(checkboxEl.checked
            ? [...currentVisibleModels, model.rawId]
            : currentVisibleModels.filter((id) => id !== model.rawId));
        });

        const textEl = rowEl.createDiv({ cls: 'claudian-provider-model-picker-row-text' });
        const rowHeaderEl = textEl.createDiv({ cls: 'claudian-provider-model-picker-row-header' });
        rowHeaderEl.createEl('span', {
          cls: 'claudian-provider-model-picker-row-name',
          text: model.modelLabel,
        });
        const badgeEl = rowHeaderEl.createEl('span', {
          cls: 'claudian-provider-model-picker-row-badge',
          text: model.providerLabel,
        });
        if (!model.isAvailable) {
          badgeEl.classList.add('claudian-provider-model-picker-row-badge--unavailable');
          badgeEl.setText('Nicht verfügbar');
          badgeEl.title = 'Konfiguriertes Modell, das Hermes derzeit nicht meldet';
        }

        textEl.createDiv({ cls: 'claudian-provider-model-picker-row-meta', text: model.rawId });
        if (model.description) {
          textEl.createDiv({ cls: 'claudian-provider-model-picker-row-desc', text: model.description });
        }
      }
    };

    const renderAll = (): void => {
      renderSummary();
      renderSelected();
      renderProviderSelect();
      renderList();
    };

    renderAll();

    const loadModelCatalog = async (): Promise<void> => {
      if (loadingModelCatalog || getHermesProviderSettings(settingsBag).discoveredModels.length > 0) {
        return;
      }

      loadingModelCatalog = true;
      modelCatalogLoadFailed = false;
      renderAll();

      // A throwaway runtime keeps catalog discovery from binding a Hermes
      // session to any open tab.
      const runtime = new HermesChatRuntime(context.plugin);
      try {
        const ready = await runtime.ensureReady({ allowSessionCreation: true });
        modelCatalogLoadFailed = !ready
          || getHermesProviderSettings(settingsBag).discoveredModels.length === 0;
        if (!modelCatalogLoadFailed) {
          context.refreshModelSelectors();
        }
      } catch {
        modelCatalogLoadFailed = true;
      } finally {
        loadingModelCatalog = false;
        runtime.cleanup();
        renderAll();
      }
    };

    catalogEl.addEventListener('toggle', () => {
      if (catalogEl.open) {
        void loadModelCatalog();
      }
    });
    if (catalogEl.open) {
      void loadModelCatalog();
    }

    // ── Behaviour ───────────────────────────────────────────────────────────
    new Setting(container).setName('Verhalten').setHeading();

    new Setting(container)
      .setName('Freigabe-Modus')
      .setDesc('Hermes’ Edit-Approval-Policy für neue Turns. Lässt sich auch direkt in der Chat-Leiste umschalten.')
      .addDropdown((dropdown) => {
        const current = getHermesProviderSettings(settingsBag);
        for (const mode of getEffectiveHermesModes(current.availableModes)) {
          dropdown.addOption(mode.id, mode.name);
        }
        dropdown
          .setValue(normalizeHermesSelectedMode(current.selectedMode, current.availableModes))
          .onChange(async (value) => {
            updateHermesProviderSettings(settingsBag, { selectedMode: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          });
      });

    new Setting(container)
      .setName('Gefährliche Befehle ohne Rückfrage (YOLO)')
      .setDesc('Setzt `HERMES_YOLO_MODE=1`. Hermes überspringt dann alle Freigabe-Dialoge für gefährliche Shell-Befehle. Erfordert einen Neustart der Hermes-Runtime.')
      .addToggle((toggle) =>
        toggle
          .setValue(getHermesProviderSettings(settingsBag).yoloMode)
          .onChange(async (value) => {
            updateHermesProviderSettings(settingsBag, { yoloMode: value });
            await context.plugin.saveSettings();
            await recycleHermesRuntime();
          })
      );

    new Setting(container)
      .setName('Shell-Hooks automatisch akzeptieren')
      .setDesc('Startet Hermes mit `--accept-hooks`. Nötig, wenn in `config.yaml` Hooks hinterlegt sind — ohne die Option blockiert Hermes headless auf der Rückfrage.')
      .addToggle((toggle) =>
        toggle
          .setValue(getHermesProviderSettings(settingsBag).acceptHooks)
          .onChange(async (value) => {
            updateHermesProviderSettings(settingsBag, { acceptHooks: value });
            await context.plugin.saveSettings();
            await recycleHermesRuntime();
          })
      );

    new Setting(container)
      .setName('Vault-Systemprompt senden')
      .setDesc('Hermes kennt keinen ACP-Kanal für Systemprompts. Ist die Option aktiv, stellt Claudian seine Vault-Anweisungen dem ersten Turn jeder Sitzung voran. Aus lassen, wenn Hermes ausschließlich AGENTS.md/SOUL.md folgen soll.')
      .addToggle((toggle) =>
        toggle
          .setValue(getHermesProviderSettings(settingsBag).injectVaultPrompt)
          .onChange(async (value) => {
            updateHermesProviderSettings(settingsBag, { injectVaultPrompt: value });
            await context.plugin.saveSettings();
          })
      );

    // ── Commands ────────────────────────────────────────────────────────────
    new Setting(container).setName('Befehle und Skills').setHeading();

    const commandsDesc = container.createDiv({ cls: 'claudian-sp-settings-desc' });
    commandsDesc.createEl('p', {
      cls: 'setting-item-description',
      text: 'Hermes meldet seine Slash-Befehle selbst über ACP und führt sie im Agenten aus. Skills werden über `hermes skills` verwaltet. Diese Einstellung blendet Einträge nur aus dem Claudian-Dropdown aus.',
    });

    context.renderHiddenProviderCommandSetting(container, HERMES_PROVIDER_ID, {
      name: 'Ausgeblendete Befehle',
      desc: 'Blendet einzelne Hermes-Befehle aus dem Dropdown aus. Namen ohne führenden Schrägstrich, einer pro Zeile.',
      placeholder: 'compress\nreset\nqueue',
    });

    // ── Environment ─────────────────────────────────────────────────────────
    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: `provider:${HERMES_PROVIDER_ID}`,
      heading: 'Environment',
      name: 'Umgebungsvariablen',
      desc: 'Zusätzliche Variablen für den `hermes acp`-Prozess. `HERMES_HOME` bzw. `HERMES_PROFILE` schalten auf ein anderes Hermes-Profil um — bestehende Sitzungen werden dabei ungültig.',
      placeholder: 'HERMES_HOME=/Users/you/.hermes\nHERMES_PROFILE=work',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, HERMES_PROVIDER_ID),
    });
  },
};

function validateCliPath(value: string): string | null {
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

function buildEnrichedModels(
  discoveredModels: HermesDiscoveredModel[],
  visibleModels: string[],
): EnrichedModel[] {
  const enriched: EnrichedModel[] = [];
  const discoveredIds = new Set<string>();

  for (const model of discoveredModels) {
    const { modelLabel, providerLabel } = describeHermesModel(model);
    discoveredIds.add(model.rawId);
    enriched.push({
      description: model.description ?? '',
      isAvailable: true,
      modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
      rawId: model.rawId,
    });
  }

  // Configured-but-unreported models stay listed so hiding them is possible.
  for (const rawId of visibleModels) {
    if (discoveredIds.has(rawId)) {
      continue;
    }

    const { modelLabel, providerLabel } = describeHermesModel({ label: rawId, rawId });
    enriched.push({
      description: '',
      isAvailable: false,
      modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
      rawId,
    });
  }

  return enriched.sort((left, right) => {
    const providerCmp = left.providerLabel.localeCompare(right.providerLabel);
    return providerCmp !== 0 ? providerCmp : left.modelLabel.localeCompare(right.modelLabel);
  });
}
