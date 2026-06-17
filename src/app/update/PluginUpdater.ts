import * as fs from 'fs';
import type { Plugin} from 'obsidian';
import { Notice, Platform, requestUrl } from 'obsidian';
import * as path from 'path';

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
}

/**
 * Lightweight in-app updater for ayontclaudian.
 *
 * Compares the locally installed manifest version with the latest GitHub release
 * and downloads main.js / styles.css / manifest.json into the plugin folder.
 * The plugin must be reloaded after installation; we trigger an Obsidian plugin
 * reload when possible, otherwise prompt the user.
 */
export class PluginUpdater {
  private readonly plugin: Plugin;
  private readonly owner = 'Ayont';
  private readonly repo = 'ayontclaudian';
  private checkInFlight = false;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Fetches the latest release manifest and returns update info if a newer
   * version is available. Returns null when no update is available or the
   * check fails.
   */
  async checkForUpdate(): Promise<UpdateInfo | null> {
    if (this.checkInFlight) {
      return null;
    }
    this.checkInFlight = true;
    try {
      const latestManifest = await this.fetchLatestManifest();
      if (!latestManifest?.version) {
        return null;
      }
      const currentVersion = this.plugin.manifest.version;
      if (compareSemver(currentVersion, latestManifest.version) >= 0) {
        return null;
      }
      return {
        currentVersion,
        latestVersion: latestManifest.version,
        releaseUrl: `https://github.com/${this.owner}/${this.repo}/releases/tag/${latestManifest.version}`,
      };
    } catch (error) {
      console.warn('[ayontclaudian] Update check failed:', error);
      return null;
    } finally {
      this.checkInFlight = false;
    }
  }

  /**
   * Checks for an update and shows a Notice when one is found. Clicking the
   * notice installs the update.
   */
  async notifyIfUpdateAvailable(): Promise<void> {
    const update = await this.checkForUpdate();
    if (!update) {
      return;
    }

    const notice = new Notice(
      `Ayontclaudian ${update.latestVersion} ist verfügbar (aktuell: ${update.currentVersion}). Klicke hier zum Aktualisieren.`,
      0,
    );

    const noticeEl = (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
    if (noticeEl) {
      noticeEl.addClass('claudian-update-notice');
      noticeEl.addEventListener('click', () => {
        notice.hide();
        void this.installUpdate(update.latestVersion);
      });
    }
  }

  /**
   * Downloads the release assets for the given version and writes them into
   * the plugin folder, then reloads the plugin.
   */
  async installUpdate(version: string): Promise<void> {
    const pluginDir = this.getPluginDirectory();
    if (!pluginDir) {
      new Notice('Ayontclaudian-update konnte nicht installiert werden: Plugin-Ordner nicht gefunden.');
      return;
    }

    const files: { name: string; url: string }[] = [
      {
        name: 'main.js',
        url: `https://github.com/${this.owner}/${this.repo}/releases/download/${version}/main.js`,
      },
      {
        name: 'styles.css',
        url: `https://github.com/${this.owner}/${this.repo}/releases/download/${version}/styles.css`,
      },
      {
        name: 'manifest.json',
        url: `https://github.com/${this.owner}/${this.repo}/releases/download/${version}/manifest.json`,
      },
    ];

    try {
      for (const file of files) {
        const response = await requestUrl({ url: file.url, throw: true });
        const content = response.text ?? (response.arrayBuffer ? undefined : '');
        if (content === undefined) {
          throw new Error(`Empty response for ${file.name}`);
        }
        const filePath = path.join(pluginDir, file.name);
        await fs.promises.writeFile(filePath, content, 'utf8');
      }

      new Notice(`Ayontclaudian ${version} installiert. Lade neu...`);
      await this.reloadPlugin();
    } catch (error) {
      console.error('[ayontclaudian] Update installation failed:', error);
      new Notice('Ayontclaudian-update konnte nicht installiert werden. Siehe konsole für details.');
    }
  }

  private async fetchLatestManifest(): Promise<{ version: string } | null> {
    const url = `https://github.com/${this.owner}/${this.repo}/releases/latest/download/manifest.json`;
    const response = await requestUrl({ url, throw: true });
    const text = response.text;
    if (!text) {
      return null;
    }
    return JSON.parse(text) as { version: string };
  }

  private getPluginDirectory(): string | null {
    if (!Platform.isDesktop) {
      return null;
    }
    const adapter = this.plugin.app.vault.adapter;
    const basePath = (adapter as unknown as { getBasePath?: () => string }).getBasePath?.();
    if (!basePath) {
      return null;
    }
    const configDir = this.plugin.app.vault.configDir;
    if (!configDir) {
      return null;
    }
    return path.join(basePath, configDir, 'plugins', this.plugin.manifest.id);
  }

  private async reloadPlugin(): Promise<void> {
    // Obsidian's public App type does not expose the plugins registry, but it
    // is available at runtime on desktop.
    const app = this.plugin.app as unknown as {
      plugins: {
        disablePlugin?: (id: string) => Promise<void>;
        enablePlugin?: (id: string) => Promise<void>;
        enablePluginAndSave?: (id: string) => Promise<void>;
      };
    };
    const plugins = app.plugins;
    const id = this.plugin.manifest.id;
    try {
      if (plugins.disablePlugin && plugins.enablePluginAndSave) {
        await plugins.disablePlugin(id);
        await plugins.enablePluginAndSave(id);
        return;
      }
      if (plugins.disablePlugin && plugins.enablePlugin) {
        await plugins.disablePlugin(id);
        await plugins.enablePlugin(id);
        return;
      }
    } catch (error) {
      console.warn('[ayontclaudian] Plugin reload failed:', error);
    }
    new Notice('Bitte Obsidian neu laden, um die neue ayontclaudian-version zu aktivieren.');
  }
}

/**
 * Simple semver comparator.
 * Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v.replace(/^v/, '')
      .split('.')
      .map((part) => {
        const num = parseInt(part, 10);
        return Number.isNaN(num) ? 0 : num;
      });
  const av = parse(a);
  const bv = parse(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai !== bi) {
      return ai - bi;
    }
  }
  return 0;
}
