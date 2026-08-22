import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import type ClaudianPlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { getFreebuffProviderSettings } from '../settings';
import { FreebuffOrchestratorClient } from './FreebuffOrchestratorClient';
import { FreebuffSseParser } from './FreebuffSseParser';

/**
 * One-shot auxiliary queries (titles, refinements) as throwaway Freebuff
 * threads: post, wait for the finish event, collect the text, close the
 * thread. Ephemeral threads never touch a chat conversation's state.
 */
export class FreebuffAuxQueryRunner implements AuxQueryRunner {
  private readonly client = new FreebuffOrchestratorClient();

  constructor(private readonly plugin: ClaudianPlugin) {}

  reset(): void {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getFreebuffProviderSettings(settingsBag);
    if (!settings.enabled) {
      throw new Error('Freebuff ist deaktiviert.');
    }
    if (config.abortController?.signal.aborted) {
      throw new Error('Cancelled');
    }

    const port = await this.client.discoverPort(settings.orchestratorPort);
    if (port === null) {
      throw new Error('Freebuff Desktop läuft nicht.');
    }

    const projectPath = settings.projectPath || getVaultPath(this.plugin.app) || process.cwd();
    const fullPrompt = config.systemPrompt.trim() ? `${config.systemPrompt.trim()}\n\n${prompt}` : prompt;
    const thread = await this.client.createThread(port, { projectPath, title: 'Aux' });
    if (!thread?.id) {
      throw new Error('Konnte keinen Freebuff-Aux-Thread erstellen.');
    }

    const abort = new AbortController();
    const onAbort = (): void => {
      void this.client.stopTurn(port, thread.id).catch(() => undefined);
    };
    config.abortController?.signal.addEventListener('abort', onAbort, { once: true });

    try {
      const accepted = await this.client.postMessage(port, thread.id, fullPrompt);
      if (!accepted) {
        throw new Error('Freebuff hat die Aux-Anfrage nicht angenommen.');
      }

      const response = await this.client.openEventStream(port, abort.signal);
      if (!response?.body) {
        throw new Error('Kein Freebuff-Event-Stream.');
      }

      const parser = new FreebuffSseParser();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parts: string[] = [];
      let sawFinish = false;
      const deadlineMs = Date.now() + 120_000;

      while (!sawFinish && Date.now() < deadlineMs) {
        const { done, value } = await reader.read();
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
      abort.abort();

      if (!sawFinish && parts.length === 0) {
        throw new Error('Freebuff lieferte keine Aux-Antwort.');
      }
      return parts.join('').trim();
    } finally {
      config.abortController?.signal.removeEventListener('abort', onAbort);
      if (!config.abortController?.signal.aborted) {
        abort.abort();
      }
      void this.client.closeThread(port, thread.id);
    }
  }
}