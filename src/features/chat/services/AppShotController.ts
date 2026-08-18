import { Notice } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import { createAppShotFlash } from '../ui/AppShotFlash';
import { playAppShotFlyIn, playAppShotSound } from '../ui/AppShotFlyIn';
import {
  captureFrontmostAppShot,
  extractFrontmostAppText,
  focusObsidianApp,
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

  const flash = createAppShotFlash();
  try {
    playAppShotSound(settings.playSound);
    const shot = await captureFrontmostAppShot();
    flash.cover();
    flash.attach();
    const textPromise = extractFrontmostAppText();
    await focusObsidianApp();
    await plugin.activateView();
    const tab = plugin.getView()?.getActiveTab();
    const imageContext = tab?.ui.imageContextManager;
    if (!tab || !imageContext) {
      flash.dismiss();
      new Notice('Kein Chat geöffnet — App Shot konnte nicht angehängt werden.');
      return false;
    }

    const pngBase64 = shot.png.toString('base64');
    const name = `App Shot — ${sanitizeFilePart(shot.appName)}.png`;
    const attached = imageContext.addAppShot(pngBase64, name, shot.png.length);
    if (!attached) {
      flash.dismiss();
      return false;
    }

    const targetEl = tab.dom.contextRowEl ?? tab.dom.inputEl;
    void playAppShotFlyIn({
      png: shot.png,
      bounds: shot.bounds,
      targetEl,
      ownerDocument: tab.dom.inputEl.ownerDocument,
      dataUri: `data:image/png;base64,${pngBase64}`,
    });
    void flash.fadeOut();

    const inputEl = tab.dom.inputEl;
    if (!inputEl.value.trim()) {
      void textPromise.then((extractedText) => {
        if (!extractedText || inputEl.value.trim()) return;
        const title = shot.windowTitle ? ` · ${shot.windowTitle}` : '';
        inputEl.value = `App Shot${title} (${shot.appName})\n\n${extractedText}`;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    inputEl.focus();
    return true;
  } catch (error) {
    flash.dismiss();
    const message = error instanceof Error ? error.message : String(error);
    new Notice(message);
    return false;
  } finally {
    inFlight = false;
  }
}
