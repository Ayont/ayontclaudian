import * as fs from 'fs';
import type { App } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import { parseMemoryNote } from '../../../../../src/core/memory/memoryService';
import { createDesktopKnowledgeVaultAdapters } from '../../../../../src/features/chat/services/desktopKnowledgeVault';

describe('desktop knowledge real filesystem binding', () => {
  let base: string;
  let allowed: boolean;
  let app: App;
  const signal = () => new AbortController().signal;
  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-')));
    fs.mkdirSync(path.join(base, 'notes'));
    fs.mkdirSync(path.join(base, '.claudian/memory'), { recursive: true });
    fs.writeFileSync(path.join(base, 'notes/a.md'), 'alpha');
    fs.writeFileSync(path.join(base, 'notes/b.md'), 'beta');
    allowed = true;
    app = { vault: { adapter: { getBasePath: () => base }, getMarkdownFiles: () => [{ path: 'notes/a.md' }, { path: 'notes/b.md' }] }, metadataCache: { resolvedLinks: { 'notes/b.md': { 'notes/a.md': 1, 'elsewhere/c.md': 1 } } } } as unknown as App;
  });
  afterEach(() => { jest.restoreAllMocks(); fs.rmSync(base, { recursive: true, force: true }); });
  const bind = () => createDesktopKnowledgeVaultAdapters({ app, vaultBase: base, scope: 'notes', memoryFolder: '.claudian/memory', signal: signal(), allowed: () => allowed });
  it('reads exact raw indexed notes and preserves scoped backlink orientation', async () => {
    const binding = bind();
    expect(await binding.readNote('notes/a.md', 'notes', 100, signal())).toBe('alpha');
    expect(await binding.graph('notes', 5, signal())).toEqual([['notes/b.md', 'notes/a.md']]);
    await expect(binding.graph('notes', 0, signal())).rejects.toThrow();
  });
  it('uses the existing pure parser and keeps raw memory frontmatter intact', async () => {
    const raw = '---\ntopic: Birds\ntags: #nature, blue\n---\n\n  blue bird\n';
    const file = '.claudian/memory/birds.md';
    fs.writeFileSync(path.join(base, file), raw);
    const binding = bind();
    expect(await binding.memories('.claudian/memory', 3, signal())).toEqual([parseMemoryNote({ path: file, basename: 'birds', stat: { mtime: fs.statSync(path.join(base, file)).mtimeMs } }, raw)]);
    expect(await binding.readNote(file, '.claudian/memory', 100, signal())).toBe(raw);
  });
  it('enforces count and byte caps before any content read', async () => {
    fs.writeFileSync(path.join(base, '.claudian/memory/a.md'), 'a');
    fs.writeFileSync(path.join(base, '.claudian/memory/b.md'), 'b');
    const binding = bind();
    const read = jest.spyOn(jest.requireActual<typeof fs>('fs'), 'readSync');
    await expect(binding.memories('.claudian/memory', 1, signal())).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    fs.writeFileSync(path.join(base, 'notes/a.md'), 'x'.repeat(65537));
    await expect(binding.readNote('notes/a.md', 'notes', 65536, signal())).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it.each(['notes/../a.md', 'notes/.secret.md', 'notes/secret.md', 'notes/a\\b.md', 'notes/%61.md', 'notes/a\u0000.md'])('rejects forbidden path %s without reads', async file => {
    const binding = bind();
    const read = jest.spyOn(jest.requireActual<typeof fs>('fs'), 'readSync');
    await expect(binding.readNote(file, 'notes', 100, signal())).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it.each(['symlink', 'hardlink'])('rejects %s notes', async kind => {
    fs.unlinkSync(path.join(base, 'notes/a.md'));
    if (kind === 'symlink') fs.symlinkSync(path.join(base, 'notes/b.md'), path.join(base, 'notes/a.md'));
    else fs.linkSync(path.join(base, 'notes/b.md'), path.join(base, 'notes/a.md'));
    await expect(bind().readNote('notes/a.md', 'notes', 100, signal())).rejects.toThrow();
  });
  it('rejects revoked, aborted and changed actual vault bindings', async () => {
    const binding = bind();
    allowed = false;
    await expect(binding.graph('notes', 5, signal())).rejects.toThrow();
    allowed = true;
    const controller = new AbortController(); controller.abort();
    await expect(binding.readNote('notes/a.md', 'notes', 10, controller.signal)).rejects.toThrow();
    (app.vault.adapter as unknown as { getBasePath(): string }).getBasePath = () => base + '/notes';
    await expect(binding.graph('notes', 5, signal())).rejects.toThrow();
  });
  it('rejects root replacement between binding and invocation', async () => {
    const binding = bind();
    fs.renameSync(path.join(base, 'notes'), path.join(base, 'previous'));
    fs.mkdirSync(path.join(base, 'notes'));
    fs.writeFileSync(path.join(base, 'notes/a.md'), 'replacement');
    const read = jest.spyOn(jest.requireActual<typeof fs>('fs'), 'readSync');
    await expect(binding.readNote('notes/a.md', 'notes', 100, signal())).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects file replacement at open before descriptor bytes are read', async () => {
    const binding = bind();
    fs.writeFileSync(path.join(base, 'notes/replacement.md'), 'replacement');
    const original = fs.openSync;
    jest.spyOn(jest.requireActual<typeof fs>('fs'), 'openSync').mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
      fs.renameSync(path.join(base, 'notes/a.md'), path.join(base, 'notes/old.md'));
      fs.renameSync(path.join(base, 'notes/replacement.md'), path.join(base, 'notes/a.md'));
      return original(...args);
    }) as typeof fs.openSync);
    const read = jest.spyOn(jest.requireActual<typeof fs>('fs'), 'readSync');
    await expect(binding.readNote('notes/a.md', 'notes', 100, signal())).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects unapproved memory roots and symlink roots', async () => {
    const binding = bind();
    await expect(binding.memories('.claudian/other', 5, signal())).rejects.toThrow();
    fs.renameSync(path.join(base, 'notes'), path.join(base, 'previous'));
    fs.symlinkSync(path.join(base, 'previous'), path.join(base, 'notes'));
    expect(bind).toThrow();
  });
  it('rejects invalid UTF8 rather than silently replacing bytes', async () => {
    fs.writeFileSync(path.join(base, 'notes/a.md'), Buffer.from([0xc3, 0x28]));
    await expect(bind().readNote('notes/a.md', 'notes', 100, signal())).rejects.toThrow();
  });
  it('rejects revocation during descriptor read and closes the handle', async () => {
    const binding = bind();
    const original = fs.readSync;
    jest.spyOn(jest.requireActual<typeof fs>('fs'), 'readSync').mockImplementation(((...args: Parameters<typeof fs.readSync>) => { const result = original(...args); allowed = false; return result; }) as typeof fs.readSync);
    const close = jest.spyOn(jest.requireActual<typeof fs>('fs'), 'closeSync');
    await expect(binding.readNote('notes/a.md', 'notes', 100, signal())).rejects.toThrow();
    expect(close).toHaveBeenCalled();
  });
});
