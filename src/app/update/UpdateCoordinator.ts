import { CliInstaller, type InstallProgress } from '../../core/install/CliInstaller';
import { clearCliUpdateCache, type ProviderUpdateInfo } from '../../core/install/CliUpdateService';
import type { UpdateInfo } from './PluginUpdater';
import type { PluginUpdater } from './PluginUpdater';
import {
  applyItemProgress,
  cliUpdateItemId,
  completeItem,
  createUpdateSession,
  dismissAllIdle,
  dismissItem,
  offerUpdateItems,
  providerIdFromUpdateItem,
  queueAllAvailable,
  queueOne,
  startNextQueued,
  type UpdateOffer,
  type UpdateSessionState,
} from './UpdateSession';

/**
 * Owns the in-chat update session: offers plugin + CLI updates, then runs
 * installs one-by-one with live progress instead of blocking confirm() dialogs.
 */
export class UpdateCoordinator {
  private state: UpdateSessionState = createUpdateSession();
  private readonly listeners = new Set<(state: UpdateSessionState) => void>();
  private readonly installer = new CliInstaller();
  private pluginUpdater: PluginUpdater | null = null;
  private pumping = false;

  setPluginUpdater(updater: PluginUpdater | null): void {
    this.pluginUpdater = updater;
  }

  getState(): UpdateSessionState {
    return this.state;
  }

  subscribe(listener: (state: UpdateSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  offerPluginUpdate(update: UpdateInfo): void {
    this.offer([
      {
        id: 'plugin',
        kind: 'plugin',
        displayName: 'ayontclaudian',
        currentVersion: update.currentVersion,
        latestVersion: update.latestVersion,
      },
    ]);
  }

  offerProviderUpdates(updates: readonly ProviderUpdateInfo[]): void {
    const offers: UpdateOffer[] = [];
    for (const info of updates) {
      if (!info.updateCommand || !info.latestVersion) {
        continue;
      }
      offers.push({
        id: cliUpdateItemId(info.providerId),
        kind: 'cli',
        displayName: info.displayName,
        currentVersion: info.currentVersion ?? '?',
        latestVersion: info.latestVersion,
        command: info.updateCommand,
      });
    }
    this.offer(offers);
  }

  startAll(): void {
    this.state = queueAllAvailable(this.state);
    this.emit();
    void this.pump();
  }

  startOne(id: string): void {
    this.state = queueOne(this.state, id);
    this.emit();
    void this.pump();
  }

  dismiss(id: string): void {
    this.state = dismissItem(this.state, id);
    this.emit();
  }

  dismissIdle(): void {
    this.state = dismissAllIdle(this.state);
    this.emit();
  }

  private offer(offers: readonly UpdateOffer[]): void {
    if (offers.length === 0) {
      return;
    }
    this.state = offerUpdateItems(this.state, offers);
    this.emit();
  }

  private emit(): void {
    const snapshot = this.state;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) {
      return;
    }
    this.pumping = true;
    try {
      while (true) {
        this.state = startNextQueued(this.state);
        const running = this.state.items.find((item) => item.status === 'running');
        if (!running) {
          break;
        }
        this.emit();
        const ok = await this.runItem(running.id, running.kind, running.latestVersion, running.command);
        this.emit();
        if (!ok && running.kind === 'plugin') {
          // Plugin reload may have torn the process down mid-queue.
          break;
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private async runItem(
    id: string,
    kind: 'plugin' | 'cli',
    latestVersion: string,
    command: string | undefined,
  ): Promise<boolean> {
    const onProgress = (progress: InstallProgress): void => {
      this.state = applyItemProgress(this.state, id, progress);
      this.emit();
    };

    if (kind === 'plugin') {
      const updater = this.pluginUpdater;
      if (!updater) {
        this.state = completeItem(this.state, id, false, 'Updater nicht bereit.');
        return false;
      }
      const result = await updater.installUpdate(latestVersion, onProgress);
      this.state = completeItem(this.state, id, result);
      return result;
    }

    if (!command) {
      this.state = completeItem(this.state, id, false, 'Kein Update-Befehl verfügbar.');
      return false;
    }
    const result = await this.installer.run(command, onProgress);
    const providerId = providerIdFromUpdateItem(id);
    if (result.ok && providerId) {
      clearCliUpdateCache(providerId);
    }
    this.state = completeItem(this.state, id, result.ok, result.error);
    return result.ok;
  }
}
