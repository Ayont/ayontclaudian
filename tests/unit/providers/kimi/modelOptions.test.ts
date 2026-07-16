import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getKimiConfigPath } from '@/providers/kimi/history/KimiSessionStore';
import {
  ensureKimiModelConfigured,
  getConfiguredEnvCustomModel,
  getKimiModelContextWindow,
  getKimiModelOptions,
  parseConfiguredCustomModelIds,
  resolveKimiModelSelection,
} from '@/providers/kimi/modelOptions';
import { KIMI_PROVIDER_ID } from '@/providers/kimi/settings';
import {
  DEFAULT_KIMI_CONTEXT_WINDOW,
  DEFAULT_KIMI_PRIMARY_MODEL,
  KIMI_K3_CONTEXT_WINDOW,
  KIMI_K3_MODEL,
} from '@/providers/kimi/types/models';

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

function writeKimiConfig(contents: string): void {
  fs.mkdirSync(path.dirname(getKimiConfigPath()), { recursive: true });
  fs.writeFileSync(getKimiConfigPath(), contents, 'utf-8');
}

function removeKimiConfig(): void {
  try {
    fs.unlinkSync(getKimiConfigPath());
  } catch {
    // best-effort cleanup
  }
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

  it('only surfaces catalog models when they are configured in config.toml', () => {
    // Without config entries, only the built-in default is offered.
    const values = getKimiModelOptions(settingsWith({})).map((option) => option.value);
    expect(values).toContain('kimi-code/kimi-for-coding');
    expect(values).not.toContain(KIMI_K3_MODEL);
    expect(values).not.toContain('kimi-k2.7-code');
    expect(values).not.toContain('kimi-k2.7-code-highspeed');
    // Non-coding platform / legacy models are intentionally hidden.
    expect(values).not.toContain('kimi-k2.6');
    expect(values).not.toContain('moonshot-v1-128k');
  });

  it('surfaces a configured catalog model with its curated label and description', () => {
    writeKimiConfig(`[models."${KIMI_K3_MODEL}"]\nmax_context_size = ${KIMI_K3_CONTEXT_WINDOW}\n`);

    const k3 = getKimiModelOptions(settingsWith({})).find((option) => option.value === KIMI_K3_MODEL);
    expect(k3?.label).toBe('Kimi · K3');
    expect(k3?.description).toContain('1M');

    removeKimiConfig();
  });

  it('includes configured catalog models from config.toml', () => {
    const configDir = path.dirname(getKimiConfigPath());
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      getKimiConfigPath(),
      '[models."kimi-k2.7-code-highspeed"]\ndisplay_name = "K2.7 HS"\nmax_context_size = 262144\n',
      'utf-8',
    );

    const values = getKimiModelOptions(settingsWith({})).map((option) => option.value);
    expect(values).toContain('kimi-code/kimi-for-coding');
    expect(values).toContain('kimi-k2.7-code-highspeed');

    try {
      fs.unlinkSync(getKimiConfigPath());
    } catch {
      // best-effort cleanup
    }
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

describe('getKimiModelContextWindow', () => {
  it('returns the 1M context window for kimi-k3 without any config entry', () => {
    expect(getKimiModelContextWindow(KIMI_K3_MODEL)).toBe(KIMI_K3_CONTEXT_WINDOW);
    expect(KIMI_K3_CONTEXT_WINDOW).toBe(1_048_576);
  });

  it('returns the 256K coding context window for kimi-k2.7-code without config', () => {
    expect(getKimiModelContextWindow('kimi-k2.7-code')).toBe(DEFAULT_KIMI_CONTEXT_WINDOW);
  });

  it('falls back to the default context window for unknown models', () => {
    expect(getKimiModelContextWindow('some-custom-model')).toBe(DEFAULT_KIMI_CONTEXT_WINDOW);
  });

  it('prefers the configured max_context_size over the catalog value', () => {
    writeKimiConfig(`[models."${KIMI_K3_MODEL}"]\ndisplay_name = "K3"\nmax_context_size = 512000\n`);

    expect(getKimiModelContextWindow(KIMI_K3_MODEL)).toBe(512000);

    removeKimiConfig();
  });
});

describe('ensureKimiModelConfigured', () => {
  it('seeds kimi-k3 with its 1M context window', () => {
    writeKimiConfig('');

    expect(ensureKimiModelConfigured(KIMI_K3_MODEL)).toBe(true);
    const raw = fs.readFileSync(getKimiConfigPath(), 'utf-8');
    expect(raw).toContain(`[models."${KIMI_K3_MODEL}"]`);
    expect(raw).toContain(`max_context_size = ${KIMI_K3_CONTEXT_WINDOW}`);
    // A second call detects the existing section and leaves the file alone.
    expect(ensureKimiModelConfigured(KIMI_K3_MODEL)).toBe(false);

    removeKimiConfig();
  });

  it('seeds unknown models with the default context window', () => {
    writeKimiConfig('');

    expect(ensureKimiModelConfigured('my-custom-model')).toBe(true);
    const raw = fs.readFileSync(getKimiConfigPath(), 'utf-8');
    expect(raw).toContain(`max_context_size = ${DEFAULT_KIMI_CONTEXT_WINDOW}`);

    removeKimiConfig();
  });

  it('never writes a section for the built-in default model', () => {
    expect(ensureKimiModelConfigured(DEFAULT_KIMI_PRIMARY_MODEL)).toBe(false);
  });
});
