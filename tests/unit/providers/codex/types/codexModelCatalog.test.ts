import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  parseCodexCatalogWindows,
  readCodexCatalogWindow,
  resetCodexCatalogCache,
} from '@/providers/codex/types/codexModelCatalog';
import { resolveCodexLargeWindow } from '@/providers/codex/types/models';

// Shape of ~/.codex/models_cache.json from codex-cli 0.156.1 (2026-09-24).
const CATALOG = {
  client_version: '0.156.1',
  models: [
    { slug: 'gpt-6-sol', context_window: 272000, max_context_window: 872000, effective_context_window_percent: 95, model_messages: 'x' },
    { slug: 'gpt-5.5', context_window: 272000, max_context_window: 272000, effective_context_window_percent: 95 },
    { slug: 'broken', context_window: 'n/a' },
  ],
};

describe('Codex model catalog', () => {
  afterEach(() => resetCodexCatalogCache());

  it('reads each model\'s server-declared windows', () => {
    const windows = parseCodexCatalogWindows(CATALOG);

    expect(windows.get('gpt-6-sol')).toEqual({ contextWindow: 272000, maxContextWindow: 872000, effectivePercent: 95 });
    expect(windows.has('broken')).toBe(false);
  });

  it('reads the cache file, and gives nothing when it is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
    try {
      fs.writeFileSync(path.join(dir, 'models_cache.json'), JSON.stringify(CATALOG));
      expect(readCodexCatalogWindow('gpt-6-sol', dir)?.maxContextWindow).toBe(872000);
      expect(readCodexCatalogWindow('gpt-6-sol', path.join(dir, 'missing'))).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveCodexLargeWindow', () => {
  it('asks for OpenAI\'s documented 1M and compacts at 90 % of what Codex will grant', () => {
    expect(resolveCodexLargeWindow('gpt-6-sol', { contextWindow: 272000, maxContextWindow: 872000, effectivePercent: 95 })).toEqual({
      requested: 1_000_000,
      granted: 872_000,
      usable: 828_400,
      autoCompactLimit: 784_800,
    });
  });

  it('follows a catalog that grants the full million', () => {
    expect(resolveCodexLargeWindow('gpt-6-sol', { contextWindow: 272000, maxContextWindow: 1_050_000, effectivePercent: 95 })).toEqual({
      requested: 1_000_000,
      granted: 1_000_000,
      usable: 950_000,
      autoCompactLimit: 900_000,
    });
  });

  it('has nothing larger for a model capped at its standard window', () => {
    expect(resolveCodexLargeWindow('gpt-5.5', { contextWindow: 272000, maxContextWindow: 272000, effectivePercent: 95 })).toBeNull();
  });

  it('falls back to the built-in maximum without a catalog', () => {
    expect(resolveCodexLargeWindow('gpt-6-sol', null)?.granted).toBe(872_000);
  });
});
