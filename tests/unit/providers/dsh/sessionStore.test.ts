import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { deleteDshSessionDir, findNewestDshSessionDir } from '@/providers/dsh/runtime/DshSessionStore';

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
}

function makeSession(home: string, slug: string, name: string, mtimeMs: number): string {
  const dir = path.join(home, 'sessions', slug, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), 'x');
  fs.utimesSync(dir, new Date(mtimeMs), new Date(mtimeMs));
  return dir;
}

describe('findNewestDshSessionDir', () => {
  it('finds the newest session across workdir slugs after the cutoff', () => {
    const home = makeHome();
    makeSession(home, '--tmp-old--', 'session-aaa', 1_000);
    const newer = makeSession(home, '--tmp-new--', 'session-bbb', 5_000);

    expect(findNewestDshSessionDir(home, 2_000)).toEqual({ sessionId: 'session-bbb', dir: newer });
  });

  it('ignores sessions at or before the cutoff', () => {
    const home = makeHome();
    makeSession(home, '--tmp--', 'session-old', 1_000);
    expect(findNewestDshSessionDir(home, 5_000)).toBeNull();
  });

  it('tolerates a missing sessions root and stray files', () => {
    const home = makeHome();
    expect(findNewestDshSessionDir(home, 0)).toBeNull();

    fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(home, 'sessions', 'loose'), 'x');
    expect(findNewestDshSessionDir(home, 0)).toBeNull();
  });
});

describe('deleteDshSessionDir', () => {
  it('removes the session directory and tolerates a missing one', () => {
    const home = makeHome();
    const dir = makeSession(home, '--tmp--', 'session-gone', 1_000);
    deleteDshSessionDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(() => deleteDshSessionDir(dir)).not.toThrow();
  });
});
