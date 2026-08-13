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

function isLightTheme(plugin: ClaudianPlugin): boolean {
  return plugin.app.workspace.containerEl.win.document.body.classList.contains('theme-light');
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
    button.addEventListener('click', () => {
      void saveAppearance(plugin, { ...appearance, preset }, onRerender);
    });
  }

  if (appearance.preset !== 'custom') {
    return;
  }

  addColorSetting(container, plugin, appearance, 'accent', t('settings.chatAppearance.accent.name'), t('settings.chatAppearance.accent.desc'), onRerender);
  addColorSetting(container, plugin, appearance, 'userBubble', t('settings.chatAppearance.userBubble.name'), t('settings.chatAppearance.userBubble.desc'), onRerender);
  addColorSetting(container, plugin, appearance, 'composer', t('settings.chatAppearance.composer.name'), t('settings.chatAppearance.composer.desc'), onRerender);
}

function addColorSetting(
  container: HTMLElement,
  plugin: ClaudianPlugin,
  appearance: ChatAppearanceSettings,
  key: 'accent' | 'userBubble' | 'composer',
  name: string,
  desc: string,
  onRerender: () => void,
): void {
  const setting = new Setting(container).setName(name).setDesc(desc);
  const input = setting.controlEl?.createEl?.('input', {
    attr: { type: 'color', 'aria-label': name },
  }) ?? container.createEl('input', { attr: { type: 'color', 'aria-label': name } });
  input.value = appearance[key] || '#d97757';
  input.addEventListener('input', () => {
    void saveAppearance(plugin, { ...appearance, [key]: input.value }, () => {});
  });
  input.addEventListener('change', () => {
    void saveAppearance(plugin, { ...appearance, [key]: input.value }, onRerender);
  });
}

async function saveAppearance(
  plugin: ClaudianPlugin,
  next: ChatAppearanceSettings,
  onRerender: () => void,
): Promise<void> {
  plugin.settings.chatAppearance = normalizeChatAppearance(next);
  await plugin.saveSettings();
  applyChatAppearanceToOpenViews(plugin);
  onRerender();
}
