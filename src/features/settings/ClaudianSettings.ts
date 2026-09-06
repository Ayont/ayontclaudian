import type { App } from 'obsidian';
import { Notice, Platform, PluginSettingTab, setIcon,Setting } from 'obsidian';

import {
  getHiddenProviderCommands,
  normalizeHiddenCommandList,
} from '../../core/providers/commands/hiddenCommands';
import { setProviderEnabled } from '../../core/providers/providerConfig';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderId } from '../../core/providers/types';
import type { ChatViewPlacement } from '../../core/types/settings';
import { getAvailableLocales, getLocaleDisplayName, setLocale, t } from '../../i18n/i18n';
import type { Locale, TranslationKey } from '../../i18n/types';
import type ClaudianPlugin from '../../main';
import { createProviderIconSvg } from '../../shared/icons';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../utils/env';
import { buildNavMappingText, parseNavMappings } from './keyboardNavigation';
import { renderAppShotSettingsSection } from './ui/AppShotSettingsSection';
import { renderChatAppearanceSection } from './ui/ChatAppearanceSection';
import { renderCliInstallSection } from './ui/CliInstallSection';
import { renderEnvironmentSettingsSection } from './ui/EnvironmentSettingsSection';
import { renderUsageCostSection } from './ui/UsageCostSection';
import { renderVoiceSettingsSection } from './ui/VoiceSettingsSection';

export type SettingsCategoryId =
  | 'general'
  | 'providers'
  | 'intelligence'
  | 'tools'
  | 'input'
  | 'budget';

type SettingsTabId = SettingsCategoryId | ProviderId;

type ObsidianHotkey = { modifiers: string[]; key: string };
type ObsidianHotkeyManager = {
  customKeys?: Record<string, ObsidianHotkey[] | undefined>;
  defaultKeys?: Record<string, ObsidianHotkey[] | undefined>;
};
type ObsidianHotkeyTab = {
  searchInputEl?: HTMLInputElement;
  searchComponent?: { inputEl?: HTMLInputElement };
  updateHotkeyVisibility?: () => void;
};
type ObsidianSettingsController = {
  activeTab?: ObsidianHotkeyTab;
  open: () => void;
  openTabById: (id: string) => void;
};
type AppWithHotkeyInternals = App & {
  hotkeyManager?: ObsidianHotkeyManager;
  setting?: ObsidianSettingsController;
};

function formatHotkey(hotkey: ObsidianHotkey): string {
  const isMac = Platform.isMacOS;
  const modMap: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };

  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;

  return isMac ? [...mods, key].join('') : [...mods, key].join('+');
}

function openHotkeySettings(app: App): void {
  const setting = (app as AppWithHotkeyInternals).setting;
  if (!setting) {
    return;
  }

  setting.open();
  setting.openTabById('hotkeys');
  window.setTimeout(() => {
    const tab = setting.activeTab;
    if (!tab) {
      return;
    }

    const searchEl = tab.searchInputEl ?? tab.searchComponent?.inputEl;
    if (!searchEl) {
      return;
    }

    searchEl.value = 'Claudian';
    tab.updateHotkeyVisibility?.();
  }, 100);
}

function getHotkeyForCommand(app: App, commandId: string): string | null {
  const hotkeyManager = (app as AppWithHotkeyInternals).hotkeyManager;
  if (!hotkeyManager) return null;

  const customHotkeys = hotkeyManager.customKeys?.[commandId];
  const defaultHotkeys = hotkeyManager.defaultKeys?.[commandId];
  const hotkeys = customHotkeys && customHotkeys.length > 0 ? customHotkeys : defaultHotkeys;

  if (!hotkeys || hotkeys.length === 0) return null;

  return hotkeys.map(formatHotkey).join(', ');
}

function addHotkeySettingRow(
  containerEl: HTMLElement,
  app: App,
  commandId: string,
  translationPrefix: string,
): void {
  const hotkey = getHotkeyForCommand(app, commandId);
  const item = containerEl.createDiv({ cls: 'claudian-hotkey-item' });
  item.createSpan({
    cls: 'claudian-hotkey-name',
    text: t(`${translationPrefix}.name` as TranslationKey),
  });
  if (hotkey) {
    item.createSpan({ cls: 'claudian-hotkey-badge', text: hotkey });
  }
  item.addEventListener('click', () => openHotkeySettings(app));
}

function getCategoryMeta(catId: SettingsCategoryId, locale: string): { label: string; icon: string; desc: string } {
  const isDe = locale === 'de';
  switch (catId) {
    case 'general':
      return {
        label: isDe ? 'Allgemein' : 'General',
        icon: 'sliders',
        desc: isDe
          ? 'Chat-Erscheinungsbild, Layout, Fensterplatzierung und Streaming-Verhalten.'
          : 'Chat appearance, layout, window placement, and streaming behavior.',
      };
    case 'providers':
      return {
        label: isDe ? 'KI-Provider' : 'AI Providers',
        icon: 'cpu',
        desc: isDe
          ? 'Verbindung, API-Keys, Modelle und Optionen aller 13 KI-Provider.'
          : 'Connection, API keys, models, and options for all 13 AI providers.',
      };
    case 'intelligence':
      return {
        label: isDe ? 'Intelligenz & Wissen' : 'Intelligence & Memory',
        icon: 'brain',
        desc: isDe
          ? 'System-Prompts, Agentic Memory, Vault-RAG mit Ollama und Auto-Modell-Router.'
          : 'System prompts, agentic memory, vault RAG with Ollama, and auto model router.',
      };
    case 'tools':
      return {
        label: isDe ? 'Tools & Audio' : 'Tools & Audio',
        icon: 'wrench',
        desc: isDe
          ? 'AppShot Screenshots, Whisper-Spracheingabe, CLI-Center und Shared Environment.'
          : 'AppShot screenshots, Whisper voice input, CLI center, and shared environment.',
      };
    case 'input':
      return {
        label: isDe ? 'Eingabe & Hotkeys' : 'Input & Hotkeys',
        icon: 'keyboard',
        desc: isDe
          ? 'Senden-Tastenkombination, Vim-Navigation und Tastatur-Kurzbefehle.'
          : 'Send keyboard shortcuts, Vim navigation, and global hotkeys.',
      };
    case 'budget':
      return {
        label: isDe ? 'Verbrauch & Limits' : 'Usage & Budgets',
        icon: 'coins',
        desc: isDe
          ? 'Live-Kostentracker, Token-Statistiken und Sicherheitsbudgets.'
          : 'Live cost tracker, token statistics, and safety budgets.',
      };
  }
}

export class ClaudianSettingTab extends PluginSettingTab {
  plugin: ClaudianPlugin;
  private activeCategory: SettingsCategoryId = 'general';
  private activeProviderId: ProviderId = 'claude';

  constructor(app: App, plugin: ClaudianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  get activeTab(): SettingsTabId {
    return this.activeCategory === 'providers' ? this.activeProviderId : this.activeCategory;
  }

  set activeTab(tabId: SettingsTabId) {
    const providerIds = ProviderRegistry.getRegisteredProviderIds();
    if (providerIds.includes(tabId as ProviderId)) {
      this.activeCategory = 'providers';
      this.activeProviderId = tabId as ProviderId;
    } else if (['general', 'providers', 'intelligence', 'tools', 'input', 'budget'].includes(tabId)) {
      this.activeCategory = tabId as SettingsCategoryId;
    } else {
      this.activeCategory = 'general';
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('claudian-settings');

    setLocale(this.plugin.settings.locale as Locale);

    const categories: SettingsCategoryId[] = [
      'general',
      'providers',
      'intelligence',
      'tools',
      'input',
      'budget',
    ];

    const providerIds = ProviderRegistry.getRegisteredProviderIds();
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;

    let activeProvidersCount = 0;
    for (const pid of providerIds) {
      if (ProviderRegistry.isEnabled(pid, settingsBag)) {
        activeProvidersCount += 1;
      }
    }

    // ── Primary Category Navigation ──
    const navBar = containerEl.createDiv({ cls: 'claudian-settings-nav' });
    const navButtons = new Map<SettingsCategoryId, HTMLButtonElement>();
    const categoryContainers = new Map<SettingsCategoryId, HTMLDivElement>();

    for (const catId of categories) {
      const meta = getCategoryMeta(catId, this.plugin.settings.locale);
      const btn = navBar.createEl('button', {
        cls: `claudian-settings-nav-btn${catId === this.activeCategory ? ' claudian-settings-nav-btn--active' : ''}`,
      });

      const iconEl = btn.createSpan({ cls: 'claudian-settings-nav-icon' });
      setIcon(iconEl, meta.icon);

      btn.createSpan({ text: meta.label });

      if (catId === 'providers') {
        btn.createSpan({
          cls: 'claudian-settings-nav-badge',
          text: `${activeProvidersCount}/${providerIds.length}`,
        });
      }

      btn.addEventListener('click', () => {
        this.activeCategory = catId;
        for (const [id, b] of navButtons.entries()) {
          b.toggleClass('claudian-settings-nav-btn--active', id === catId);
        }
        for (const [id, c] of categoryContainers.entries()) {
          c.toggleClass('claudian-hidden', id !== catId);
        }
        this.resetModalScroll();
      });

      navButtons.set(catId, btn);
    }

    // ── Category Panes ──
    for (const catId of categories) {
      const pane = containerEl.createDiv({
        cls: `claudian-settings-category-pane${catId === this.activeCategory ? '' : ' claudian-hidden'}`,
      });
      categoryContainers.set(catId, pane);

      const meta = getCategoryMeta(catId, this.plugin.settings.locale);
      const banner = pane.createDiv({ cls: 'claudian-settings-banner' });
      const info = banner.createDiv({ cls: 'claudian-settings-banner-info' });
      info.createDiv({ cls: 'claudian-settings-banner-title', text: meta.label });
      info.createDiv({ cls: 'claudian-settings-banner-desc', text: meta.desc });

      try {
        switch (catId) {
          case 'general':
            this.renderGeneralCategory(pane);
            break;
          case 'providers':
            this.renderProvidersCategory(pane, () => {
              // Update provider count badge
              let activeCount = 0;
              for (const pid of providerIds) {
                if (ProviderRegistry.isEnabled(pid, settingsBag)) {
                  activeCount += 1;
                }
              }
              const providersNavBtn = navButtons.get('providers');
              const badge = providersNavBtn?.querySelector('.claudian-settings-nav-badge');
              if (badge) {
                badge.textContent = `${activeCount}/${providerIds.length}`;
              }
            });
            break;
          case 'intelligence':
            this.renderIntelligenceCategory(pane);
            break;
          case 'tools':
            this.renderToolsCategory(pane);
            break;
          case 'input':
            this.renderInputCategory(pane);
            break;
          case 'budget':
            this.renderBudgetCategory(pane);
            break;
        }
      } catch (catErr) {
        console.error(`[ClaudianSettings] Failed to render category "${catId}":`, catErr);
        const errCard = pane.createDiv({ cls: 'claudian-settings-card' });
        errCard.createDiv({
          cls: 'claudian-settings-card-title',
          text: `Fehler beim Laden von "${meta.label}"`,
        });
        errCard.createDiv({
          cls: 'claudian-settings-banner-desc',
          text: catErr instanceof Error ? catErr.message : String(catErr),
        });
      }
    }

    this.resetModalScroll();
  }

  private resetModalScroll(): void {
    window.requestAnimationFrame(() => {
      let node: HTMLElement | null = this.containerEl;
      for (let depth = 0; node && depth < 8; depth += 1) {
        node.scrollTop = 0;
        node = node.parentElement;
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 1. GENERAL CATEGORY
  // ─────────────────────────────────────────────────────────────

  private renderGeneralCategory(container: HTMLElement): void {
    // Card: Plugin & Sprache
    const pluginCard = this.createSettingsCard(container, 'sliders', 'Plugin & Sprache');
    new Setting(pluginCard)
      .setName(t('settings.language.name'))
      .setDesc(t('settings.language.desc'))
      .addDropdown((dropdown) => {
        const locales = getAvailableLocales();
        for (const locale of locales) {
          dropdown.addOption(locale, getLocaleDisplayName(locale));
        }
        dropdown
          .setValue(this.plugin.settings.locale)
          .onChange(async (value) => {
            const locale = value as Locale;
            if (!setLocale(locale)) {
              dropdown.setValue(this.plugin.settings.locale);
              return;
            }
            this.plugin.settings.locale = locale;
            await this.plugin.saveSettings();
            this.display();
          });
      });
    this.renderPluginUpdateSetting(pluginCard);

    // Card: Chat-Erscheinungsbild
    const appearanceCard = this.createSettingsCard(container, 'palette', t('settings.chatAppearance.heading'));
    renderChatAppearanceSection(appearanceCard, this.plugin, () => this.display());

    // Card: Fenster- & Tab-Layout
    const layoutCard = this.createSettingsCard(container, 'layout', 'Fenster- & Tab-Layout');
    new Setting(layoutCard)
      .setName(t('settings.chatViewPlacement.name'))
      .setDesc(t('settings.chatViewPlacement.desc'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('right-sidebar', t('settings.chatViewPlacement.rightSidebar'))
          .addOption('left-sidebar', t('settings.chatViewPlacement.leftSidebar'))
          .addOption('main-tab', t('settings.chatViewPlacement.mainTab'))
          .setValue(this.plugin.settings.chatViewPlacement)
          .onChange(async (value) => {
            this.plugin.settings.chatViewPlacement = value as ChatViewPlacement;
            await this.plugin.saveSettings();
          });
      });

    new Setting(layoutCard)
      .setName(t('settings.tabBarPosition.name'))
      .setDesc(t('settings.tabBarPosition.desc'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('input', t('settings.tabBarPosition.input'))
          .addOption('header', t('settings.tabBarPosition.header'))
          .setValue(this.plugin.settings.tabBarPosition ?? 'input')
          .onChange(async (value) => {
            this.plugin.settings.tabBarPosition = value as 'input' | 'header';
            await this.plugin.saveSettings();
            for (const view of this.plugin.getAllViews()) {
              view.updateLayoutForPosition();
            }
          });
      });

    const maxTabsSetting = new Setting(layoutCard)
      .setName(t('settings.maxTabs.name'))
      .setDesc(t('settings.maxTabs.desc'));

    const maxTabsWarningEl = layoutCard.createDiv({
      cls: 'claudian-max-tabs-warning claudian-setting-validation claudian-setting-validation-warning claudian-hidden',
    });
    maxTabsWarningEl.setText(t('settings.maxTabs.warning'));

    const updateMaxTabsWarning = (value: number): void => {
      maxTabsWarningEl.toggleClass('claudian-hidden', value <= 5);
    };

    maxTabsSetting.addSlider((slider) => {
      slider
        .setLimits(3, 10, 1)
        .setValue(Math.min(10, Math.max(3, this.plugin.settings.maxTabs ?? 3)))
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxTabs = value;
          await this.plugin.saveSettings();
          updateMaxTabsWarning(value);
          for (const view of this.plugin.getAllViews()) {
            view.refreshTabControls();
          }
        });
      updateMaxTabsWarning(this.plugin.settings.maxTabs ?? 3);
    });

    // Card: Streaming & Verhalten
    const streamingCard = this.createSettingsCard(container, 'zap', 'Streaming & Verhalten');
    new Setting(streamingCard)
      .setName(t('settings.enableAutoScroll.name'))
      .setDesc(t('settings.enableAutoScroll.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoScroll ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoScroll = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(streamingCard)
      .setName(t('settings.deferMathRenderingDuringStreaming.name'))
      .setDesc(t('settings.deferMathRenderingDuringStreaming.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deferMathRenderingDuringStreaming ?? true)
          .onChange(async (value) => {
            this.plugin.settings.deferMathRenderingDuringStreaming = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(streamingCard)
      .setName(t('settings.expandFileEditsByDefault.name'))
      .setDesc(t('settings.expandFileEditsByDefault.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.expandFileEditsByDefault ?? false)
          .onChange(async (value) => {
            this.plugin.settings.expandFileEditsByDefault = value;
            await this.plugin.saveSettings();
          })
      );
  }

  // ─────────────────────────────────────────────────────────────
  // 2. PROVIDERS CATEGORY (Provider Hub)
  // ─────────────────────────────────────────────────────────────

  private renderProvidersCategory(container: HTMLElement, onProviderStateChange: () => void): void {
    const hub = container.createDiv({ cls: 'claudian-provider-hub' });
    const providerIds = ProviderRegistry.getRegisteredProviderIds();
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;

    // ── Quick-Toggles Status Bar ──
    const hubBar = hub.createDiv({ cls: 'claudian-provider-hub-bar' });
    const counterEl = hubBar.createDiv({ cls: 'claudian-provider-hub-counter' });
    const dotEl = counterEl.createSpan({ cls: 'claudian-provider-hub-dot' });
    const counterTextEl = counterEl.createSpan();

    const updateCounterText = (): void => {
      let active = 0;
      for (const pid of providerIds) {
        if (ProviderRegistry.isEnabled(pid, settingsBag)) {
          active += 1;
        }
      }
      counterTextEl.textContent = `${active} von ${providerIds.length} Providern aktiv`;
      dotEl.style.display = active > 0 ? 'inline-block' : 'none';
    };
    updateCounterText();

    const quickList = hubBar.createDiv({ cls: 'claudian-provider-quick-list' });
    const quickChips = new Map<ProviderId, HTMLElement>();

    // ── Provider Navigation Pills ──
    const pillsBar = hub.createDiv({ cls: 'claudian-provider-pills' });
    const pillButtons = new Map<ProviderId, HTMLButtonElement>();
    const providerPanes = new Map<ProviderId, HTMLElement>();

    const selectProvider = (targetId: ProviderId): void => {
      this.activeProviderId = targetId;
      for (const [id, btn] of pillButtons.entries()) {
        btn.toggleClass('claudian-provider-pill--active', id === targetId);
      }
      for (const [id, pane] of providerPanes.entries()) {
        pane.toggleClass('is-active', id === targetId);
      }
    };

    // Card Container for active Provider
    const paneCard = hub.createDiv({ cls: 'claudian-provider-pane-card' });

    for (const providerId of providerIds) {
      const displayName = ProviderRegistry.getProviderDisplayName(providerId);
      const isAlwaysOn = ProviderRegistry.isEnabled(providerId, {
        providerConfigs: { [providerId]: { enabled: false } },
      });
      const isEnabled = ProviderRegistry.isEnabled(providerId, settingsBag);

      // Quick chip
      const chip = quickList.createDiv({
        cls: `claudian-provider-quick-chip${isEnabled ? ' is-active' : ''}`,
      });
      const chipDot = chip.createSpan({
        cls: `claudian-provider-quick-dot${isEnabled ? ' is-enabled' : ''}`,
      });
      chip.createSpan({ text: displayName });

      chip.addEventListener('click', () => {
        selectProvider(providerId);
      });
      quickChips.set(providerId, chip);

      // Pill button
      const pill = pillsBar.createEl('button', {
        cls: `claudian-provider-pill${providerId === this.activeProviderId ? ' claudian-provider-pill--active' : ''}`,
      });

      const pillIcon = pill.createSpan({ cls: 'claudian-provider-pill-icon' });
      const rawIcon = ProviderRegistry.getProviderIcon(providerId);
      pillIcon.appendChild(
        createProviderIconSvg(rawIcon, {
          width: 16,
          height: 16,
        })
      );

      pill.createSpan({ text: displayName });

      const pillDot = pill.createSpan({
        cls: `claudian-provider-pill-dot${isEnabled ? ' is-enabled' : ''}`,
      });

      pill.addEventListener('click', () => {
        selectProvider(providerId);
      });
      pillButtons.set(providerId, pill);

      // Provider Pane inside the card
      const pane = paneCard.createDiv({
        cls: `claudian-provider-pane${providerId === this.activeProviderId ? ' is-active' : ''}`,
      });
      providerPanes.set(providerId, pane);

      // Provider Header Banner with Master Toggle
      const banner = pane.createDiv({ cls: 'claudian-provider-banner-header' });
      const left = banner.createDiv({ cls: 'claudian-provider-banner-left' });
      const bannerIcon = left.createDiv({ cls: 'claudian-provider-banner-icon' });
      bannerIcon.appendChild(
        createProviderIconSvg(rawIcon, {
          width: 20,
          height: 20,
        })
      );

      const titleWrap = left.createDiv();
      titleWrap.createDiv({ cls: 'claudian-provider-banner-title', text: displayName });
      titleWrap.createDiv({
        cls: 'claudian-provider-banner-tag',
        text: isAlwaysOn ? 'Standard Provider (Immer aktiv)' : isEnabled ? 'Aktiv' : 'Deaktiviert',
      });

      new Setting(banner).addToggle((toggle) => {
        toggle
          .setValue(isEnabled)
          .setDisabled(isAlwaysOn)
          .onChange(async (val) => {
            setProviderEnabled(settingsBag, providerId, val);
            await this.plugin.saveSettings();

            // Dynamic updates
            pillDot.toggleClass('is-enabled', val);
            chipDot.toggleClass('is-enabled', val);
            chip.toggleClass('is-active', val);

            const tagEl = titleWrap.querySelector('.claudian-provider-banner-tag');
            if (tagEl) {
              tagEl.textContent = isAlwaysOn ? 'Standard Provider (Immer aktiv)' : val ? 'Aktiv' : 'Deaktiviert';
            }

            updateCounterText();
            onProviderStateChange();

            for (const view of this.plugin.getAllViews()) {
              view.refreshModelSelector();
            }
          });
      });

      // Provider-specific settings body
      const content = pane.createDiv({ cls: 'claudian-provider-content' });
      try {
        ProviderWorkspaceRegistry.getSettingsTabRenderer(providerId)?.render(content, {
          plugin: this.plugin,
          renderHiddenProviderCommandSetting: (target, targetProviderId, copy) =>
            this.renderHiddenProviderCommandSetting(target, targetProviderId, copy),
          refreshModelSelectors: () => {
            for (const view of this.plugin.getAllViews()) {
              view.refreshModelSelector();
            }
            const curr = ProviderRegistry.isEnabled(providerId, settingsBag);
            pillDot.toggleClass('is-enabled', curr);
            chipDot.toggleClass('is-enabled', curr);
            chip.toggleClass('is-active', curr);
            updateCounterText();
            onProviderStateChange();
          },
          renderCustomContextLimits: (target, pId) => this.renderCustomContextLimits(target, pId),
        });
      } catch (renderErr) {
        console.error(`[ClaudianSettings] Failed to render settings for provider "${providerId}":`, renderErr);
        const errorCard = content.createDiv({ cls: 'claudian-settings-card' });
        errorCard.createDiv({
          cls: 'claudian-settings-card-title',
          text: `Fehler beim Laden der Einstellungen für ${displayName}`,
        });
        errorCard.createDiv({
          cls: 'claudian-settings-banner-desc',
          text: renderErr instanceof Error ? renderErr.message : String(renderErr),
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 3. INTELLIGENCE CATEGORY
  // ─────────────────────────────────────────────────────────────

  private renderIntelligenceCategory(container: HTMLElement): void {
    // Card: Identität & System-Prompt
    const identityCard = this.createSettingsCard(container, 'brain', t('settings.content'));
    new Setting(identityCard)
      .setName(t('settings.userName.name'))
      .setDesc(t('settings.userName.desc'))
      .addText((text) => {
        text
          .setPlaceholder(t('settings.userName.name'))
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            this.plugin.settings.userName = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    new Setting(identityCard)
      .setName(t('settings.systemPrompt.name'))
      .setDesc(t('settings.systemPrompt.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder(t('settings.systemPrompt.name'))
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    new Setting(identityCard)
      .setName(t('settings.excludedTags.name'))
      .setDesc(t('settings.excludedTags.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder('System\nprivate\ndraft')
          .setValue(this.plugin.settings.excludedTags.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.excludedTags = value
              .split(/\r?\n/)
              .map((entry) => entry.trim().replace(/^#/, ''))
              .filter((entry) => entry.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });

    new Setting(identityCard)
      .setName(t('settings.mediaFolder.name'))
      .setDesc(t('settings.mediaFolder.desc'))
      .addText((text) => {
        text
          .setPlaceholder('Anhänge')
          .setValue(this.plugin.settings.mediaFolder)
          .onChange(async (value) => {
            this.plugin.settings.mediaFolder = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.addClass('claudian-settings-media-input');
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    // Card: Automatische Titelgenerierung
    const autoTitleCard = this.createSettingsCard(container, 'sparkles', t('settings.conversations'));
    new Setting(autoTitleCard)
      .setName(t('settings.autoTitle.name'))
      .setDesc(t('settings.autoTitle.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoTitleGeneration)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoTitleGeneration = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.enableAutoTitleGeneration) {
      new Setting(autoTitleCard)
        .setName(t('settings.titleModel.name'))
        .setDesc(t('settings.titleModel.desc'))
        .addDropdown((dropdown) => {
          dropdown.addOption('', t('settings.titleModel.auto'));

          const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
          const seenValues = new Set<string>();
          for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
            const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
            for (const model of uiConfig.getModelOptions(settingsBag)) {
              if (!seenValues.has(model.value)) {
                seenValues.add(model.value);
                dropdown.addOption(model.value, model.label);
              }
            }
          }

          dropdown
            .setValue(this.plugin.settings.titleGenerationModel || '')
            .onChange(async (value) => {
              this.plugin.settings.titleGenerationModel = value;
              await this.plugin.saveSettings();
            });
        });
    }

    // Card: Agentic Memory
    const memoryCard = this.createSettingsCard(container, 'database', t('settings.memoryAndBudget'));
    new Setting(memoryCard)
      .setName(t('settings.memoryEnabled.name'))
      .setDesc(t('settings.memoryEnabled.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.memoryEnabled ?? true)
          .onChange(async (value) => {
            this.plugin.settings.memoryEnabled = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(memoryCard)
      .setName(t('settings.memoryFolder.name'))
      .setDesc(t('settings.memoryFolder.desc'))
      .addText((text) => {
        text
          .setPlaceholder('.claudian/memory')
          .setValue(this.plugin.settings.memoryFolder ?? '.claudian/memory')
          .onChange(async (value) => {
            this.plugin.settings.memoryFolder = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(memoryCard)
      .setName(t('settings.memoryMaxNotes.name'))
      .setDesc(t('settings.memoryMaxNotes.desc'))
      .addText((text) => {
        text
          .setPlaceholder('5')
          .setValue(String(this.plugin.settings.memoryMaxNotes ?? 5))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            this.plugin.settings.memoryMaxNotes = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
            await this.plugin.saveSettings();
          });
      });

    // Card: Vault-RAG & Ollama-Embeddings
    const ollamaCard = this.createSettingsCard(container, 'search', 'Ollama-Embeddings & RAG');
    const ollamaEmbedding = this.plugin.settings.ollamaEmbedding ?? {
      enabled: true,
      baseUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
    };

    new Setting(ollamaCard)
      .setName('Ollama-Embeddings aktivieren')
      .setDesc('Einen lokalen Ollama-Server für die RAG-Embeddings des Vaults nutzen. Bei Deaktivierung greift die integrierte Keyword-Suche.')
      .addToggle((toggle) => {
        toggle
          .setValue(ollamaEmbedding.enabled)
          .onChange(async (value) => {
            this.plugin.settings.ollamaEmbedding = { ...ollamaEmbedding, enabled: value };
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (ollamaEmbedding.enabled) {
      new Setting(ollamaCard)
        .setName('Ollama-Basis-URL')
        .setDesc('Basis-URL des Ollama-Servers (z. B. http://localhost:11434).')
        .addText((text) => {
          text
            .setPlaceholder('http://localhost:11434')
            .setValue(ollamaEmbedding.baseUrl)
            .onChange(async (value) => {
              this.plugin.settings.ollamaEmbedding = { ...ollamaEmbedding, baseUrl: value.trim() };
              await this.plugin.saveSettings();
            });
        });

      new Setting(ollamaCard)
        .setName('Ollama-Embedding-Modell')
        .setDesc('Name des Embedding-Modells, das über Ollama verfügbar sein muss (z. B. nomic-embed-text).')
        .addText((text) => {
          text
            .setPlaceholder('nomic-embed-text')
            .setValue(ollamaEmbedding.model)
            .onChange(async (value) => {
              this.plugin.settings.ollamaEmbedding = { ...ollamaEmbedding, model: value.trim() };
              await this.plugin.saveSettings();
            });
        });
    }

    // Card: Automatischer Modell-Router & Vorlagen
    const routerCard = this.createSettingsCard(container, 'shuffle', 'Automatischer Modell-Router & Vorlagen');
    new Setting(routerCard)
      .setName('Modell-Router aktivieren')
      .setDesc('Die Option „Auto“ in der Modellauswahl sucht selbst das passende Modell zum Prompt (Code, Schreiben, Vision, Planung, Schnell).')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.modelRouterEnabled ?? true)
          .onChange(async (value) => {
            this.plugin.settings.modelRouterEnabled = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(routerCard)
      .setName('Ordner für Prompt-Vorlagen')
      .setDesc('Ordner mit wiederverwendbaren Markdown-Prompt-Vorlagen. Eingebaute Vorlagen stehen immer zur Verfügung.')
      .addText((text) => {
        text
          .setPlaceholder('Templates/Prompt Templates')
          .setValue(this.plugin.settings.promptTemplateFolder ?? 'Templates/Prompt Templates')
          .onChange(async (value) => {
            this.plugin.settings.promptTemplateFolder = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(routerCard)
      .setName('Ordner für exportierte Unterhaltungen')
      .setDesc('Vault-Ordner, in den „Unterhaltung als Notiz exportieren“ schreibt. Exportierte Notizen werden automatisch für RAG indexiert.')
      .addText((text) => {
        text
          .setPlaceholder('Claudian/Conversations')
          .setValue(this.plugin.settings.conversationExportFolder ?? 'Claudian/Conversations')
          .onChange(async (value) => {
            this.plugin.settings.conversationExportFolder = value.trim();
            await this.plugin.saveSettings();
          });
      });
  }

  // ─────────────────────────────────────────────────────────────
  // 4. TOOLS CATEGORY
  // ─────────────────────────────────────────────────────────────

  private renderToolsCategory(container: HTMLElement): void {
    // Card: AppShot Screenshots & OCR
    const appShotCard = this.createSettingsCard(container, 'camera', 'AppShot (Screenshots & OCR)');
    renderAppShotSettingsSection(appShotCard, this.plugin);

    // Card: Audio & Spracheingabe
    const voiceCard = this.createSettingsCard(container, 'mic', 'Audio & Spracheingabe (Whisper)');
    renderVoiceSettingsSection(voiceCard, this.plugin);

    // Card: CLI-Installations-Center
    const cliCard = this.createSettingsCard(container, 'terminal', 'CLI-Installations-Center');
    renderCliInstallSection(cliCard, this.plugin);

    // Card: Shared Environment & Proxies
    const envCard = this.createSettingsCard(container, 'globe', 'Shared Environment & Runtime');
    renderEnvironmentSettingsSection({
      container: envCard,
      plugin: this.plugin,
      scope: 'shared',
      heading: t('settings.environment'),
      name: 'Shared environment',
      desc: 'Provider-neutrale Laufzeitvariablen für alle Provider (z. B. PATH, Proxies, Zertifikate).',
      placeholder: 'PATH=/opt/homebrew/bin:/usr/local/bin\nHTTPS_PROXY=http://proxy.example.com:8080\nSSL_CERT_FILE=/path/to/cert.pem',
      renderCustomContextLimits: (target) => this.renderCustomContextLimits(target),
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 5. INPUT CATEGORY
  // ─────────────────────────────────────────────────────────────

  private renderInputCategory(container: HTMLElement): void {
    // Card: Chat-Eingabe
    const inputCard = this.createSettingsCard(container, 'message-square', t('settings.input'));
    new Setting(inputCard)
      .setName(t('settings.requireCommandOrControlEnterToSend.name'))
      .setDesc(t('settings.requireCommandOrControlEnterToSend.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.requireCommandOrControlEnterToSend ?? false)
          .onChange(async (value) => {
            this.plugin.settings.requireCommandOrControlEnterToSend = value;
            await this.plugin.saveSettings();
          });
      });

    // Card: Vim-Tastaturnavigation
    const vimCard = this.createSettingsCard(container, 'navigation', 'Vim-Tastaturnavigation');
    new Setting(vimCard)
      .setName(t('settings.navMappings.name'))
      .setDesc(t('settings.navMappings.desc'))
      .addTextArea((text) => {
        let pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
        let saveTimeout: number | null = null;

        const commitValue = async (showError: boolean): Promise<void> => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
            saveTimeout = null;
          }

          const result = parseNavMappings(pendingValue);
          if (!result.settings) {
            if (showError) {
              new Notice(`${t('common.error')}: ${result.error}`);
              pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
              text.setValue(pendingValue);
            }
            return;
          }

          this.plugin.settings.keyboardNavigation.scrollUpKey = result.settings.scrollUp;
          this.plugin.settings.keyboardNavigation.scrollDownKey = result.settings.scrollDown;
          this.plugin.settings.keyboardNavigation.focusInputKey = result.settings.focusInput;
          await this.plugin.saveSettings();
          pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
          text.setValue(pendingValue);
        };

        const scheduleSave = (): void => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
          }
          saveTimeout = window.setTimeout(() => {
            void commitValue(false);
          }, 500);
        };

        text
          .setPlaceholder('Map w scrollup\nmap s scrolldown\nmap i focusinput')
          .setValue(pendingValue)
          .onChange((value) => {
            pendingValue = value;
            scheduleSave();
          });

        text.inputEl.rows = 3;
        text.inputEl.addEventListener('blur', () => {
          void commitValue(true);
        });
      });

    // Card: Globale Tastatur-Kurzbefehle
    const hotkeysCard = this.createSettingsCard(container, 'keyboard', t('settings.hotkeys'));
    const hotkeyGrid = hotkeysCard.createDiv({ cls: 'claudian-hotkey-grid' });
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:inline-edit', 'settings.inlineEditHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:open-view', 'settings.openChatHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:new-session', 'settings.newSessionHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:new-tab', 'settings.newTabHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:close-current-tab', 'settings.closeTabHotkey');
  }

  // ─────────────────────────────────────────────────────────────
  // 6. BUDGET CATEGORY
  // ─────────────────────────────────────────────────────────────

  private renderBudgetCategory(container: HTMLElement): void {
    // Card: Live Kosten-Tracker
    const costCard = this.createSettingsCard(container, 'bar-chart-2', 'Live Kosten-Tracker & Verbrauch');
    renderUsageCostSection(costCard, this.plugin);

    // Card: Token-Budget & Sicherheitsgrenzen
    const budgetCard = this.createSettingsCard(container, 'shield', 'Token-Budget & Sicherheitsgrenzen');
    new Setting(budgetCard)
      .setName(t('settings.tokenBudgetEnabled.name'))
      .setDesc(t('settings.tokenBudgetEnabled.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.tokenBudgetEnabled ?? false)
          .onChange(async (value) => {
            this.plugin.settings.tokenBudgetEnabled = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.tokenBudgetEnabled) {
      new Setting(budgetCard)
        .setName(t('settings.dailyTokenBudget.name'))
        .setDesc(t('settings.dailyTokenBudget.desc'))
        .addText((text) => {
          text
            .setPlaceholder('0')
            .setValue(String(this.plugin.settings.dailyTokenBudget ?? 0))
            .onChange(async (value) => {
              const parsed = parseInt(value, 10);
              this.plugin.settings.dailyTokenBudget = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
              await this.plugin.saveSettings();
            });
        });

      new Setting(budgetCard)
        .setName(t('settings.sessionTokenBudget.name'))
        .setDesc(t('settings.sessionTokenBudget.desc'))
        .addText((text) => {
          text
            .setPlaceholder('0')
            .setValue(String(this.plugin.settings.sessionTokenBudget ?? 0))
            .onChange(async (value) => {
              const parsed = parseInt(value, 10);
              this.plugin.settings.sessionTokenBudget = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
              await this.plugin.saveSettings();
            });
        });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // SHARED HELPERS
  // ─────────────────────────────────────────────────────────────

  private createSettingsCard(
    container: HTMLElement,
    iconName: string,
    title: string,
    badge?: string,
  ): HTMLElement {
    const card = container.createDiv({ cls: 'claudian-settings-card' });
    const header = card.createDiv({ cls: 'claudian-settings-card-header' });

    const iconEl = header.createSpan({ cls: 'claudian-settings-card-icon' });
    setIcon(iconEl, iconName);

    header.createSpan({ cls: 'claudian-settings-card-title', text: title });

    if (badge) {
      header.createSpan({ cls: 'claudian-settings-card-badge', text: badge });
    }

    return card;
  }

  private renderPluginUpdateSetting(container: HTMLElement): void {
    const current = this.plugin.manifest.version;
    const pending = this.plugin.getPendingPluginUpdate();
    const row = new Setting(container)
      .setName('Plugin-Update')
      .setDesc(pending
        ? `${pending.latestVersion} ist verfügbar (aktuell ${current}).`
        : `Installierte Version: ${current}`);

    row.addButton((button) => {
      button.setButtonText(pending ? 'Installieren' : 'Prüfen').onClick(async () => {
        button.setDisabled(true);
        if (pending) {
          this.plugin.installPendingPluginUpdate();
          button.setDisabled(false);
          this.display();
          return;
        }
        const update = await this.plugin.checkAndOfferPluginUpdate({ notifyIfCurrent: true });
        button.setDisabled(false);
        if (update) {
          this.display();
        }
      });
      if (pending) {
        button.setCta();
      }
    });
  }

  private renderHiddenProviderCommandSetting(
    container: HTMLElement,
    providerId: ProviderId,
    copy: { name: string; desc: string; placeholder: string },
  ): void {
    new Setting(container)
      .setName(copy.name)
      .setDesc(copy.desc)
      .addTextArea((text) => {
        text
          .setPlaceholder(copy.placeholder)
          .setValue(getHiddenProviderCommands(this.plugin.settings, providerId).join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.hiddenProviderCommands = {
              ...this.plugin.settings.hiddenProviderCommands,
              [providerId]: normalizeHiddenCommandList(value.split(/\r?\n/)),
            };
            await this.plugin.saveSettings();
            this.plugin.getView()?.updateHiddenProviderCommands();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });
  }

  private renderCustomContextLimits(container: HTMLElement, providerId?: ProviderId): void {
    container.empty();

    const uniqueModelIds = new Set<string>();
    const providerIds = providerId
      ? [providerId]
      : ProviderRegistry.getRegisteredProviderIds();

    for (const targetProviderId of providerIds) {
      const envVars = parseEnvironmentVariables(
        this.plugin.getActiveEnvironmentVariables(targetProviderId),
      );
      const customModelIds = ProviderRegistry.getChatUIConfig(targetProviderId)?.getCustomModelIds?.(envVars) ?? [];
      for (const modelId of customModelIds) {
        uniqueModelIds.add(modelId);
      }
    }

    if (uniqueModelIds.size === 0) {
      return;
    }

    const headerEl = container.createDiv({ cls: 'claudian-context-limits-header' });
    headerEl.createSpan({
      text: t('settings.customModelOverrides.name'),
      cls: 'claudian-context-limits-label',
    });

    const descEl = container.createDiv({ cls: 'claudian-context-limits-desc' });
    descEl.setText(t('settings.customModelOverrides.desc'));

    const listEl = container.createDiv({ cls: 'claudian-context-limits-list' });

    for (const modelId of uniqueModelIds) {
      const currentValue = this.plugin.settings.customContextLimits?.[modelId];
      const currentAlias = this.plugin.settings.customModelAliases?.[modelId] ?? '';

      const itemEl = listEl.createDiv({ cls: 'claudian-context-limits-item' });
      const nameEl = itemEl.createDiv({ cls: 'claudian-context-limits-model' });
      nameEl.setText(modelId);

      const inputWrapper = itemEl.createDiv({ cls: 'claudian-context-limits-inputs' });

      const aliasInputEl = inputWrapper.createEl('input', {
        type: 'text',
        cls: 'claudian-context-limit-alias-input',
        value: currentAlias,
        placeholder: 'Alias (optional)',
      });

      const inputEl = inputWrapper.createEl('input', {
        type: 'text',
        cls: 'claudian-context-limit-input',
        value: currentValue ? formatContextLimit(currentValue) : '',
        placeholder: 'e.g. 200k, 1m',
      });

      const validationEl = inputWrapper.createDiv({ cls: 'claudian-context-limit-validation claudian-hidden' });

      const saveAlias = async (): Promise<void> => {
        if (!this.plugin.settings.customModelAliases) {
          this.plugin.settings.customModelAliases = {};
        }

        const existing = this.plugin.settings.customModelAliases[modelId] ?? '';
        const trimmed = aliasInputEl.value.trim();
        if (trimmed === existing) {
          aliasInputEl.value = existing;
          return;
        }

        if (trimmed) {
          this.plugin.settings.customModelAliases[modelId] = trimmed;
        } else {
          delete this.plugin.settings.customModelAliases[modelId];
        }

        await this.plugin.saveSettings();
        for (const view of this.plugin.getAllViews()) {
          view.refreshModelSelector();
        }
      };

      const saveContextLimit = async (): Promise<void> => {
        const trimmed = inputEl.value.trim();

        if (!this.plugin.settings.customContextLimits) {
          this.plugin.settings.customContextLimits = {};
        }

        if (!trimmed) {
          delete this.plugin.settings.customContextLimits[modelId];
          validationEl.toggleClass('claudian-hidden', true);
          inputEl.classList.remove('claudian-input-error');
        } else {
          const parsed = parseContextLimit(trimmed);
          if (parsed === null) {
            validationEl.setText(t('settings.customContextLimits.invalid'));
            validationEl.toggleClass('claudian-hidden', false);
            inputEl.classList.add('claudian-input-error');
            return;
          }

          this.plugin.settings.customContextLimits[modelId] = parsed;
          validationEl.toggleClass('claudian-hidden', true);
          inputEl.classList.remove('claudian-input-error');
        }

        await this.plugin.saveSettings();
      };

      inputEl.addEventListener('input', () => {
        void saveContextLimit();
      });
      aliasInputEl.addEventListener('blur', () => {
        void saveAlias();
      });
      aliasInputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          aliasInputEl.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          aliasInputEl.value = this.plugin.settings.customModelAliases?.[modelId] ?? '';
          aliasInputEl.blur();
        }
      });
    }
  }

  private async restartServiceForPromptChange(): Promise<void> {
    const view = this.plugin.getView();
    const tabManager = view?.getTabManager();
    if (!tabManager) return;

    try {
      await tabManager.broadcastToAllTabs(
        async (service) => {
          await service.ensureReady({ force: true });
        }
      );
    } catch {
      // Changes will apply on the next conversation if the restart fails.
    }
  }
}
