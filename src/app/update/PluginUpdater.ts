import * as fs from 'fs';
import type { Plugin} from 'obsidian';
import { Notice, Platform, requestUrl } from 'obsidian';
import * as path from 'path';

import type { InstallProgressCallback } from '../../core/install/CliInstaller';
import { compareSemver } from '../../core/install/semver';
import { parseManifestVersion, releaseAssetBytes } from './pluginUpdateAssets';

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

    const candidateTags = [
      version.startsWith('v') ? version : `v${version}`,
      version.replace(/^v/, ''),
    ];
    const fileNames = ['main.js', 'styles.css', 'manifest.json'];

    onProgress?.({ phase: 'starting', percent: 0, line: `Lade ayontclaudian ${version}…` });

    try {
      for (let i = 0; i < fileNames.length; i++) {
        const fileName = fileNames[i];
        const percent = Math.round((i / fileNames.length) * 100);
        onProgress?.({
          phase: 'running',
          percent,
          line: `Lade ${fileName}…`,
        });

        let response = null;
        let lastError = null;
        for (const tag of candidateTags) {
          try {
            const url = `https://github.com/${this.owner}/${this.repo}/releases/download/${tag}/${fileName}`;
            response = await requestUrl({ url, throw: true });
            if (response) {
              break;
            }
          } catch (err) {
            lastError = err;
          }
        }

        if (!response) {
          throw lastError ?? new Error(`Download für ${fileName} fehlgeschlagen.`);
        }

        const bytes = releaseAssetBytes(response);
        const filePath = path.join(pluginDir, fileName);
        await fs.promises.writeFile(filePath, bytes);
        onProgress?.({
          phase: 'running',
          percent: Math.round(((i + 1) / fileNames.length) * 90),
          line: `${fileName} geschrieben`,
        });
      }

      const written = await fs.promises.readFile(path.join(pluginDir, 'manifest.json'), 'utf8');
      const writtenVersion = parseManifestVersion(written);
      if (writtenVersion !== version) {
        throw new Error(
          `Geschriebene Version ist ${writtenVersion ?? 'ungültig'}, erwartet ${version}.`,
        );
      }

      this.lastUpdate = null;
      onProgress?.({ phase: 'running', percent: 95, line: 'Lade Obsidian neu…' });
      if (!onProgress) {
        new Notice(`Ayontclaudian ${version} installiert. Lade neu...`);
      }
      this.reloadHostApp();
      onProgress?.({ phase: 'done', percent: 100, line: `ayontclaudian ${version} installiert` });
      return true;
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Download oder Schreiben fehlgeschlagen.';
      onProgress?.({ phase: 'error', percent: null, line: message });
      if (!onProgress) {
        new Notice(`Ayontclaudian-Update konnte nicht installiert werden: ${message}`);
      }
      return false;
    }
  }

  private async fetchLatestManifest(): Promise<{ version: string } | null> {
    const url = `https://github.com/${this.owner}/${this.repo}/releases/latest/download/manifest.json`;
    const response = await requestUrl({ url, throw: true });
    const version = parseManifestVersion(Buffer.from(releaseAssetBytes(response)).toString('utf8'));
    return version ? { version } : null;
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

  /**
   * A plugin cannot reliably disable+enable itself: the in-memory manifest
   * stays on the old version and the JS module stays cached. Full app reload
   * is what actually activates the files we just wrote.
   */
  private reloadHostApp(): void {
    const app = this.plugin.app as unknown as {
      commands?: { executeCommandById?: (id: string) => boolean };
    };
    window.setTimeout(() => {
      const reloaded = app.commands?.executeCommandById?.('app:reload');
      if (!reloaded) {
        new Notice('Bitte Obsidian neu laden, um die neue ayontclaudian-Version zu aktivieren.');
      }
    }, 400);
  }
}
