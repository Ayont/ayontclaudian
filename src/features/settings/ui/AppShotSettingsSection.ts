import { setIcon,Setting } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import {
  type AppShotHotkey,
  DEFAULT_APP_SHOT_HOTKEY,
  formatAppShotHotkey,
  resolveAppShotSettings,
} from '../../chat/services/appShotCapture';

function eventToHotkey(event: KeyboardEvent): AppShotHotkey | null {
  if (event.key === 'Escape' || event.key === 'Tab') return null;
  const modifiers: AppShotHotkey['modifiers'] = [];
  if (event.metaKey || event.ctrlKey) modifiers.push('Mod');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (!key || ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null;
  if (modifiers.length === 0) return null;
  return { modifiers, key };
}

export function renderAppShotSettingsSection(container: HTMLElement, plugin: ClaudianPlugin): void {
  const settings = resolveAppShotSettings(plugin.settings.appShot);
  plugin.settings.appShot = settings;

  new Setting(container).setName('App Shots').setHeading();

  const card = container.createDiv({ cls: 'claudian-appshot-settings' });
  const intro = card.createDiv({ cls: 'claudian-appshot-settings-intro' });
  const icon = intro.createSpan({ cls: 'claudian-appshot-settings-icon' });
  setIcon(icon, 'camera');
  const copy = intro.createDiv({ cls: 'claudian-appshot-settings-copy' });
  copy.createEl('strong', { text: 'App Shot aufnehmen, um dem Chat die vorderste App zu zeigen' });
  copy.createEl('p', {
    text: 'Der Shot enthält das Fensterbild und sichtbaren Text — auch Inhalte, die gerade nicht im Viewport sind. Tastenkürzel ist ⌘⇧2, nicht ChatGPTs Doppel-⌘.',
  });

  new Setting(card)
    .setName('Tastenkürzel')
    .setDesc('Drücke die neue Kombination. Funktioniert auch, wenn Obsidian nicht im Vordergrund ist.')
    .addButton((button) => {
      const renderLabel = () => {
        button.setButtonText(formatAppShotHotkey(settings.hotkey, process.platform));
      };
      renderLabel();
      button.buttonEl.addClass('claudian-appshot-hotkey-btn');
      button.onClick(() => {
        button.setButtonText('Taste drücken…');
        const onKey = (event: KeyboardEvent) => {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Escape') {
            window.removeEventListener('keydown', onKey, true);
            renderLabel();
            return;
          }
          const next = eventToHotkey(event);
          if (!next) return;
          window.removeEventListener('keydown', onKey, true);
          settings.hotkey = next;
          plugin.settings.appShot = settings;
          void plugin.saveSettings();
          plugin.syncAppShotHotkey();
          renderLabel();
        };
        window.addEventListener('keydown', onKey, true);
      });
    })
    .addExtraButton((extra) => {
      extra.setIcon('rotate-ccw');
      extra.setTooltip('Standard ⌘⇧2 wiederherstellen');
      extra.onClick(() => {
        settings.hotkey = { ...DEFAULT_APP_SHOT_HOTKEY };
        plugin.settings.appShot = settings;
        void plugin.saveSettings();
        plugin.syncAppShotHotkey();
        const label = card.querySelector('.claudian-appshot-hotkey-btn');
        if (label) label.setText(formatAppShotHotkey(settings.hotkey, process.platform));
      });
    });

  new Setting(card)
    .setName('App-Shot-Ziel')
    .setDesc('Wohin der Shot gelegt wird, wenn du das Tastenkürzel nutzt.')
    .addDropdown((dropdown) => {
      dropdown.addOption('auto', 'Automatisch');
      dropdown.addOption('active-chat', 'Aktiver Chat');
      dropdown.setValue(settings.target);
      dropdown.onChange((value) => {
        settings.target = value === 'active-chat' ? 'active-chat' : 'auto';
        plugin.settings.appShot = settings;
        void plugin.saveSettings();
      });
    });

  new Setting(card)
    .setName('Soundeffekt abspielen')
    .setDesc('Kurzer Auslöser-Ton, wenn der Shot landet.')
    .addToggle((toggle) => {
      toggle.setValue(settings.playSound);
      toggle.onChange((value) => {
        settings.playSound = value;
        plugin.settings.appShot = settings;
        void plugin.saveSettings();
      });
    });

  new Setting(card)
    .setName('App Shots aktiv')
    .addToggle((toggle) => {
      toggle.setValue(settings.enabled);
      toggle.onChange((value) => {
        settings.enabled = value;
        plugin.settings.appShot = settings;
        void plugin.saveSettings();
        plugin.syncAppShotHotkey();
      });
    });
}
