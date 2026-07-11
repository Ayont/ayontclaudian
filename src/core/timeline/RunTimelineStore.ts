import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import type { RunTimeline } from './runTimeline';

/** Hidden vault folder: durable observability without cluttering regular notes. */
export const RUN_TIMELINE_HISTORY_FOLDER = '.claudian/run-history';
export const RUN_TIMELINE_HISTORY_LIMIT = 30;

function cloneTimeline(timeline: RunTimeline): RunTimeline {
  return {
    ...timeline,
    externalContextPaths: timeline.externalContextPaths ? [...timeline.externalContextPaths] : undefined,
    events: timeline.events.map(event => ({ ...event })),
  };
}

function isRunTimeline(value: unknown): value is RunTimeline {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RunTimeline>;
  return typeof candidate.id === 'string'
    && typeof candidate.providerId === 'string'
    && typeof candidate.startedAt === 'number'
    && Array.isArray(candidate.events);
}

/**
 * Durable archive for provider-neutral run traces.
 *
 * The live inspector is intentionally transient; this archive means the
 * existing “Show last run timeline” command also works after Obsidian or the
 * plugin restarts. Writes are serialized and failures are deliberately
 * best-effort so an observability feature can never block a chat response.
 */
export class RunTimelineStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly adapter: VaultFileAdapter,
    private readonly folder = RUN_TIMELINE_HISTORY_FOLDER,
    private readonly limit = RUN_TIMELINE_HISTORY_LIMIT,
  ) {}

  async save(timeline: RunTimeline): Promise<void> {
    const snapshot = cloneTimeline(timeline);
    const path = `${this.folder}/${this.toFilename(snapshot)}`;
    this.writeQueue = this.writeQueue
      .catch(() => {
        // Recover the queue after a transient vault write failure.
      })
      .then(async () => {
        await this.adapter.write(path, JSON.stringify(snapshot, null, 2));
        await this.prune();
      });
    await this.writeQueue;
  }

  async getLatest(): Promise<RunTimeline | null> {
    const files = await this.adapter.listFiles(this.folder);
    const candidates = await Promise.all(files
      .filter(path => path.endsWith('.json'))
      .map(async (path) => ({ path, stat: await this.adapter.stat(path) })));

    candidates.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));
    for (const candidate of candidates) {
      try {
        const parsed: unknown = JSON.parse(await this.adapter.read(candidate.path));
        if (isRunTimeline(parsed)) return cloneTimeline(parsed);
      } catch {
        // A partially written or manually altered entry must not break the archive.
      }
    }
    return null;
  }

  async clear(): Promise<void> {
    const files = await this.adapter.listFiles(this.folder);
    await Promise.all(files
      .filter(path => path.endsWith('.json'))
      .map(path => this.adapter.delete(path)));
  }

  private async prune(): Promise<void> {
    const files = await this.adapter.listFiles(this.folder);
    if (files.length <= this.limit) return;

    const candidates = await Promise.all(files
      .filter(path => path.endsWith('.json'))
      .map(async (path) => ({ path, stat: await this.adapter.stat(path) })));
    candidates.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));
    await Promise.all(candidates.slice(this.limit).map(candidate => this.adapter.delete(candidate.path)));
  }

  private toFilename(timeline: RunTimeline): string {
    const safeId = timeline.id.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100);
    return `${timeline.startedAt}-${safeId || 'run'}.json`;
  }
}
