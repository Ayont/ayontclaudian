import * as fs from 'fs';
import type { Plugin} from 'obsidian';
import { Notice, Platform, requestUrl } from 'obsidian';
import * as path from 'path';

import type { InstallProgressCallback } from '../../core/install/CliInstaller';
import { compareSemver } from '../../core/install/semver';

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
  private inflight: Promise<UpdateInfo | null> | null = null;
  private lastUpdate: UpdateInfo | null = null;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Fetches the latest release manifest and returns update info if a newer
   * version is available. Returns null when no update is available or the
   * check fails.
   */
  async checkForUpdate(): Promise<UpdateInfo | null> {
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.performCheck().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async performCheck(): Promise<UpdateInfo | null> {
    try {
      const latestManifest = await this.fetchLatestManifest();
      if (!latestManifest?.version) {
        return this.lastUpdate;
      }
      const currentVersion = this.plugin.manifest.version;
      if (compareSemver(currentVersion, latestManifest.version) >= 0) {
        this.lastUpdate = null;
        return null;
      }
      this.lastUpdate = {
        currentVersion,
        latestVersion: latestManifest.version,
        releaseUrl: `https://github.com/${this.owner}/${this.repo}/releases/tag/${latestManifest.version}`,
      };
      return this.lastUpdate;
    } catch {
      return this.lastUpdate;
    }
  }

  getLastUpdate(): UpdateInfo | null {
    return this.lastUpdate;
  }

  /**
   * Downloads the release assets for the given version and writes them into
   * the plugin folder, then reloads the plugin.
   */
  async installUpdate(version: string, onProgress?: InstallProgressCallback): Promise<boolean> {
    const pluginDir = this.getPluginDirectory();
    if (!pluginDir) {
      onProgress?.({ phase: 'error', percent: null, line: 'Plugin-Ordner nicht gefunden.' });
      if (!onProgress) {
        new Notice('Ayontclaudian-update konnte nicht installiert werden: Plugin-Ordner nicht gefunden.');
      }
      return false;
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

    onProgress?.({ phase: 'starting', percent: 0, line: `Lade ayontclaudian ${version}…` });

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const percent = Math.round((i / files.length) * 100);
        onProgress?.({
          phase: 'running',
          percent,
          line: `Lade ${file.name}…`,
        });
        const response = await requestUrl({ url: file.url, throw: true });
        const content = response.text ?? (response.arrayBuffer ? undefined : '');
        if (content === undefined) {
          throw new Error(`Empty response for ${file.name}`);
        }
        const filePath = path.join(pluginDir, file.name);
        await fs.promises.writeFile(filePath, content, 'utf8');
        onProgress?.({
          phase: 'running',
          percent: Math.round(((i + 1) / files.length) * 90),
          line: `${file.name} geschrieben`,
        });
      }

      onProgress?.({ phase: 'running', percent: 95, line: 'Lade Plugin neu…' });
      if (!onProgress) {
        new Notice(`Ayontclaudian ${version} installiert. Lade neu...`);
      }
      await this.reloadPlugin();
      onProgress?.({ phase: 'done', percent: 100, line: `ayontclaudian ${version} installiert` });
      return true;
    } catch {
      onProgress?.({ phase: 'error', percent: null, line: 'Download oder Schreiben fehlgeschlagen.' });
      if (!onProgress) {
        new Notice('Ayontclaudian-Update konnte nicht installiert werden.');
      }
      return false;
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
    } catch {
      // Reload is best-effort; the files are already written.
    }
    new Notice('Bitte Obsidian neu laden, um die neue ayontclaudian-Version zu aktivieren.');
  }
}
