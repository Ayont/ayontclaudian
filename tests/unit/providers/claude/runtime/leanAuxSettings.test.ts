import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { leanAuxOptions } from '@/providers/claude/runtime/leanAuxSettings';

describe('leanAuxOptions', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-aux-'));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('loads no settings, servers or skills, so a title costs a few hundred tokens instead of a hundred thousand', () => {
    const options = leanAuxOptions(dir);
    expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.mcpServers).toEqual({});
    expect(options.extraArgs).toEqual({ 'disable-slash-commands': null });
  });

  test('keeps the env a user routes Claude through (a proxy, another backend)', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://proxy.example', ANTHROPIC_AUTH_TOKEN: 't', API_TIMEOUT_MS: 5 }, hooks: { SessionStart: [] } }));
    expect(leanAuxOptions(dir).env).toEqual({ ANTHROPIC_BASE_URL: 'https://proxy.example', ANTHROPIC_AUTH_TOKEN: 't', API_TIMEOUT_MS: '5' });
  });

  test('falls back to the user settings without hooks when an apiKeyHelper signs the requests', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ apiKeyHelper: '~/bin/key.sh' }));
    const options = leanAuxOptions(dir);
    expect(options.settingSources).toEqual(['user']);
    expect(options.extraArgs).toEqual({ 'disable-slash-commands': null, settings: JSON.stringify({ disableAllHooks: true }) });
  });

  test('an unreadable settings file costs nothing but the proxy env', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ nope');
    expect(leanAuxOptions(dir)).toMatchObject({ settingSources: [], env: {} });
  });
});
