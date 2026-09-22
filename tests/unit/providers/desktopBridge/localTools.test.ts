import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { executeLocalProposal, parseLocalProposal } from '../../../../src/providers/desktopBridge/localTools';

describe('desktop local tools', () => {
  let root: string;
  beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-tools-'))); fs.writeFileSync(path.join(root, 'note.txt'), 'fixture'); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  it.each(['deny', 'allow-always'])('does not write on %s', async decision => {
    await expect(executeLocalProposal({ local_tool: 'write', nonce: 'n', path: 'note.txt', content: 'changed' }, root, jest.fn().mockResolvedValue(decision), new AbortController().signal, () => true)).rejects.toThrow();
    expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8')).toBe('fixture');
  });
  it('writes exact approved content and executes only bounded allowlisted commands', async () => {
    const allow = jest.fn().mockResolvedValue('allow');
    await executeLocalProposal({ local_tool: 'write', nonce: 'n', path: 'note.txt', content: 'new\n' }, root, allow, new AbortController().signal, () => true);
    expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8')).toBe('new\n');
    expect(await executeLocalProposal({ local_tool: 'exec', nonce: 'n', path: 'note.txt', command: 'wc' }, root, allow, new AbortController().signal, () => true)).toMatch(/1/);
  });
  it.each(['../outside', '.env', '.ssh/id_rsa', '.npmrc', '.netrc', '.azure/token.json'])('rejects forbidden paths before approval: %s', async file => {
    if (file.startsWith('.') && !file.startsWith('..')) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'synthetic-sensitive-fixture'); }
    const allow = jest.fn().mockResolvedValue('allow');
    await expect(executeLocalProposal({ local_tool: 'read', nonce: 'n', path: file }, root, allow, new AbortController().signal, () => true)).rejects.toThrow();
    expect(allow).not.toHaveBeenCalled();
  });
  it('rejects symlinks and changes during approval', async () => {
    fs.symlinkSync(path.join(root, 'note.txt'), path.join(root, 'link'));
    await expect(executeLocalProposal({ local_tool: 'read', nonce: 'n', path: 'link' }, root, jest.fn(), new AbortController().signal, () => true)).rejects.toThrow();
    const change = jest.fn(async () => { fs.writeFileSync(path.join(root, 'note.txt'), 'other'); return 'allow' as const; });
    await expect(executeLocalProposal({ local_tool: 'write', nonce: 'n', path: 'note.txt', content: 'no' }, root, change, new AbortController().signal, () => true)).rejects.toThrow(/geändert/);
    expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8')).toBe('other');
  });
  it('cancels after approval without writing', async () => {
    const controller = new AbortController();
    const cancel = jest.fn(async () => { controller.abort(); return 'allow' as const; });
    await expect(executeLocalProposal({ local_tool: 'write', nonce: 'n', path: 'note.txt', content: 'no' }, root, cancel, controller.signal, () => true)).rejects.toThrow(/Abgebrochen/);
    expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8')).toBe('fixture');
  });
  it('executes an immutable snapshot even when the caller mutates during approval', async () => {
    const proposal = { local_tool: 'write' as const, nonce: 'n', path: 'note.txt', content: 'approved' };
    const approval = jest.fn(async () => { proposal.content = 'not approved'; return 'allow' as const; });
    await executeLocalProposal(proposal, root, approval, new AbortController().signal, () => true);
    expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8')).toBe('approved');
  });
  it('rejects a replaced root while approval for a new file is pending', async () => {
    const moved = root + '-moved';
    try {
      const approval = jest.fn(async () => { fs.renameSync(root, moved); fs.mkdirSync(root); return 'allow' as const; });
      await expect(executeLocalProposal({ local_tool: 'write', nonce: 'n', path: 'new.txt', content: 'no' }, root, approval, new AbortController().signal, () => true)).rejects.toThrow(/geändert/);
      expect(fs.existsSync(path.join(root, 'new.txt'))).toBe(false);
    } finally { fs.rmSync(moved, { recursive: true, force: true }); }
  });
  it('bounds the serialized result including JSON escaping', async () => {
    fs.writeFileSync(path.join(root, 'note.txt'), '\u0001'.repeat(900));
    const result = await executeLocalProposal({ local_tool: 'read', nonce: 'n', path: 'note.txt' }, root, jest.fn().mockResolvedValue('allow'), new AbortController().signal, () => true);
    expect(result.length).toBeLessThanOrEqual(1100);
    const page = JSON.parse(result);
    expect(page.nextOffset).toBe(page.data.length);
    expect(page.total).toBe(900);
    expect(page.truncated).toBe(true);
    const next = JSON.parse(await executeLocalProposal({ local_tool: 'read', nonce: 'n', path: 'note.txt', offset: page.nextOffset }, root, jest.fn().mockResolvedValue('allow'), new AbortController().signal, () => true));
    expect(next.offset).toBe(page.nextOffset);
    expect(next.nextOffset).toBe(next.offset + next.data.length);
    expect(next.data).toBe('\u0001'.repeat(next.data.length));
    expect(JSON.stringify(next).length).toBeLessThanOrEqual(1100);
  });
  it('settles cancellation while approval is pending and ignores late approval', async () => {
    const controller = new AbortController();
    let allow!: (value: 'allow') => void;
    const approval = jest.fn(() => new Promise<'allow'>(resolve => { allow = resolve; }));
    const pending = executeLocalProposal({ local_tool: 'write', nonce: 'n', path: 'note.txt', content: 'no' }, root, approval, controller.signal, () => true);
    controller.abort();
    const result = await Promise.race([pending.catch(() => 'cancelled'), new Promise<string>(resolve => setTimeout(() => resolve('hung'), 30))]);
    allow('allow');
    await pending.catch(() => undefined);
    expect(result).toBe('cancelled');
    expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8')).toBe('fixture');
  });
  it.each(['.hermes/auth.json', '.codex/auth.json', '.hidden/passwords.txt'])('blocks hidden credential trees: %s', async file => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'synthetic');
    const allow = jest.fn().mockResolvedValue('allow');
    await expect(executeLocalProposal({ local_tool: 'read', nonce: 'n', path: file }, root, allow, new AbortController().signal, () => true)).rejects.toThrow();
    expect(allow).not.toHaveBeenCalled();
    const listing = await executeLocalProposal({ local_tool: 'list', nonce: 'n', path: '.' }, root, allow, new AbortController().signal, () => true);
    expect(JSON.parse(listing).data).toBe('note.txt');
  });
  it('rejects a credential tree selected as the root', async () => {
    const hiddenRoot = path.join(root, '.codex');
    fs.mkdirSync(hiddenRoot);
    fs.writeFileSync(path.join(hiddenRoot, 'auth.json'), 'synthetic');
    await expect(executeLocalProposal({ local_tool: 'read', nonce: 'n', path: 'auth.json' }, hiddenRoot, jest.fn().mockResolvedValue('allow'), new AbortController().signal, () => true)).rejects.toThrow();
  });
  it('rejects invalid UTF-8 instead of disclosing replacement characters', async () => {
    fs.writeFileSync(path.join(root, 'note.txt'), Buffer.from([0xff, 0xfe, 0x61]));
    await expect(executeLocalProposal({ local_tool: 'read', nonce: 'n', path: 'note.txt' }, root, jest.fn().mockResolvedValue('allow'), new AbortController().signal, () => true)).rejects.toThrow(/Binär/);
  });
  it('checks the opened write descriptor before truncating a swapped file', async () => {
    const originalOpen = fs.openSync;
    const target = path.join(root, 'note.txt');
    const spy = jest.spyOn(jest.requireActual<typeof fs>('fs'), 'openSync').mockImplementationOnce((file, flags, mode) => {
      fs.renameSync(target, path.join(root, 'original.txt'));
      fs.writeFileSync(target, 'replacement');
      return originalOpen(file, flags, mode);
    });
    try {
      await expect(executeLocalProposal({ local_tool: 'write', nonce: 'n', path: 'note.txt', content: 'no' }, root, jest.fn().mockResolvedValue('allow'), new AbortController().signal, () => true)).rejects.toThrow();
      expect(fs.readFileSync(target, 'utf8')).toBe('replacement');
    } finally { spy.mockRestore(); }
  });
  it('pins reads to the checked descriptor rather than reopening a swapped path', async () => {
    const target = path.join(root, 'note.txt');
    fs.writeFileSync(path.join(root, 'other.txt'), 'unapproved');
    const originalRead = fs.readSync;
    const spy = jest.spyOn(jest.requireActual<typeof fs>('fs'), 'readSync').mockImplementationOnce((...args: Parameters<typeof fs.readSync>) => {
      fs.renameSync(target, path.join(root, 'original.txt'));
      fs.symlinkSync(path.join(root, 'other.txt'), target);
      return originalRead(...args);
    });
    try {
      const result = await executeLocalProposal({ local_tool: 'read', nonce: 'n', path: 'note.txt' }, root, jest.fn().mockResolvedValue('allow'), new AbortController().signal, () => true);
      expect(JSON.parse(result).data).toBe('fixture');
      expect(spy).toHaveBeenCalled();
      expect(typeof spy.mock.calls[0][0]).toBe('number');
    } finally { spy.mockRestore(); }
  });
  it('requires exact nonce and schema', () => {
    expect(() => parseLocalProposal('{"local_tool":"read","nonce":"old","path":"note.txt"}', 'fresh')).toThrow();
    expect(parseLocalProposal('ordinary answer', 'fresh')).toBeNull();
  });
  it('reads only after explicit per-action approval with disclosure', async () => {
    const approval = jest.fn().mockResolvedValue('allow');
    const result = await executeLocalProposal({ local_tool: 'read', nonce: 'n', path: 'note.txt' }, root, approval, new AbortController().signal, () => true);
    expect(result).toContain('fixture');
    expect(approval.mock.calls[0][2]).toMatch(/App/);
  });
});
