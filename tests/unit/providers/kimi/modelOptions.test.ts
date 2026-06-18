import * as os from 'node:os';
import * as path from 'node:path';

import {
  getConfiguredEnvCustomModel,
  getKimiModelOptions,
  parseConfiguredCustomModelIds,
  resolveKimiModelSelection,
} from '@/providers/kimi/modelOptions';
import { KIMI_PROVIDER_ID } from '@/providers/kimi/settings';
import { DEFAULT_KIMI_PRIMARY_MODEL } from '@/providers/kimi/types/models';

// Point KIMI_HOME / KIMI_CODE_HOME at empty temp dirs so neither
// `~/.kimi/config.toml` nor `~/.kimi-code/config.toml` is present and the tests
// are deterministic regardless of the developer's real config.
const ISOLATED_KIMI_HOME = path.join(os.tmpdir(), 'kimi-modeloptions-test-home-does-not-exist');
const ISOLATED_KIMI_CODE_HOME = path.join(os.tmpdir(), 'kimi-code-modeloptions-test-home-does-not-exist');
let originalKimiHome: string | undefined;
let originalKimiCodeHome: string | undefined;

beforeAll(() => {
  originalKimiHome = process.env.KIMI_HOME;
  originalKimiCodeHome = process.env.KIMI_CODE_HOME;
  process.env.KIMI_HOME = ISOLATED_KIMI_HOME;
  process.env.KIMI_CODE_HOME = ISOLATED_KIMI_CODE_HOME;
});

afterAll(() => {
  if (originalKimiHome === undefined) {
    delete process.env.KIMI_HOME;
  } else {
    process.env.KIMI_HOME = originalKimiHome;
  }
  if (originalKimiCodeHome === undefined) {
    delete process.env.KIMI_CODE_HOME;
  } else {
    process.env.KIMI_CODE_HOME = originalKimiCodeHome;
  }
});

function settingsWith(config: Record<string, unknown>): Record<string, unknown> {
  return { providerConfigs: { [KIMI_PROVIDER_ID]: config } };
}

describe('parseConfiguredCustomModelIds', () => {
  it('splits and trims lines, dropping blanks and duplicates', () => {
    const ids = parseConfiguredCustomModelIds('kimi-k2\n  kimi-k2 \n\nkimi-air\n');
    expect(ids).toEqual(['kimi-k2', 'kimi-air']);
  });

  it('returns an empty array for empty input', () => {
    expect(parseConfiguredCustomModelIds('')).toEqual([]);
    expect(parseConfiguredCustomModelIds('   \n  ')).toEqual([]);
  });
});

describe('getKimiModelOptions', () => {
  it('always includes the built-in default model', () => {
    const options = getKimiModelOptions(settingsWith({}));
    expect(options.some((option) => option.value === DEFAULT_KIMI_PRIMARY_MODEL)).toBe(true);
  });

  it('merges custom models without duplicating the default', () => {
    const options = getKimiModelOptions(
      settingsWith({ customModels: `kimi-k2\n${DEFAULT_KIMI_PRIMARY_MODEL}\nkimi-air` }),
    );
    const values = options.map((option) => option.value);
    expect(values).toContain('kimi-k2');
    expect(values).toContain('kimi-air');
    // The default appears exactly once even though customModels repeats it.
    expect(values.filter((value) => value === DEFAULT_KIMI_PRIMARY_MODEL)).toHaveLength(1);
  });

  it('seeds the Kimi coding model catalog (3 models)', () => {
    const values = getKimiModelOptions(settingsWith({})).map((option) => option.value);
    expect(values).toContain('kimi-code/kimi-for-coding');
    expect(values).toContain('kimi-k2.7-code');
    expect(values).toContain('kimi-k2.7-code-highspeed');
    // Non-coding platform / legacy models are intentionally hidden.
    expect(values).not.toContain('kimi-k2.6');
    expect(values).not.toContain('moonshot-v1-128k');
  });

  it('surfaces an env KIMI_MODEL as a custom option at the front', () => {
    const options = getKimiModelOptions(
      settingsWith({ environmentVariables: 'KIMI_MODEL=kimi-custom-env' }),
    );
    expect(options[0]?.value).toBe('kimi-custom-env');
    expect(options[0]?.description).toBe('Custom (env)');
  });
});

describe('getConfiguredEnvCustomModel', () => {
  it('returns the env model when it is not a built-in default', () => {
    expect(
      getConfiguredEnvCustomModel(settingsWith({ environmentVariables: 'KIMI_MODEL=kimi-k2' })),
    ).toBe('kimi-k2');
  });

  it('returns null when no env model is configured', () => {
    expect(getConfiguredEnvCustomModel(settingsWith({}))).toBeNull();
  });

  it('returns null when the env model is the built-in default', () => {
    expect(
      getConfiguredEnvCustomModel(
        settingsWith({ environmentVariables: `KIMI_MODEL=${DEFAULT_KIMI_PRIMARY_MODEL}` }),
      ),
    ).toBeNull();
  });
});

describe('resolveKimiModelSelection', () => {
  it('keeps a still-valid current selection', () => {
    const settings = settingsWith({ customModels: 'kimi-k2' });
    expect(resolveKimiModelSelection(settings, 'kimi-k2')).toBe('kimi-k2');
  });

  it('falls back to the first option (default) for an unknown current model', () => {
    const settings = settingsWith({});
    expect(resolveKimiModelSelection(settings, 'nonexistent-model')).toBe(DEFAULT_KIMI_PRIMARY_MODEL);
  });

  it('lets an env KIMI_MODEL override the current selection', () => {
    const settings = settingsWith({ environmentVariables: 'KIMI_MODEL=kimi-env-win' });
    expect(resolveKimiModelSelection(settings, 'kimi-k2')).toBe('kimi-env-win');
  });
});
