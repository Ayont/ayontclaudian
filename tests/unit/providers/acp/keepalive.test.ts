import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  ACP_KEEPALIVE_INTERVAL_MS,
  ACP_KEEPALIVE_MAX_SILENCE_MS,
} from '@/providers/acp/keepalive';
import {
  HERMES_KEEPALIVE_INTERVAL_MS,
  HERMES_KEEPALIVE_MAX_SILENCE_MS,
} from '@/providers/hermes/runtime/keepalive';

/** Must stay below the chat watchdog's 120s silence timeout. */
const WATCHDOG_TIMEOUT_MS = 120_000;

describe('ACP keepalive tuning', () => {
  it('beats well inside the watchdog window, with room for a missed beat', () => {
    expect(ACP_KEEPALIVE_INTERVAL_MS).toBeLessThan(WATCHDOG_TIMEOUT_MS / 2);
  });

  it('caps heartbeats so a genuinely dead turn still trips the watchdog', () => {
    expect(ACP_KEEPALIVE_MAX_SILENCE_MS).toBeGreaterThan(ACP_KEEPALIVE_INTERVAL_MS);
    expect(Number.isFinite(ACP_KEEPALIVE_MAX_SILENCE_MS)).toBe(true);
  });

  it('is the single source of truth — Hermes re-exports it rather than duplicating', () => {
    expect(HERMES_KEEPALIVE_INTERVAL_MS).toBe(ACP_KEEPALIVE_INTERVAL_MS);
    expect(HERMES_KEEPALIVE_MAX_SILENCE_MS).toBe(ACP_KEEPALIVE_MAX_SILENCE_MS);
  });
});

describe('ACP runtimes emit keepalives', () => {
  const RUNTIMES = [
    ['omp', 'src/providers/omp/runtime/OmpChatRuntime.ts'],
    ['opencode', 'src/providers/opencode/runtime/OpencodeChatRuntime.ts'],
    ['hermes', 'src/providers/hermes/runtime/HermesChatRuntime.ts'],
  ] as const;

  it.each(RUNTIMES)('%s pushes keepalive chunks during a turn', (_name, relativePath) => {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');

    expect(source).toContain("{ type: 'keepalive' }");
    // A heartbeat that is never cleared would outlive the turn.
    expect(source).toContain('window.clearInterval(keepaliveTimer)');
    // And one that ignores wire activity would keep a dead turn alive forever.
    expect(source).toMatch(/KEEPALIVE_MAX_SILENCE_MS/);
  });
});
