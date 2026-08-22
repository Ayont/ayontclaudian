import { getProviderConfig } from '@/core/providers/providerConfig';
import { FREEBUFF_PROVIDER_ID,getFreebuffProviderSettings, updateFreebuffProviderSettings } from '@/providers/freebuff/settings';
import { buildPersistedFreebuffState,getFreebuffState } from '@/providers/freebuff/types';
import {
  DEFAULT_FREEBUFF_MODEL,
  DEFAULT_FREEBUFF_MODELS,
  formatFreebuffModelLabel,
  isKnownFreebuffModel,
} from '@/providers/freebuff/types/models';

describe('freebuff settings', () => {
  it('defaults to disabled with the verified default model', () => {
    const settings = getFreebuffProviderSettings({});
    expect(settings.enabled).toBe(false);
    expect(settings.model).toBe(DEFAULT_FREEBUFF_MODEL);
    expect(settings.orchestratorPort).toBe('');
  });

  it('round-trips updates through providerConfigs', () => {
    const bag: Record<string, unknown> = {};
    updateFreebuffProviderSettings(bag, { enabled: true, model: 'openai/gpt-5.6-luna' });
    expect(getProviderConfig(bag, FREEBUFF_PROVIDER_ID).enabled).toBe(true);
    expect(getFreebuffProviderSettings(bag).model).toBe('openai/gpt-5.6-luna');
  });
});

describe('freebuff model catalog', () => {
  it('only lists verified harness ids with the documented default first', () => {
    expect(DEFAULT_FREEBUFF_MODELS[0]?.value).toBe('deepseek/deepseek-v4-flash');
    for (const option of DEFAULT_FREEBUFF_MODELS) {
      expect(isKnownFreebuffModel(option.value)).toBe(true);
    }
  });

  it('formats labels and rejects unknown ids', () => {
    expect(formatFreebuffModelLabel('deepseek/deepseek-v4-pro')).toBe('DeepSeek V4 Pro');
    expect(isKnownFreebuffModel('totally/fake')).toBe(false);
  });
});

describe('freebuff provider state', () => {
  it('round-trips thread id and seq watermark', () => {
    const persisted = buildPersistedFreebuffState({ threadId: 'abc', lastSeq: 41 });
    expect(getFreebuffState(persisted)).toEqual({ threadId: 'abc', lastSeq: 41 });
    expect(buildPersistedFreebuffState({})).toBeUndefined();
  });
});