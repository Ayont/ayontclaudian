import { Setting } from 'obsidian';

import {
  CHAT_APPEARANCE_PRESETS,
  type ChatAppearancePreset,
  type ChatAppearanceSettings,
  getChatAppearancePresetMeta,
  normalizeChatAppearance,
} from '../../../core/theme/chatAppearance';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';

const PRESET_LABELS: Record<ChatAppearancePreset, string> = {
  host: 'Obsidian',
  ember: 'Glut',
  midnight: 'Mitternacht',
  moss: 'Moos',
  iris: 'Iris',
  sand: 'Sand',
  custom: 'Eigene',
};

const COLOR_SAVE_DEBOUNCE_MS = 280;
let colorSaveTimer: number | null = null;

export interface ThemeSwatchTarget {
  preset: ChatAppearancePreset;
  el: {
    toggleClass: (cls: string, value: boolean) => void;
    setAttribute: (name: string, value: string) => void;
  };
}

export function syncThemeSwatchSelection(
  buttons: Iterable<ThemeSwatchTarget>,
  preset: ChatAppearancePreset,
): void {
  for (const button of buttons) {
    const active = button.preset === preset;
    button.el.toggleClass('is-active', active);
    button.el.setAttribute('aria-pressed', String(active));
  }
}

function isLightTheme(plugin: ClaudianPlugin): boolean {
  const doc = plugin.app.workspace.containerEl?.ownerDocument;
  return Boolean(doc?.body?.classList.contains('theme-light'));
}

export function applyChatAppearanceToOpenViews(plugin: ClaudianPlugin): void {
  const appearance = normalizeChatAppearance(plugin.settings.chatAppearance);
  const light = isLightTheme(plugin);
  for (const view of plugin.getAllViews()) {
    view.applyChatAppearance(appearance, light);
  }
}

export function renderChatAppearanceSection(
  container: HTMLElement,
  plugin: ClaudianPlugin,
  onRerender: () => void,
): void {
  const appearance = normalizeChatAppearance(plugin.settings.chatAppearance);

  new Setting(container).setName(t('settings.chatAppearance.heading')).setHeading();

  new Setting(container)
    .setName(t('settings.chatAppearance.preset.name'))
    .setDesc(t('settings.chatAppearance.preset.desc'));

  const swatches = container.createDiv({ cls: 'claudian-theme-swatches' });
  const swatchButtons: ThemeSwatchTarget[] = [];
  for (const preset of CHAT_APPEARANCE_PRESETS) {
    const meta = getChatAppearancePresetMeta(preset);
    const button = swatches.createEl('button', {
      cls: `claudian-theme-swatch${appearance.preset === preset ? ' is-active' : ''}`,
      attr: {
        type: 'button',
        'aria-pressed': String(appearance.preset === preset),
        'aria-label': PRESET_LABELS[preset],
        title: PRESET_LABELS[preset],
      },
    });
    const dot = button.createSpan({ cls: 'claudian-theme-swatch-dot' });
    dot.style.setProperty('background', meta.swatch);
    button.createSpan({ cls: 'claudian-theme-swatch-label', text: PRESET_LABELS[preset] });
    swatchButtons.push({ preset, el: button });
    button.addEventListener('click', () => {
      const current = normalizeChatAppearance(plugin.settings.chatAppearance);
      const shouldRerender = current.preset === 'custom' || preset === 'custom';
      syncThemeSwatchSelection(swatchButtons, preset);
      void saveAppearance(
        plugin,
        { ...current, preset },
        shouldRerender ? onRerender : () => {},
        true,
      );
    });
  }

  if (appearance.preset !== 'custom') {
    return;
  }

  addColorSetting(container, plugin, appearance, 'accent', t('settings.chatAppearance.accent.name'), t('settings.chatAppearance.accent.desc'));
  addColorSetting(container, plugin, appearance, 'userBubble', t('settings.chatAppearance.userBubble.name'), t('settings.chatAppearance.userBubble.desc'));
  addColorSetting(container, plugin, appearance, 'composer', t('settings.chatAppearance.composer.name'), t('settings.chatAppearance.composer.desc'));
}

function addColorSetting(
  container: HTMLElement,
  plugin: ClaudianPlugin,
  appearance: ChatAppearanceSettings,
  key: 'accent' | 'userBubble' | 'composer',
  name: string,
  desc: string,
): void {
  const setting = new Setting(container).setName(name).setDesc(desc);
  const host = setting.controlEl ?? container;
  const input = host.createEl('input', {
    cls: 'claudian-theme-color',
    attr: { type: 'color', 'aria-label': name },
  });
  input.value = appearance[key] || '#d97757';
  input.addEventListener('input', () => {
    const current = normalizeChatAppearance(plugin.settings.chatAppearance);
    void saveAppearance(plugin, { ...current, [key]: input.value }, () => {}, false);
  });
  input.addEventListener('change', () => {
    const current = normalizeChatAppearance(plugin.settings.chatAppearance);
    void saveAppearance(plugin, { ...current, [key]: input.value }, () => {}, true);
  });
}

async function saveAppearance(
  plugin: ClaudianPlugin,
  next: ChatAppearanceSettings,
  onRerender: () => void,
  persistImmediately: boolean,
): Promise<void> {
  plugin.settings.chatAppearance = normalizeChatAppearance(next);
  applyChatAppearanceToOpenViews(plugin);
  onRerender();
  if (persistImmediately) {
    if (colorSaveTimer !== null) {
      window.clearTimeout(colorSaveTimer);
      colorSaveTimer = null;
    }
    await plugin.saveSettings();
    return;
  }
  if (colorSaveTimer !== null) {
    window.clearTimeout(colorSaveTimer);
  }
  colorSaveTimer = window.setTimeout(() => {
    colorSaveTimer = null;
    void plugin.saveSettings();
  }, COLOR_SAVE_DEBOUNCE_MS);
}
