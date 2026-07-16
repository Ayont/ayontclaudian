import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getVibeConfigPath } from '@/providers/vibe/history/VibeSessionStore';
import {
  getConfiguredEnvCustomModel,
  getVibeModelContextWindow,
  getVibeModelOptions,
  parseConfiguredCustomModelIds,
  readVibeConfiguredModels,
  resolveVibeModelSelection,
} from '@/providers/vibe/modelOptions';
import { VIBE_PROVIDER_ID } from '@/providers/vibe/settings';
import {
  DEFAULT_VIBE_CONTEXT_WINDOW,
  DEFAULT_VIBE_PRIMARY_MODEL,
} from '@/providers/vibe/types/models';

// `import * as fs` yields a getter-bound module namespace under ts-jest that
// jest.spyOn cannot redefine; spy on the underlying builtin exports object
// (the same singleton the code under test resolves).
const realFs = jest.requireActual<typeof fs>('node:fs');

// Point VIBE_HOME at an empty temp dir so `~/.vibe/config.toml` is absent and
// the tests are deterministic regardless of the developer's real config.
const ISOLATED_VIBE_HOME = path.join(os.tmpdir(), 'vibe-modeloptions-test-home-does-not-exist');
let originalVibeHome: string | undefined;

beforeAll(() => {
  originalVibeHome = process.env.VIBE_HOME;
  process.env.VIBE_HOME = ISOLATED_VIBE_HOME;
});

afterAll(() => {
  if (originalVibeHome === undefined) {
    delete process.env.VIBE_HOME;
  } else {
    process.env.VIBE_HOME = originalVibeHome;
  }
});

function settingsWith(config: Record<string, unknown>): Record<string, unknown> {
  return { providerConfigs: { [VIBE_PROVIDER_ID]: config } };
}

function writeVibeConfig(contents: string): void {
  fs.mkdirSync(path.dirname(getVibeConfigPath()), { recursive: true });
  fs.writeFileSync(getVibeConfigPath(), contents, 'utf-8');
}

function removeVibeConfig(): void {
  try {
    fs.unlinkSync(getVibeConfigPath());
  } catch {
    // best-effort cleanup
  }
}

describe('parseConfiguredCustomModelIds', () => {
  it('splits and trims lines, dropping blanks and duplicates', () => {
    const ids = parseConfiguredCustomModelIds('devstral-small\n  devstral-small \n\nvibe-air\n');
    expect(ids).toEqual(['devstral-small', 'vibe-air']);
  });

  it('returns an empty array for empty input', () => {
    expect(parseConfiguredCustomModelIds('')).toEqual([]);
    expect(parseConfiguredCustomModelIds('   \n  ')).toEqual([]);
  });
});

describe('readVibeConfiguredModels caching', () => {
  it('serves repeated calls from the cache without re-reading the file', () => {
    writeVibeConfig('[models."vibe-cache-a"]\nmax_context_size = 128000\n');

    const spy = jest.spyOn(realFs, 'readFileSync');
    try {
      const first = readVibeConfiguredModels();
      expect(spy).toHaveBeenCalledTimes(1); // cold read parses the file once

      spy.mockClear();
      const second = readVibeConfiguredModels();
      const options = getVibeModelOptions(settingsWith({}));

      expect(second).toEqual(first);
      expect(options.some((option) => option.value === 'vibe-cache-a')).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      removeVibeConfig();
    }
  });

  it('parses the config at most once per resolveModelSelection call chain', () => {
    writeVibeConfig('default_model = "vibe-cache-b"\n[models."vibe-cache-b"]\nmax_context_size = 64000\n');

    const spy = jest.spyOn(realFs, 'readFileSync');
    try {
      expect(resolveVibeModelSelection(settingsWith({}), 'unknown-model')).toBe('vibe-cache-b');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      removeVibeConfig();
    }
  });

  it('picks up a modified config on the next read', () => {
    writeVibeConfig('[models."vibe-cache-old"]\nmax_context_size = 128000\n');
    expect(readVibeConfiguredModels().models.map((model) => model.id)).toContain('vibe-cache-old');

    // Different content length keeps the stat signature distinct even when the
    // filesystem mtime resolution would make the two writes collide.
    writeVibeConfig('[models."vibe-cache-newer-model"]\nmax_context_size = 64000\n');
    const { models } = readVibeConfiguredModels();
    expect(models.map((model) => model.id)).toContain('vibe-cache-newer-model');
    expect(models.map((model) => model.id)).not.toContain('vibe-cache-old');

    removeVibeConfig();
  });

  it('returns an empty list for a missing config and caches that too', () => {
    removeVibeConfig();

    const spy = jest.spyOn(realFs, 'readFileSync');
    try {
      expect(readVibeConfiguredModels()).toEqual({ models: [], defaultModel: null });
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockClear();
      expect(readVibeConfiguredModels()).toEqual({ models: [], defaultModel: null });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('getVibeModelOptions', () => {
  it('always includes the built-in default model', () => {
    const options = getVibeModelOptions(settingsWith({}));
    expect(options.some((option) => option.value === DEFAULT_VIBE_PRIMARY_MODEL)).toBe(true);
  });

  it('merges custom models without duplicating the default', () => {
    const options = getVibeModelOptions(
      settingsWith({ customModels: `devstral-small\n${DEFAULT_VIBE_PRIMARY_MODEL}\nvibe-air` }),
    );
    const values = options.map((option) => option.value);
    expect(values).toContain('devstral-small');
    expect(values).toContain('vibe-air');
    // The default appears exactly once even though customModels repeats it.
    expect(values.filter((value) => value === DEFAULT_VIBE_PRIMARY_MODEL)).toHaveLength(1);
  });

  it('includes configured models from config.toml', () => {
    writeVibeConfig('[models."vibe-custom"]\ndisplay_name = "Custom"\nmax_context_size = 131072\n');

    const configured = getVibeModelOptions(settingsWith({})).find((option) => option.value === 'vibe-custom');
    expect(configured?.label).toBe('Vibe · Custom');
    expect(configured?.description).toBe('Configured');

    removeVibeConfig();
  });

  it('surfaces an env VIBE_MODEL as a custom option at the front', () => {
    const options = getVibeModelOptions(
      settingsWith({ environmentVariables: 'VIBE_MODEL=vibe-custom-env' }),
    );
    expect(options[0]?.value).toBe('vibe-custom-env');
    expect(options[0]?.description).toBe('Custom (env)');
  });
});

describe('getConfiguredEnvCustomModel', () => {
  it('returns the env model when it is not a built-in default', () => {
    expect(
      getConfiguredEnvCustomModel(settingsWith({ environmentVariables: 'VIBE_MODEL=vibe-air' })),
    ).toBe('vibe-air');
  });

  it('returns null when no env model is configured', () => {
    expect(getConfiguredEnvCustomModel(settingsWith({}))).toBeNull();
  });

  it('returns null when the env model is the built-in default', () => {
    expect(
      getConfiguredEnvCustomModel(
        settingsWith({ environmentVariables: `VIBE_MODEL=${DEFAULT_VIBE_PRIMARY_MODEL}` }),
      ),
    ).toBeNull();
  });
});

describe('resolveVibeModelSelection', () => {
  it('keeps a still-valid current selection', () => {
    const settings = settingsWith({ customModels: 'devstral-small' });
    expect(resolveVibeModelSelection(settings, 'devstral-small')).toBe('devstral-small');
  });

  it('falls back to the first option (default) for an unknown current model', () => {
    const settings = settingsWith({});
    expect(resolveVibeModelSelection(settings, 'nonexistent-model')).toBe(DEFAULT_VIBE_PRIMARY_MODEL);
  });

  it('lets an env VIBE_MODEL override the current selection', () => {
    const settings = settingsWith({ environmentVariables: 'VIBE_MODEL=vibe-env-win' });
    expect(resolveVibeModelSelection(settings, 'devstral-small')).toBe('vibe-env-win');
  });
});

describe('getVibeModelContextWindow', () => {
  it('falls back to the default context window for unknown models', () => {
    expect(getVibeModelContextWindow('some-custom-model')).toBe(DEFAULT_VIBE_CONTEXT_WINDOW);
  });

  it('prefers the configured max_context_size over the default value', () => {
    writeVibeConfig('[models."devstral-small"]\ndisplay_name = "Small"\nmax_context_size = 512000\n');

    expect(getVibeModelContextWindow('devstral-small')).toBe(512000);

    removeVibeConfig();
  });
});
