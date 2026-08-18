import { Notice } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import { playAppShotFlyIn, playAppShotSound } from '../ui/AppShotFlyIn';
import {
  captureFrontmostAppShot,
  resolveAppShotSettings,
} from './appShotCapture';

let inFlight = false;

function sanitizeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 48) || 'App';
}

export async function takeAppShot(plugin: ClaudianPlugin): Promise<boolean> {
  const settings = resolveAppShotSettings(plugin.settings.appShot);
  if (!settings.enabled) {
    new Notice('App Shots sind deaktiviert.');
    return false;
  }
  if (inFlight) return false;
  inFlight = true;

  try {
    const shot = await captureFrontmostAppShot();
    await plugin.activateView();
    const view = plugin.getView();
    const tab = view?.getActiveTab();
    const imageContext = tab?.ui.imageContextManager;
    if (!imageContext) {
      new Notice('Kein Chat geöffnet — App Shot konnte nicht angehängt werden.');
      return false;
    }

    playAppShotSound(settings.playSound);
    const targetEl = tab.dom.contextRowEl ?? tab.dom.inputEl;
    await playAppShotFlyIn({
      png: shot.png,
      bounds: shot.bounds,
      targetEl,
      ownerDocument: tab.dom.inputEl.ownerDocument,
    });

    const name = `App Shot — ${sanitizeFilePart(shot.appName)}.png`;
    const attached = imageContext.addAppShot(shot.png.toString('base64'), name, shot.png.length);
    if (!attached) return false;

    if (shot.extractedText && !tab.dom.inputEl.value.trim()) {
      const title = shot.windowTitle ? ` · ${shot.windowTitle}` : '';
      tab.dom.inputEl.value = `App Shot${title} (${shot.appName})\n\n${shot.extractedText}`;
      tab.dom.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    tab.dom.inputEl.focus();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    new Notice(message);
    return false;
  } finally {
    inFlight = false;
  }
}
