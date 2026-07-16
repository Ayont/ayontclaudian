import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGrokConfigPath } from '@/providers/grok/history/GrokSessionStore';
import {
  getConfiguredEnvCustomModel,
  getGrokModelContextWindow,
  getGrokModelOptions,
  parseConfiguredCustomModelIds,
  readGrokConfiguredModels,
  resolveGrokModelSelection,
} from '@/providers/grok/modelOptions';
import { GROK_PROVIDER_ID } from '@/providers/grok/settings';
import {
  DEFAULT_GROK_CONTEXT_WINDOW,
  DEFAULT_GROK_PRIMARY_MODEL,
} from '@/providers/grok/types/models';

// `import * as fs` yields a getter-bound module namespace under ts-jest that
// jest.spyOn cannot redefine; spy on the underlying builtin exports object
// (the same singleton the code under test resolves).
const realFs = jest.requireActual<typeof fs>('node:fs');

// Point GROK_HOME at an empty temp dir so `~/.grok/config.toml` is absent and
// the tests are deterministic regardless of the developer's real config.
const ISOLATED_GROK_HOME = path.join(os.tmpdir(), 'grok-modeloptions-test-home-does-not-exist');
let originalGrokHome: string | undefined;

beforeAll(() => {
  originalGrokHome = process.env.GROK_HOME;
  process.env.GROK_HOME = ISOLATED_GROK_HOME;
});

afterAll(() => {
  if (originalGrokHome === undefined) {
    delete process.env.GROK_HOME;
  } else {
    process.env.GROK_HOME = originalGrokHome;
  }
});

function settingsWith(config: Record<string, unknown>): Record<string, unknown> {
  return { providerConfigs: { [GROK_PROVIDER_ID]: config } };
}

function writeGrokConfig(contents: string): void {
  fs.mkdirSync(path.dirname(getGrokConfigPath()), { recursive: true });
  fs.writeFileSync(getGrokConfigPath(), contents, 'utf-8');
}

function removeGrokConfig(): void {
  try {
    fs.unlinkSync(getGrokConfigPath());
  } catch {
    // best-effort cleanup
  }
}

describe('parseConfiguredCustomModelIds', () => {
  it('splits and trims lines, dropping blanks and duplicates', () => {
    const ids = parseConfiguredCustomModelIds('grok-build\n  grok-build \n\ngrok-air\n');
    expect(ids).toEqual(['grok-build', 'grok-air']);
  });

  it('returns an empty array for empty input', () => {
    expect(parseConfiguredCustomModelIds('')).toEqual([]);
    expect(parseConfiguredCustomModelIds('   \n  ')).toEqual([]);
  });
});

describe('readGrokConfiguredModels caching', () => {
  it('serves repeated calls from the cache without re-reading the file', () => {
    writeGrokConfig('[models."grok-cache-a"]\nmax_context_size = 128000\n');

    const spy = jest.spyOn(realFs, 'readFileSync');
    try {
      const first = readGrokConfiguredModels();
      expect(spy).toHaveBeenCalledTimes(1); // cold read parses the file once

      spy.mockClear();
      const second = readGrokConfiguredModels();
      const options = getGrokModelOptions(settingsWith({}));

      expect(second).toEqual(first);
      expect(options.some((option) => option.value === 'grok-cache-a')).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      removeGrokConfig();
    }
  });

  it('parses the config at most once per resolveModelSelection call chain', () => {
    writeGrokConfig('default_model = "grok-cache-b"\n[models."grok-cache-b"]\nmax_context_size = 64000\n');

    const spy = jest.spyOn(realFs, 'readFileSync');
    try {
      expect(resolveGrokModelSelection(settingsWith({}), 'unknown-model')).toBe('grok-cache-b');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      removeGrokConfig();
    }
  });

  it('picks up a modified config on the next read', () => {
    writeGrokConfig('[models."grok-cache-old"]\nmax_context_size = 128000\n');
    expect(readGrokConfiguredModels().models.map((model) => model.id)).toContain('grok-cache-old');

    // Different content length keeps the stat signature distinct even when the
    // filesystem mtime resolution would make the two writes collide.
    writeGrokConfig('[models."grok-cache-newer-model"]\nmax_context_size = 64000\n');
    const { models } = readGrokConfiguredModels();
    expect(models.map((model) => model.id)).toContain('grok-cache-newer-model');
    expect(models.map((model) => model.id)).not.toContain('grok-cache-old');

    removeGrokConfig();
  });

  it('returns an empty list for a missing config and caches that too', () => {
    removeGrokConfig();

    const spy = jest.spyOn(realFs, 'readFileSync');
    try {
      expect(readGrokConfiguredModels()).toEqual({ models: [], defaultModel: null });
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockClear();
      expect(readGrokConfiguredModels()).toEqual({ models: [], defaultModel: null });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('getGrokModelOptions', () => {
  it('always includes the built-in default model', () => {
    const options = getGrokModelOptions(settingsWith({}));
    expect(options.some((option) => option.value === DEFAULT_GROK_PRIMARY_MODEL)).toBe(true);
  });

  it('merges custom models without duplicating the default', () => {
    const options = getGrokModelOptions(
      settingsWith({ customModels: `grok-build\n${DEFAULT_GROK_PRIMARY_MODEL}\ngrok-air` }),
    );
    const values = options.map((option) => option.value);
    expect(values).toContain('grok-build');
    expect(values).toContain('grok-air');
    // The default appears exactly once even though customModels repeats it.
    expect(values.filter((value) => value === DEFAULT_GROK_PRIMARY_MODEL)).toHaveLength(1);
  });

  it('includes configured models from config.toml', () => {
    writeGrokConfig('[models."grok-custom"]\ndisplay_name = "Custom"\nmax_context_size = 131072\n');

    const configured = getGrokModelOptions(settingsWith({})).find((option) => option.value === 'grok-custom');
    expect(configured?.label).toBe('Grok · Custom');
    expect(configured?.description).toBe('Configured');

    removeGrokConfig();
  });

  it('surfaces an env GROK_MODEL as a custom option at the front', () => {
    const options = getGrokModelOptions(
      settingsWith({ environmentVariables: 'GROK_MODEL=grok-custom-env' }),
    );
    expect(options[0]?.value).toBe('grok-custom-env');
    expect(options[0]?.description).toBe('Custom (env)');
  });
});

describe('getConfiguredEnvCustomModel', () => {
  it('returns the env model when it is not a built-in default', () => {
    expect(
      getConfiguredEnvCustomModel(settingsWith({ environmentVariables: 'GROK_MODEL=grok-air' })),
    ).toBe('grok-air');
  });

  it('returns null when no env model is configured', () => {
    expect(getConfiguredEnvCustomModel(settingsWith({}))).toBeNull();
  });

  it('returns null when the env model is the built-in default', () => {
    expect(
      getConfiguredEnvCustomModel(
        settingsWith({ environmentVariables: `GROK_MODEL=${DEFAULT_GROK_PRIMARY_MODEL}` }),
      ),
    ).toBeNull();
  });
});

describe('resolveGrokModelSelection', () => {
  it('keeps a still-valid current selection', () => {
    const settings = settingsWith({ customModels: 'grok-build' });
    expect(resolveGrokModelSelection(settings, 'grok-build')).toBe('grok-build');
  });

  it('falls back to the first option (default) for an unknown current model', () => {
    const settings = settingsWith({});
    expect(resolveGrokModelSelection(settings, 'nonexistent-model')).toBe(DEFAULT_GROK_PRIMARY_MODEL);
  });

  it('lets an env GROK_MODEL override the current selection', () => {
    const settings = settingsWith({ environmentVariables: 'GROK_MODEL=grok-env-win' });
    expect(resolveGrokModelSelection(settings, 'grok-build')).toBe('grok-env-win');
  });
});

describe('getGrokModelContextWindow', () => {
  it('falls back to the default context window for unknown models', () => {
    expect(getGrokModelContextWindow('some-custom-model')).toBe(DEFAULT_GROK_CONTEXT_WINDOW);
  });

  it('prefers the configured max_context_size over the default value', () => {
    writeGrokConfig('[models."grok-build"]\ndisplay_name = "Build"\nmax_context_size = 512000\n');

    expect(getGrokModelContextWindow('grok-build')).toBe(512000);

    removeGrokConfig();
  });
});
