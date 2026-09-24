import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { findVibeSessionLogDir, readVibeContextTokens } from '@/providers/vibe/history/VibeSessionStore';

// Layout of vibe 2.25.8 (vibe/core/session/session_interop.py): one directory per
// session under `[session_logging] save_dir` (default VIBE_HOME/logs/session),
// named `session_<date>_<time>_<first 8 id chars>`, with meta.json + messages.jsonl.
describe('VibeSessionStore (vibe 2.25.8 session logs)', () => {
  const originalHome = process.env.VIBE_HOME;
  let home: string;

  function writeSession(root: string, dirName: string, sessionId: string, contextTokens: number): string {
    const dir = path.join(root, dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      session_id: sessionId,
      stats: { context_tokens: contextTokens, session_prompt_tokens: 999_999 },
    }));
    fs.writeFileSync(path.join(dir, 'messages.jsonl'), '');
    return dir;
  }

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-vibe-home-'));
    process.env.VIBE_HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.VIBE_HOME;
    else process.env.VIBE_HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('finds the session directory by its short id under logs/session', () => {
    const root = path.join(home, 'logs', 'session');
    const dir = writeSession(root, 'session_20260924_145223_7d9fe80c', '7d9fe80c-6e47-829c-68c2-2a48ddd7ca53', 0);

    expect(findVibeSessionLogDir('7d9fe80c-6e47-829c-68c2-2a48ddd7ca53')).toBe(dir);
    expect(findVibeSessionLogDir('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('tells two sessions with the same short id apart by meta.json', () => {
    const root = path.join(home, 'logs', 'session');
    writeSession(root, 'session_20260901_100000_7d9fe80c', '7d9fe80c-aaaa-0000-0000-000000000000', 1);
    const mine = writeSession(root, 'session_20260902_100000_7d9fe80c', '7d9fe80c-bbbb-0000-0000-000000000000', 2);

    expect(findVibeSessionLogDir('7d9fe80c-bbbb-0000-0000-000000000000')).toBe(mine);
  });

  it('honours [session_logging] save_dir from config.toml', () => {
    const custom = path.join(home, 'custom-logs');
    fs.writeFileSync(path.join(home, 'config.toml'), `[session_logging]\nsave_dir = "${custom}"\n`);
    const dir = writeSession(custom, 'session_20260924_120000_abcdef12', 'abcdef12-0000-0000-0000-000000000000', 5);

    expect(findVibeSessionLogDir('abcdef12-0000-0000-0000-000000000000')).toBe(dir);
  });

  it('reads the window fill vibe keeps in stats.context_tokens', () => {
    const root = path.join(home, 'logs', 'session');
    writeSession(root, 'session_20260924_120000_abcdef12', 'abcdef12-0000-0000-0000-000000000000', 48_200);

    expect(readVibeContextTokens('abcdef12-0000-0000-0000-000000000000')).toBe(48_200);
    expect(readVibeContextTokens('ffffffff-0000-0000-0000-000000000000')).toBeNull();
  });
});
