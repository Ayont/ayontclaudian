import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import type ClaudianPlugin from '../../../main';
import { nodeFetch } from '../../../utils/nodeFetch';
import { getZcodeProviderSettings } from '../settings';
import { DEFAULT_ZCODE_PRIMARY_MODEL } from '../types/models';

export class ZcodeAuxQueryRunner implements AuxQueryRunner {
  constructor(private readonly plugin: ClaudianPlugin) {}

  reset(): void {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getZcodeProviderSettings(settingsBag);
    if (!settings.enabled) {
      throw new Error('ZCode ist deaktiviert.');
    }

    const apiKey = settings.apiKey.trim();
    if (!apiKey) {
      throw new Error('Kein Z.ai API-Key konfiguriert.');
    }

    if (config.abortController?.signal.aborted) {
      throw new Error('Cancelled');
    }

    const endpoint = `${settings.baseURL.replace(/\/+$/, '')}/v1/messages`;
    const model = (config.model?.trim() || DEFAULT_ZCODE_PRIMARY_MODEL).toLowerCase();

    const messages = [{ role: 'user', content: prompt }];
    const payload: Record<string, unknown> = {
      model,
      max_tokens: 1024,
      messages,
    };
    if (config.systemPrompt) {
      payload.system = config.systemPrompt;
    }

    const response = await nodeFetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: config.abortController?.signal,
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`Z.ai Fehler (${response.status}): ${err || response.statusText}`);
    }

    const data = await response.json();
    const content = (data as { content?: unknown })?.content;
    if (Array.isArray(content)) {
      return content
        .filter((c: { type: string; text?: string }) => c.type === 'text' && c.text)
        .map((c: { text: string }) => c.text)
        .join('');
    }
    return '';
  }
}
