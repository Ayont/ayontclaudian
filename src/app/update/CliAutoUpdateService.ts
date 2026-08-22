import { Notice } from 'obsidian';

import { CliInstaller } from '../../core/install/CliInstaller';
import {
  checkEnabledProviderUpdates,
  clearCliUpdateCache,
  type ProviderUpdateInfo,
  readCliBinaryVersion,
  wasCliVersionUnchanged,
} from '../../core/install/CliUpdateService';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type ClaudianPlugin from '../../main';

export type CliAutoUpdateMode = 'off' | 'notify' | 'auto';

export interface CliAutoCycleEntry {
  providerId: string;
  ok: boolean;
  detail?: string;
}

const STARTUP_DELAY_MS = 45_000;
const DUE_TICK_MS = 30 * 60_000;
const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 336;

/** Unknown or missing values fall back to the product default ('auto'). */
export function parseCliAutoUpdateMode(value: unknown): CliAutoUpdateMode {
  return value === 'off' || value === 'notify' ? value : 'auto';
}

export function normalizeCliAutoUpdateIntervalHours(value: unknown): number {
  const hours = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 24;
  return Math.min(MAX_INTERVAL_HOURS, Math.max(MIN_INTERVAL_HOURS, hours));
}

export function isAutoCycleDue(
  lastRunAt: number | null | undefined,
  intervalMs: number,
  now: number,
): boolean {
  if (lastRunAt === null || lastRunAt === undefined) {
    return true;
  }
  return now - lastRunAt >= intervalMs;
}

/** Only providers with something to install and a known way to install it. */
export function planAutoUpdates(updates: readonly ProviderUpdateInfo[]): ProviderUpdateInfo[] {
  return updates.filter((info) => info.updateAvailable && Boolean(info.updateCommand));
}

/** Runs provider-CLI update cycles in the background: silently installing in
 *  'auto' mode, only offering updates through the coordinator in 'notify' mode. */
export class CliAutoUpdateService {
  private intervalId: number | null = null;
  private startupTimer: number | null = null;
  private running = false;
  private readonly installer = new CliInstaller();

  constructor(private readonly plugin: ClaudianPlugin) {}

  schedule(): void {
    this.stop();
    const mode = parseCliAutoUpdateMode(this.plugin.settings.cliAutoUpdateMode);
    if (mode === 'off') {
      return;
    }
    this.startupTimer = window.setTimeout(() => {
      this.startupTimer = null;
      void this.runCycle('startup');
    }, STARTUP_DELAY_MS);
    this.intervalId = this.plugin.registerInterval(
      window.setInterval(() => {
        const hours = normalizeCliAutoUpdateIntervalHours(this.plugin.settings.cliAutoUpdateIntervalHours);
        if (isAutoCycleDue(this.plugin.settings.cliAutoUpdateLastRunAt ?? null, hours * 3_600_000, Date.now())) {
          void this.runCycle('interval');
        }
      }, DUE_TICK_MS),
    );
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.startupTimer !== null) {
      window.clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  async runCycle(trigger: 'startup' | 'interval' | 'manual'): Promise<CliAutoCycleEntry[]> {
    if (this.running) {
      return [];
    }
    const mode = parseCliAutoUpdateMode(this.plugin.settings.cliAutoUpdateMode);
    if (mode === 'off') {
      return [];
    }
    this.running = true;
    try {
      const settingsRecord = this.plugin.settings as unknown as Record<string, unknown>;
      const enabled = ProviderRegistry.getEnabledProviderIds(settingsRecord);
      const updates = await checkEnabledProviderUpdates(enabled, settingsRecord);
      // Persist even on an empty result so sleeping laptops do not re-probe every tick.
      this.plugin.settings.cliAutoUpdateLastRunAt = Date.now();
      await this.plugin.saveSettings();
      if (updates.length === 0) {
        return [];
      }
      if (mode === 'notify') {
        this.plugin.offerProviderUpdateInfos(updates);
        return [];
      }
      return await this.installPlanned(planAutoUpdates(updates));
    } finally {
      this.running = false;
    }
  }

  private async installPlanned(planned: readonly ProviderUpdateInfo[]): Promise<CliAutoCycleEntry[]> {
    const results: CliAutoCycleEntry[] = [];
    for (const info of planned) {
      results.push(await this.installOne(info));
    }
    this.report(results);
    return results;
  }

  private async installOne(info: ProviderUpdateInfo): Promise<CliAutoCycleEntry> {
    try {
      const result = await this.installer.run(info.updateCommand!, () => {});
      let ok = result.ok;
      let detail = result.error;
      if (ok && info.cliPath && info.currentVersion && info.currentVersion !== '?') {
        clearCliUpdateCache(info.providerId);
        const after = await readCliBinaryVersion(info.cliPath);
        if (wasCliVersionUnchanged(info.currentVersion, after)) {
          ok = false;
          detail = 'Version unverändert — Update griff nicht.';
        }
      }
      return { providerId: info.providerId, ok, detail };
    } catch (error) {
      return { providerId: info.providerId, ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  private report(results: readonly CliAutoCycleEntry[]): void {
    if (results.length === 0) {
      return;
    }
    const succeeded = results.filter((entry) => entry.ok);
    if (succeeded.length > 0) {
      new Notice(`CLI-Aktualisierung: ${succeeded.map((entry) => entry.providerId).join(', ')} auf neue Version gebracht.`);
    }
    for (const entry of results.filter((entry) => !entry.ok)) {
      new Notice(`CLI-Auto-Update fehlgeschlagen (${entry.providerId}): ${entry.detail ?? 'unbekannter Fehler'}`);
    }
  }
}
