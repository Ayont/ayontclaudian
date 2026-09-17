import * as fs from 'fs';
import { Setting } from 'obsidian';

import { firstOutputLine, probeCli } from '../../../core/diagnostics/providerHealthCheck';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { getEnhancedPath, getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetOmpWorkspaceServices } from '../app/OmpWorkspaceServices';
import { clearOmpDiscoveryState } from '../discoveryState';
import { sameStringList } from '../internal/compareCollections';
import {
  buildOmpBaseModels,
  encodeOmpModelId,
  type OmpDiscoveredModel,
  splitOmpModelLabel,
} from '../models';
import { OmpChatRuntime } from '../runtime/OmpChatRuntime';
import {
  getOmpProviderSettings,
  normalizeOmpVisibleModels,
  OMP_DEFAULT_ENVIRONMENT_VARIABLES,
  updateOmpProviderSettings,
} from '../settings';
import { OmpAgentSettings } from './OmpAgentSettings';

const ALL_PROVIDERS_KEY = 'all';
const OMP_METADATA_WARMUP_DB = ':memory:';

interface EnrichedModel {
  description: string;
  isAvailable: boolean;
  modelLabel: string;
  providerKey: string;
  providerLabel: string;
  rawId: string;
}

export const ompSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const ompWorkspace = maybeGetOmpWorkspaceServices();
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const ompSettings = getOmpProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    new Setting(container).setName('Einrichtung').setHeading();

    new Setting(container)
      .setName('OMP aktivieren')
      .setDesc('`omp acp` als Provider starten.')
      .addToggle((toggle) =>
        toggle
          .setValue(ompSettings.enabled)
          .onChange(async (value) => {
            updateOmpProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    const cliPathSetting = new Setting(container)
      .setName('CLI-Pfad')
      .setDesc('Optionaler absoluter Pfad zur OMP-CLI auf diesem Rechner. Leer lassen, um `omp` aus dem PATH zu nehmen.');

    const validationEl = container.createDiv({
      cls: 'claudian-cli-path-validation claudian-setting-validation claudian-setting-validation-error claudian-hidden',
    });

    const validatePath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      const expandedPath = expandHomePath(trimmed);
      if (!fs.existsSync(expandedPath)) {
        return 'Path does not exist';
      }

      const stat = fs.statSync(expandedPath);
      if (!stat.isFile()) {
        return 'Path must point to a file';
      }

      return null;
    };

    const updateCliPathValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validatePath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.toggleClass('claudian-hidden', false);
        if (inputEl) {
          inputEl.toggleClass('claudian-input-error', true);
        }
        return false;
      }

      validationEl.toggleClass('claudian-hidden', true);
      if (inputEl) {
        inputEl.toggleClass('claudian-input-error', false);
      }
      return true;
    };

    const cliPathsByHost = { ...ompSettings.cliPathsByHost };
    const currentValue = ompSettings.cliPathsByHost[hostnameKey] || '';
    let cliPathInputEl: HTMLInputElement | null = null;

    const persistCliPath = async (value: string): Promise<boolean> => {
      const isValid = updateCliPathValidation(value, cliPathInputEl ?? undefined);
      if (!isValid) {
        return false;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      updateOmpProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      clearOmpDiscoveryState(settingsBag);
      await context.plugin.saveSettings();
      ompWorkspace?.cliResolver?.reset();
      await recycleOmpRuntime();
      return true;
    };

    const recycleOmpRuntime = async (): Promise<void> => {
      for (const view of context.plugin.getAllViews()) {
        const tabManager = view.getTabManager();
        if (tabManager?.broadcastToProviderTabs) {
          await tabManager.broadcastToProviderTabs('omp', (service) => Promise.resolve(service.cleanup()));
        } else {
          await tabManager?.broadcastToAllTabs(
            (service) => Promise.resolve(service.cleanup()),
          );
        }
        view.invalidateProviderCommandCaches?.(['omp']);
        view.refreshModelSelector?.();
      }
    };

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(process.platform === 'win32'
          ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\omp.cmd'
          : '/usr/local/bin/omp')
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });

      text.inputEl.addClass('claudian-settings-cli-path-input');
      cliPathInputEl = text.inputEl;

      updateCliPathValidation(currentValue, text.inputEl);
    });

    const runtimeStatusEl = container.createDiv({
      cls: 'claudian-setting-validation claudian-omp-runtime-status',
      text: 'Noch nicht geprüft.',
    });
    new Setting(container)
      .setName('OMP-Runtime prüfen')
      .setDesc('Startet einen kurzen Versions-Check. So werden beschädigte oder veraltete Binaries erkannt, die nur als Datei vorhanden sind.')
      .addButton((button) => button
        .setButtonText('Jetzt prüfen')
        .onClick(async () => {
          button.setDisabled(true);
          runtimeStatusEl.setText('OMP wird geprüft …');
          ompWorkspace?.cliResolver?.reset();
          const command = context.plugin.getResolvedProviderCliPath('omp');
          if (!command) {
            runtimeStatusEl.setText('OMP wurde nicht gefunden. Empfohlen: offizielle Installation unter ~/.omp/bin.');
            button.setDisabled(false);
            return;
          }

          const result = await probeCli({
            command,
            env: {
              ...process.env,
              PATH: getEnhancedPath(process.env.PATH, command),
            },
          });
          runtimeStatusEl.setText(result.ok
            ? `Bereit: ${firstOutputLine(result.output) || 'Version erkannt'} · ${command}`
            : `Fehler: ${result.detail ?? 'OMP antwortet nicht'} · ${command}`);
          button.setDisabled(false);
        }));

    new Setting(container).setName('Modelle').setHeading();

    new Setting(container)
      .setName('Sichtbare Modelle')
      .setDesc('Wähle, welche OMP-Modelle in der Chat-Auswahl erscheinen. Nach Provider filtern oder tippen, um zu suchen. Das Modell der laufenden Sitzung bleibt sichtbar, auch wenn es hier nicht ausgewählt ist.');

    const pickerEl = container.createDiv({ cls: 'claudian-omp-model-picker' });

    let searchQuery = '';
    let providerFilter = ALL_PROVIDERS_KEY;

    const summaryEl = pickerEl.createDiv({ cls: 'claudian-omp-model-picker-summary' });
    const selectedEl = pickerEl.createDiv({ cls: 'claudian-omp-model-picker-selected' });
    const catalogEl = pickerEl.createEl('details', { cls: 'claudian-omp-model-picker-catalog' });
    catalogEl.open = getOmpProviderSettings(settingsBag).visibleModels.length === 0;
    const catalogSummaryEl = catalogEl.createEl('summary', {
      cls: 'claudian-omp-model-picker-catalog-summary',
    });
    catalogSummaryEl.createSpan({
      cls: 'claudian-omp-model-picker-catalog-caret',
      text: '▸',
    });
    catalogSummaryEl.createSpan({
      cls: 'claudian-omp-model-picker-catalog-title',
      text: 'Browse models',
    });
    const catalogSummaryCountEl = catalogSummaryEl.createSpan({
      cls: 'claudian-omp-model-picker-catalog-count',
    });

    const controlsEl = catalogEl.createDiv({ cls: 'claudian-omp-model-picker-controls' });

    const searchInput = controlsEl.createEl('input', {
      cls: 'claudian-omp-model-picker-search',
      type: 'search',
    });
    searchInput.placeholder = 'Filter by model, provider, or ID…';
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      renderList();
    });

    const providerSelectEl = controlsEl.createEl('select', {
      cls: 'claudian-omp-model-picker-provider',
    });
    providerSelectEl.addEventListener('change', () => {
      providerFilter = providerSelectEl.value;
      renderList();
    });

    const listEl = catalogEl.createDiv({ cls: 'claudian-omp-model-picker-list' });
    let loadingModelCatalog = false;
    let modelCatalogLoadFailed = false;

    const getEnrichedModels = (): EnrichedModel[] => {
      const current = getOmpProviderSettings(settingsBag);
      return buildEnrichedModels(current.discoveredModels, current.visibleModels);
    };

    const filterModels = (models: EnrichedModel[]): EnrichedModel[] => {
      return models.filter((model) => {
        if (providerFilter !== ALL_PROVIDERS_KEY && model.providerKey !== providerFilter) {
          return false;
        }

        if (!searchQuery) {
          return true;
        }

        return (
          model.rawId.toLowerCase().includes(searchQuery)
          || model.modelLabel.toLowerCase().includes(searchQuery)
          || model.providerLabel.toLowerCase().includes(searchQuery)
          || model.description.toLowerCase().includes(searchQuery)
        );
      });
    };

    const persistVisibleModels = async (visibleModels: string[]): Promise<void> => {
      const currentVisibleModels = getOmpProviderSettings(settingsBag).visibleModels;
      const normalized = normalizeOmpVisibleModels(
        visibleModels,
        getOmpProviderSettings(settingsBag).discoveredModels,
      );
      if (sameStringList(currentVisibleModels, normalized)) {
        return;
      }

      updateOmpProviderSettings(settingsBag, { visibleModels: normalized });
      await context.plugin.saveSettings();
      renderAll();
      context.refreshModelSelectors();
    };

    const persistModelMetadata = async (rawId: string): Promise<void> => {
      const runtime = new OmpChatRuntime(context.plugin);
      try {
        runtime.syncConversationState({
          providerState: { databasePath: OMP_METADATA_WARMUP_DB },
          sessionId: null,
        });
        const loaded = await runtime.warmModelMetadata(encodeOmpModelId(rawId));
        if (loaded) {
          context.refreshModelSelectors();
        }
      } catch {
        // Metadata warmup is opportunistic; the first chat turn can still discover it.
      } finally {
        runtime.cleanup();
      }
    };

    const persistModelAliases = async (modelAliases: Record<string, string>): Promise<void> => {
      updateOmpProviderSettings(settingsBag, { modelAliases });
      await context.plugin.saveSettings();
      renderSelected();
      context.refreshModelSelectors();
    };

    const renderSummary = (): void => {
      summaryEl.empty();
      const current = getOmpProviderSettings(settingsBag);
      const enriched = getEnrichedModels();
      const providerCount = new Set(enriched.map((model) => model.providerKey)).size;
      const providerWord = providerCount === 1 ? 'provider' : 'providers';

      summaryEl.createSpan({ text: 'Visible: ' });
      summaryEl.createSpan({
        cls: 'claudian-omp-model-picker-summary-value',
        text: String(current.visibleModels.length),
      });
      summaryEl.createSpan({
        text: ` of ${current.discoveredModels.length} discovered • ${providerCount} ${providerWord}`,
      });

      let catalogSummary = 'No models discovered yet';
      if (loadingModelCatalog) {
        catalogSummary = 'Loading models...';
      } else if (current.discoveredModels.length > 0) {
        catalogSummary = `${current.discoveredModels.length} available`;
      }
      catalogSummaryCountEl.setText(catalogSummary);
    };

    const renderSelected = (): void => {
      selectedEl.empty();
      const current = getOmpProviderSettings(settingsBag);
      if (current.visibleModels.length === 0) {
        selectedEl.toggleClass('claudian-hidden', true);
        return;
      }

      selectedEl.toggleClass('claudian-hidden', false);
      const enrichedByRawId = new Map(
        getEnrichedModels().map((model) => [model.rawId, model] as const),
      );

      const headerEl = selectedEl.createDiv({ cls: 'claudian-omp-model-picker-selected-header' });
      headerEl.createEl('span', {
        cls: 'claudian-omp-model-picker-selected-label',
        text: `Selected (${current.visibleModels.length})`,
      });
      const clearAllBtn = headerEl.createEl('button', {
        cls: 'claudian-omp-model-picker-selected-clear',
        text: 'Clear all',
      });
      clearAllBtn.setAttribute('aria-label', 'Clear all selected models');
      clearAllBtn.addEventListener('click', () => {
        void persistVisibleModels([]);
      });

      const rowsEl = selectedEl.createDiv({ cls: 'claudian-omp-model-picker-selected-rows' });

      for (const rawId of current.visibleModels) {
        const enriched = enrichedByRawId.get(rawId);
        const defaultLabel = enriched
          ? `${enriched.providerLabel}/${enriched.modelLabel}`
          : rawId;

        const rowEl = rowsEl.createDiv({ cls: 'claudian-omp-model-picker-selected-row' });
        if (enriched && !enriched.isAvailable) {
          rowEl.classList.add('claudian-omp-model-picker-selected-row--unavailable');
        }

        const infoEl = rowEl.createDiv({ cls: 'claudian-omp-model-picker-selected-info' });
        const titleEl = infoEl.createDiv({ cls: 'claudian-omp-model-picker-selected-title' });
        if (enriched) {
          titleEl.createEl('span', {
            cls: 'claudian-omp-model-picker-selected-badge',
            text: enriched.providerLabel,
          });
          titleEl.createEl('span', {
            cls: 'claudian-omp-model-picker-selected-name',
            text: enriched.modelLabel,
          });
        } else {
          titleEl.createEl('span', {
            cls: 'claudian-omp-model-picker-selected-name',
            text: rawId,
          });
        }

        if (enriched && !enriched.isAvailable) {
          infoEl.createEl('div', {
            cls: 'claudian-omp-model-picker-selected-unavailable',
            text: 'Not currently reported by OMP',
          });
        }

        infoEl.createEl('div', {
          cls: 'claudian-omp-model-picker-selected-id',
          text: rawId,
        });

        const controlsEl = rowEl.createDiv({ cls: 'claudian-omp-model-picker-selected-controls' });
        const aliasInput = controlsEl.createEl('input', {
          cls: 'claudian-omp-model-picker-selected-alias',
          type: 'text',
        });
        aliasInput.placeholder = defaultLabel;
        aliasInput.value = current.modelAliases[rawId] ?? '';
        aliasInput.setAttribute('aria-label', `Alias for ${defaultLabel}`);
        aliasInput.title = 'Custom label shown in the model selector. Leave empty to use the default.';

        const commitAlias = (): void => {
          const latest = getOmpProviderSettings(settingsBag);
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
            aliasInput.value = getOmpProviderSettings(settingsBag).modelAliases[rawId] ?? '';
            aliasInput.blur();
          }
        });

        const removeBtn = controlsEl.createEl('button', {
          cls: 'claudian-omp-model-picker-selected-remove',
          text: '×',
        });
        removeBtn.setAttribute('aria-label', `Remove ${defaultLabel}`);
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
        text: `All providers (${enriched.length})`,
        value: ALL_PROVIDERS_KEY,
      });

      const sortedProviders = Array.from(providers.entries())
        .sort(([, left], [, right]) => left.label.localeCompare(right.label));
      for (const [key, { count, label }] of sortedProviders) {
        providerSelectEl.createEl('option', {
          text: `${label} (${count})`,
          value: key,
        });
      }

      if (providerFilter !== ALL_PROVIDERS_KEY && !providers.has(providerFilter)) {
        providerFilter = ALL_PROVIDERS_KEY;
      }
      providerSelectEl.value = providerFilter;
    };

    const renderList = (): void => {
      listEl.empty();
      const current = getOmpProviderSettings(settingsBag);
      const selectedIds = new Set(current.visibleModels);
      const enriched = getEnrichedModels();
      const filtered = filterModels(enriched);

      if (filtered.length === 0) {
        const emptyEl = listEl.createDiv({ cls: 'claudian-omp-model-picker-empty' });
        let emptyText = 'No models match your filter.';
        if (loadingModelCatalog) {
          emptyText = 'Loading OMP model catalog...';
        } else if (modelCatalogLoadFailed) {
          emptyText = 'Could not load the OMP model catalog. Check the CLI path and login state, then expand this section again.';
        } else if (enriched.length === 0) {
          emptyText = 'Start OMP once to load its model catalog. Claudian will then let you pick visible models.';
        }
        emptyEl.setText(emptyText);
        return;
      }

      for (const model of filtered) {
        const rowEl = listEl.createEl('label', { cls: 'claudian-omp-model-picker-row' });
        const isSelected = selectedIds.has(model.rawId);
        if (isSelected) {
          rowEl.classList.add('claudian-omp-model-picker-row--selected');
        }
        rowEl.title = model.rawId;

        const checkboxEl = rowEl.createEl('input', { type: 'checkbox' });
        checkboxEl.checked = isSelected;
        checkboxEl.addEventListener('change', () => {
          const currentVisibleModels = getOmpProviderSettings(settingsBag).visibleModels;
          const next = checkboxEl.checked
            ? [...currentVisibleModels, model.rawId]
            : currentVisibleModels.filter((id) => id !== model.rawId);
          void (async () => {
            await persistVisibleModels(next);
            if (checkboxEl.checked) {
              await persistModelMetadata(model.rawId);
            }
          })();
        });

        const textEl = rowEl.createDiv({ cls: 'claudian-omp-model-picker-row-text' });

        const headerEl = textEl.createDiv({ cls: 'claudian-omp-model-picker-row-header' });
        headerEl.createEl('span', {
          cls: 'claudian-omp-model-picker-row-name',
          text: model.modelLabel,
        });
        const badgeEl = headerEl.createEl('span', {
          cls: 'claudian-omp-model-picker-row-badge',
          text: model.providerLabel,
        });
        if (!model.isAvailable) {
          badgeEl.classList.add('claudian-omp-model-picker-row-badge--unavailable');
          badgeEl.setText('Unavailable');
          badgeEl.title = 'Configured model not currently reported by OMP';
        }

        textEl.createDiv({
          cls: 'claudian-omp-model-picker-row-meta',
          text: model.rawId,
        });

        if (model.description) {
          textEl.createDiv({
            cls: 'claudian-omp-model-picker-row-desc',
            text: model.description,
          });
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
      if (loadingModelCatalog || getOmpProviderSettings(settingsBag).discoveredModels.length > 0) {
        return;
      }

      loadingModelCatalog = true;
      modelCatalogLoadFailed = false;
      renderAll();

      const runtime = new OmpChatRuntime(context.plugin);
      try {
        runtime.syncConversationState({
          providerState: { databasePath: OMP_METADATA_WARMUP_DB },
          sessionId: null,
        });
        const loaded = await runtime.ensureReady({ allowSessionCreation: true });
        modelCatalogLoadFailed = !loaded || getOmpProviderSettings(settingsBag).discoveredModels.length === 0;
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

    new Setting(container)
      .setName('Eigene Modell-IDs')
      .setDesc('Zusätzliche OMP-Modell-Ids, eine pro Zeile. Erscheinen im Chat-Umschalter auch wenn die CLI sie nicht listet.')
      .addTextArea((text) => {
        text
          .setPlaceholder('anbieter/modell')
          .setValue(getOmpProviderSettings(settingsBag).customModels)
          .onChange(async (value) => {
            updateOmpProviderSettings(settingsBag, { customModels: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          });
        text.inputEl.rows = 3;
      });

    new Setting(container).setName('Befehle und Skills').setHeading();

    const commandsDesc = container.createDiv({ cls: 'claudian-sp-settings-desc' });
    commandsDesc.createEl('p', {
      cls: 'setting-item-description',
      text: 'OMP can auto-detect vault-level Claude slash commands from .claude/commands/ and skills from .claude/skills/, .codex/skills/, and .agents/skills/. Manage those entries in the Claude or Codex settings tab. This setting only hides entries from the OMP dropdown.',
    });

    context.renderHiddenProviderCommandSetting(container, 'omp', {
      name: 'Hidden Commands and Skills',
      desc: 'Hide specific OMP commands and skills from the dropdown. Enter names without the leading slash, one per line.',
      placeholder: 'compact\nreview\nfix',
    });

    if (ompWorkspace?.agentStorage) {
      new Setting(container).setName('Subagenten').setHeading();

      const subagentsDesc = container.createDiv({ cls: 'claudian-sp-settings-desc' });
      subagentsDesc.createEl('p', {
        cls: 'setting-item-description',
        text: 'Verwaltet Vault-Subagenten in .omp/agents/ — dem Verzeichnis, in dem omp Projekt-Agenten sucht. Ältere Einträge aus .omp/agent/ werden weiterhin gelesen und beim Bearbeiten dorthin verschoben. Neue Einträge erscheinen im @mention-Menü.',
      });

      const subagentsContainer = container.createDiv({ cls: 'claudian-slash-commands-container' });
      new OmpAgentSettings(
        subagentsContainer,
        ompWorkspace.agentStorage,
        context.plugin.app,
        async () => {
          await ompWorkspace.refreshAgentMentions?.();
          await recycleOmpRuntime();
        },
      );
    }

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:omp',
      heading: 'Environment',
      name: 'Environment Variables',
      desc: 'Extra environment variables passed to OMP. `OMP_ENABLE_EXA=1` is enabled by default.',
      placeholder: `${OMP_DEFAULT_ENVIRONMENT_VARIABLES}\nOMP_DB=/path/to/omp.db`,
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'omp'),
    });
  },
};

function buildEnrichedModels(
  discoveredModels: OmpDiscoveredModel[],
  visibleModels: string[],
): EnrichedModel[] {
  const enriched: EnrichedModel[] = [];
  const discoveredIds = new Set<string>();
  const baseModels = buildOmpBaseModels(discoveredModels);

  for (const model of baseModels) {
    const { modelLabel, providerLabel } = splitOmpModelLabel(model.label || model.rawId);
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

  for (const rawId of visibleModels) {
    if (discoveredIds.has(rawId)) {
      continue;
    }

    const { modelLabel, providerLabel } = splitOmpModelLabel(rawId);
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
    if (providerCmp !== 0) {
      return providerCmp;
    }
    return left.modelLabel.localeCompare(right.modelLabel);
  });
}
