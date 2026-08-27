import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import type ClaudianPlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { getFreebuffProviderSettings } from '../settings';
import { FreebuffOrchestratorClient } from './FreebuffOrchestratorClient';
import { FreebuffSseParser } from './FreebuffSseParser';

interface ActiveFreebuffAuxQuery {
  abortController: AbortController;
  cleanupAbortController: AbortController;
  port: number | null;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  readerCancelPromise: Promise<void> | null;
  stopPromise: Promise<void> | null;
  threadId: string | null;
}

export interface FreebuffAuxQueryRunnerOptions {
  cleanupTimeoutMs?: number;
  operationTimeoutMs?: number;
  totalTimeoutMs?: number;
}

const DEFAULT_CLEANUP_TIMEOUT_MS = 1_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 15_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 120_000;

function positiveTimeout(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

/**
 * One-shot auxiliary queries (titles, refinements) as throwaway Freebuff
 * threads: post, wait for the finish event, collect the text, close the
 * thread. Ephemeral threads never touch a chat conversation's state.
 */
export class FreebuffAuxQueryRunner implements AuxQueryRunner {
  private readonly client = new FreebuffOrchestratorClient();
  private readonly cleanupTimeoutMs: number;
  private readonly operationTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private activeQuery: ActiveFreebuffAuxQuery | null = null;

  constructor(
    private readonly plugin: ClaudianPlugin,
    options: FreebuffAuxQueryRunnerOptions = {},
  ) {
    this.cleanupTimeoutMs = positiveTimeout(options.cleanupTimeoutMs, DEFAULT_CLEANUP_TIMEOUT_MS);
    this.operationTimeoutMs = positiveTimeout(options.operationTimeoutMs, DEFAULT_OPERATION_TIMEOUT_MS);
    this.totalTimeoutMs = positiveTimeout(options.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS);
  }

  reset(): void {
    const active = this.activeQuery;
    if (active) {
      this.cancelActiveQuery(active);
    }
  }

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getFreebuffProviderSettings(settingsBag);
    if (!settings.enabled) {
      throw new Error('Freebuff ist deaktiviert.');
    }
    this.reset();
    const active: ActiveFreebuffAuxQuery = {
      abortController: new AbortController(),
      cleanupAbortController: new AbortController(),
      port: null,
      reader: null,
      readerCancelPromise: null,
      stopPromise: null,
      threadId: null,
    };
    this.activeQuery = active;
    const onAbort = (): void => {
      this.cancelActiveQuery(active);
    };
    config.abortController?.signal.addEventListener('abort', onAbort, { once: true });
    // Abort may have happened between the caller's preflight and listener
    // registration. Re-check immediately so that edge is never lost.
    if (config.abortController?.signal.aborted) {
      onAbort();
    }

    try {
      const deadlineMs = Date.now() + this.totalTimeoutMs;
      this.throwIfCancelled(active);
      const port = await this.awaitOperation(
        active,
        'discoverPort',
        deadlineMs,
        this.client.discoverPort(settings.orchestratorPort, active.abortController.signal),
      );
      active.port = port;
      this.throwIfCancelled(active);
      if (port === null) {
        throw new Error('Freebuff Desktop läuft nicht.');
      }

      const projectPath = settings.projectPath || getVaultPath(this.plugin.app) || process.cwd();
      const fullPrompt = config.systemPrompt.trim() ? `${config.systemPrompt.trim()}\n\n${prompt}` : prompt;
      const createThreadPromise = this.client.createThread(
        port,
        { projectPath, title: 'Aux' },
        active.abortController.signal,
      );
      let thread: { id: string } | null;
      try {
        thread = await this.awaitOperation(active, 'createThread', deadlineMs, createThreadPromise);
      } catch (error) {
        this.cleanupLateCreatedThread(port, createThreadPromise);
        throw error;
      }
      active.threadId = thread?.id ?? null;
      this.throwIfCancelled(active);
      if (!thread?.id) {
        throw new Error('Konnte keinen Freebuff-Aux-Thread erstellen.');
      }

      const accepted = await this.awaitOperation(
        active,
        'postMessage',
        deadlineMs,
        this.client.postMessage(port, thread.id, fullPrompt, active.abortController.signal),
      );
      this.throwIfCancelled(active);
      if (!accepted) {
        throw new Error('Freebuff hat die Aux-Anfrage nicht angenommen.');
      }

      const response = await this.awaitOperation(
        active,
        'openEventStream',
        deadlineMs,
        this.client.openEventStream(port, active.abortController.signal),
      );
      this.throwIfCancelled(active);
      if (!response?.body) {
        throw new Error('Kein Freebuff-Event-Stream.');
      }

      const parser = new FreebuffSseParser();
      const reader = response.body.getReader();
      active.reader = reader;
      this.throwIfCancelled(active);
      const decoder = new TextDecoder();
      const parts: string[] = [];
      let sawFinish = false;

      while (!sawFinish) {
        const { done, value } = await this.awaitOperation(
          active,
          'event stream read',
          deadlineMs,
          reader.read(),
        );
        this.throwIfCancelled(active);
        if (done) {
          break;
        }
        for (const busEvent of parser.push(decoder.decode(value, { stream: true }))) {
          if (busEvent.type !== 'agent' || busEvent.threadId !== thread.id) {
            continue;
          }
          const inner = busEvent.event;
          if (inner?.type === 'text' && typeof inner.text === 'string') {
            parts.push(inner.text);
          }
          if (inner?.type === 'finish') {
            sawFinish = true;
          }
        }
      }
      this.throwIfCancelled(active);

      if (!sawFinish && parts.length === 0) {
        throw new Error('Freebuff lieferte keine Aux-Antwort.');
      }
      return parts.join('').trim();
    } finally {
      config.abortController?.signal.removeEventListener('abort', onAbort);
      await this.cleanupActiveQuery(active);
      if (this.activeQuery === active) {
        this.activeQuery = null;
      }
    }
  }

  private awaitOperation<T>(
    active: ActiveFreebuffAuxQuery,
    label: string,
    deadlineMs: number,
    operation: Promise<T>,
  ): Promise<T> {
    const remainingMs = deadlineMs - Date.now();
    if (active.abortController.signal.aborted) {
      // Observe any later rejection from an operation that was already started.
      void operation.catch(() => undefined);
      return Promise.reject(new Error('Cancelled'));
    }
    if (remainingMs <= 0) {
      void operation.catch(() => undefined);
      this.cancelActiveQuery(active);
      return Promise.reject(new Error(`Freebuff ${label} timed out after ${this.totalTimeoutMs}ms.`));
    }

    const timeoutMs = Math.min(this.operationTimeoutMs, remainingMs);
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timer: number | null = null;
      const finish = (callback: () => void): boolean => {
        if (settled) {
          return false;
        }
        settled = true;
        if (timer !== null) {
          window.clearTimeout(timer);
        }
        active.abortController.signal.removeEventListener('abort', onAbort);
        callback();
        return true;
      };
      const onAbort = (): void => {
        finish(() => reject(new Error('Cancelled')));
      };

      timer = window.setTimeout(() => {
        if (finish(() => reject(new Error(`Freebuff ${label} timed out after ${Math.ceil(timeoutMs)}ms.`)))) {
          this.cancelActiveQuery(active);
        }
      }, timeoutMs);
      active.abortController.signal.addEventListener('abort', onAbort, { once: true });
      if (active.abortController.signal.aborted) {
        onAbort();
      }
      void operation.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  private throwIfCancelled(active: ActiveFreebuffAuxQuery): void {
    if (!active.abortController.signal.aborted) {
      return;
    }
    this.cancelActiveQuery(active);
    throw new Error('Cancelled');
  }

  private cancelActiveQuery(active: ActiveFreebuffAuxQuery): void {
    if (!active.abortController.signal.aborted) {
      active.abortController.abort();
    }
    void this.cancelReader(active);
    void this.stopRemoteTurn(active);
  }

  private cancelReader(active: ActiveFreebuffAuxQuery): Promise<void> {
    if (!active.reader || active.readerCancelPromise) {
      return active.readerCancelPromise ?? Promise.resolve();
    }
    try {
      active.readerCancelPromise = Promise.resolve(active.reader.cancel())
        .catch(() => undefined);
    } catch {
      active.readerCancelPromise = Promise.resolve();
    }
    return active.readerCancelPromise;
  }

  private stopRemoteTurn(active: ActiveFreebuffAuxQuery): Promise<void> {
    if (active.stopPromise) {
      return active.stopPromise;
    }
    if (active.port === null || !active.threadId) {
      return Promise.resolve();
    }
    const port = active.port;
    const threadId = active.threadId;
    active.stopPromise = this.invokeCleanup(() => this.client.stopTurn(
      port,
      threadId,
      active.cleanupAbortController.signal,
    ));
    return active.stopPromise;
  }

  private async cleanupActiveQuery(active: ActiveFreebuffAuxQuery): Promise<void> {
    this.cancelActiveQuery(active);
    const cleanupOperations = [this.cancelReader(active), this.stopRemoteTurn(active)];
    if (active.port !== null && active.threadId !== null) {
      const port = active.port;
      const threadId = active.threadId;
      cleanupOperations.push(this.invokeCleanup(() => this.client.closeThread(
        port,
        threadId,
        active.cleanupAbortController.signal,
      )));
    }
    await this.waitForCleanup(cleanupOperations, active.cleanupAbortController);
    active.reader = null;
  }

  private cleanupLateCreatedThread(
    port: number,
    createThreadPromise: Promise<{ id: string } | null>,
  ): void {
    void createThreadPromise.then(
      (thread) => {
        if (thread?.id) {
          void this.cleanupRemoteThread(port, thread.id).catch(() => undefined);
        }
      },
      () => undefined,
    );
  }

  private async cleanupRemoteThread(port: number, threadId: string): Promise<void> {
    const cleanupAbortController = new AbortController();
    const operations = [
      this.invokeCleanup(() => this.client.stopTurn(port, threadId, cleanupAbortController.signal)),
      this.invokeCleanup(() => this.client.closeThread(port, threadId, cleanupAbortController.signal)),
    ];
    await this.waitForCleanup(operations, cleanupAbortController);
  }

  private invokeCleanup(operation: () => Promise<void>): Promise<void> {
    try {
      return Promise.resolve(operation()).catch(() => undefined);
    } catch {
      return Promise.resolve();
    }
  }

  private waitForCleanup(operations: Promise<void>[], abortController: AbortController): Promise<void> {
    return new Promise((resolve) => {
      let finished = false;
      let timer: number | null = null;
      const finish = (): void => {
        if (finished) {
          return;
        }
        finished = true;
        if (timer !== null) {
          window.clearTimeout(timer);
        }
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
        resolve();
      };
      timer = window.setTimeout(finish, this.cleanupTimeoutMs);
      void Promise.allSettled(operations).then(finish);
    });
  }
}
