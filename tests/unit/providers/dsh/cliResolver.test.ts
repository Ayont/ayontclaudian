import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  DSH_CLI_BINARY,
  DshCliResolver,
  findNpxCachedDshBinary,
} from '@/providers/dsh/runtime/DshCliResolver';

/**
 * The npx cache is where 'npx @deepseek-ai/dsh' materializes the binary. The
 * resolver falls back to it when PATH discovery fails: Obsidian GUI apps get a
 * minimal PATH, and many users only ever run dsh through npx.
 */
function makeFakeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-npx-'));
}

function writeNpxEntry(home: string, hash: string, mtimeMs: number): string {
  const binDir = path.join(home, '.npm', '_npx', hash, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const bin = path.join(binDir, DSH_CLI_BINARY);
  fs.writeFileSync(bin, '#!/usr/bin/env node\n');
  fs.utimesSync(bin, new Date(mtimeMs), new Date(mtimeMs));
  return bin;
}

describe('findNpxCachedDshBinary', () => {
  it('returns the newest npx-cached dsh across cache-hash dirs', () => {
    const home = makeFakeHome();
    writeNpxEntry(home, 'aaa-old', 1_000);
    const newer = writeNpxEntry(home, 'bbb-new', 5_000);

    expect(findNpxCachedDshBinary(home)).toBe(newer);
  });

  it('returns null without an npx cache or without dsh in it', () => {
    expect(findNpxCachedDshBinary(makeFakeHome())).toBeNull();

    const empty = makeFakeHome();
    fs.mkdirSync(path.join(empty, '.npm', '_npx'), { recursive: true });
    expect(findNpxCachedDshBinary(empty)).toBeNull();
  });

  it('ignores broken symlinks in .bin directories', () => {
    const home = makeFakeHome();
    const binDir = path.join(home, '.npm', '_npx', 'hash', 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.symlinkSync(path.join(home, 'does-not-exist.js'), path.join(binDir, DSH_CLI_BINARY));

    expect(findNpxCachedDshBinary(home)).toBeNull();
  });
});

describe('DshCliResolver', () => {
  it('returns a stable resolution across repeat calls (memoized)', () => {
    // Machine-independent by construction: whether THIS machine has dsh on a
    // discovered path decides the value, never the assertion.
    const resolver = new DshCliResolver(makeFakeHome());
    const settingsBag: Record<string, unknown> = {};
    const first = resolver.resolveFromSettings(settingsBag);
    expect(resolver.resolveFromSettings(settingsBag)).toBe(first);
    expect(resolver.isAvailable(settingsBag)).toBe(first !== null);
  });

  it('survives reset cycles without changing an unchanged environment', () => {
    const resolver = new DshCliResolver(makeFakeHome());
    const settingsBag: Record<string, unknown> = {};
    const before = resolver.resolveFromSettings(settingsBag);
    resolver.reset();
    expect(resolver.resolveFromSettings(settingsBag)).toBe(before);
  });

  it('prefers the npx fallback over nothing (pure fallback layer)', () => {
    const home = makeFakeHome();
    const bin = writeNpxEntry(home, 'hash', 1_000);
    expect(findNpxCachedDshBinary(home)).toBe(bin);
  });
});
