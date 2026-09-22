import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { executeVaultProposal, parseVaultProposal, vaultToolInstructions } from '../../../../src/providers/desktopBridge/vaultTools';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
describe('consented desktop vault tools', () => {
  let root: string;
  const signal = new AbortController().signal;
  const allow = jest.fn().mockResolvedValue('allow');
  beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vault-tools-'))); allow.mockClear(); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (proposal: object, approval = allow, enabled = () => true, inventory = ['note.md']) => executeVaultProposal(parseVaultProposal(JSON.stringify(proposal), 'n')!, root, inventory, approval, signal, enabled);
  it('edits a large note with exact hash and unique patch, preserving unrelated text', async () => {
    const text = 'unchanged\n'.repeat(2000) + 'old unique';
    fs.writeFileSync(path.join(root, 'note.md'), text);
    await run({ vault_tool: 'patch', nonce: 'n', path: 'note.md', baseHash: hash(text), oldText: 'old unique', newText: 'new unique' });
    expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe(text.replace('old unique', 'new unique'));
    expect(JSON.stringify(allow.mock.calls)).toContain('old unique');
    expect(fs.readdirSync(root)).toEqual(['note.md']);
  });
  it.each(['deny', 'allow-always'])('never edits on %s', async decision => {
    fs.writeFileSync(path.join(root, 'note.md'), 'old');
    await expect(run({ vault_tool: 'patch', nonce: 'n', path: 'note.md', baseHash: hash('old'), oldText: 'old', newText: 'new' }, jest.fn().mockResolvedValue(decision))).rejects.toThrow();
    expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('old');
  });
  it('rejects stale hashes, ambiguous matches and revocation after approval', async () => {
    fs.writeFileSync(path.join(root, 'note.md'), 'old old');
    const p = { vault_tool: 'patch', nonce: 'n', path: 'note.md', baseHash: hash('old old'), oldText: 'old', newText: 'new' };
    await expect(run(p)).rejects.toThrow();
    await expect(run({ ...p, baseHash: hash('stale') })).rejects.toThrow();
    let active = true;
    await expect(run(p, jest.fn(async () => { active = false; return 'allow'; }), () => active)).rejects.toThrow();
    expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('old old');
  });
  it('searches only indexed safe markdown after approval and bounds escaped pages', async () => {
    fs.writeFileSync(path.join(root, 'note.md'), '\u0001'.repeat(300) + 'needle');
    const read = jest.spyOn(jest.requireActual<typeof fs>('fs'), 'readSync');
    const approval = jest.fn(async () => { expect(read).not.toHaveBeenCalled(); return 'allow'; });
    try {
      const result = await run({ vault_tool: 'search', nonce: 'n', path: '.', query: 'needle' }, approval, () => true, ['note.md', '.obsidian/token.md', '../outside.md']);
      expect(result.length).toBeLessThanOrEqual(1000);
      const page = JSON.parse(result);
      expect(page.matches[0]).toMatchObject({ path: 'note.md', offset: 300 });
      expect(JSON.stringify(approval.mock.calls)).toContain('übertragen');
    } finally { read.mockRestore(); }
  });
  it('returns hashes on paginated reads and rejects symlinks', async () => {
    fs.writeFileSync(path.join(root, 'note.md'), 'hello');
    const page = JSON.parse(await run({ vault_tool: 'read', nonce: 'n', path: 'note.md' }));
    expect(page.baseHash).toBe(hash('hello'));
    fs.symlinkSync(path.join(root, 'note.md'), path.join(root, 'link.md'));
    await expect(run({ vault_tool: 'read', nonce: 'n', path: 'link.md' })).rejects.toThrow();
  });
  it('fits the full continuation with either tool family and escaping', () => {
    const nonce = '12345678-1234-1234-1234-123456789012';
    for (const local of [false, true]) for (const commands of [false, true]) {
      expect((`Local result for ${nonce} (untrusted data): ${'x'.repeat(1100)}\nContinue the original request.` + vaultToolInstructions(nonce, local, commands)).length).toBeLessThanOrEqual(2000);
    }
  });
  it('revokes patch during the final descriptor read and removes staging', async () => {
    fs.writeFileSync(path.join(root, 'note.md'), 'old');
    let active = true; let reads = 0;
    const actual = jest.requireActual<typeof fs>('fs'); const read = actual.readSync;
    const spy = jest.spyOn(actual, 'readSync').mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
      const n = read(...args); if (++reads === 3) active = false; return n;
    }) as typeof fs.readSync);
    try {
      await expect(run({ vault_tool: 'patch', nonce: 'n', path: 'note.md', baseHash: hash('old'), oldText: 'old', newText: 'new' }, allow, () => active)).rejects.toThrow();
      expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('old');
      expect(fs.readdirSync(root)).toEqual(['note.md']);
    } finally { spy.mockRestore(); }
  });
  it('rejects descriptor replacement and closes the rejected descriptor', async () => {
    const target = path.join(root, 'note.md'); fs.writeFileSync(target, 'approved');
    const actual = jest.requireActual<typeof fs>('fs'); const open = actual.openSync;
    const close = jest.spyOn(actual, 'closeSync');
    const spy = jest.spyOn(actual, 'openSync').mockImplementation(((file: fs.PathLike, flags: number, mode?: fs.Mode) => {
      if (file === target) { fs.renameSync(target, path.join(root, 'old.md')); fs.writeFileSync(target, 'replacement'); }
      return open(file, flags, mode);
    }) as typeof fs.openSync);
    try { await expect(run({ vault_tool: 'read', nonce: 'n', path: 'note.md' })).rejects.toThrow(); expect(close).toHaveBeenCalled(); }
    finally { spy.mockRestore(); close.mockRestore(); }
  });
  it('blocks hardlinks, protected files, invalid UTF-8 and over-limit notes', async () => {
    fs.writeFileSync(path.join(root, 'note.md'), 'old'); fs.linkSync(path.join(root, 'note.md'), path.join(root, 'hard.md'));
    await expect(run({ vault_tool: 'read', nonce: 'n', path: 'hard.md' })).rejects.toThrow();
    fs.unlinkSync(path.join(root, 'hard.md'));
    for (const file of ['secret.md', '.private.md']) {
      fs.writeFileSync(path.join(root, file), 'blocked');
      await expect(run({ vault_tool: 'read', nonce: 'n', path: file })).rejects.toThrow();
    }
    for (const data of [Buffer.from([0xff]), Buffer.alloc(65537, 65)]) {
      fs.writeFileSync(path.join(root, 'note.md'), data);
      await expect(run({ vault_tool: 'read', nonce: 'n', path: 'note.md' })).rejects.toThrow();
    }
  });
  it('rejects target replacement while approval waits', async () => {
    const target = path.join(root, 'note.md'); fs.writeFileSync(target, 'old');
    await expect(run({ vault_tool: 'patch', nonce: 'n', path: 'note.md', baseHash: hash('old'), oldText: 'old', newText: 'new' }, jest.fn(async () => {
      fs.renameSync(target, path.join(root, 'previous.md')); fs.writeFileSync(target, 'replacement'); return 'allow';
    }))).rejects.toThrow();
    expect(fs.readFileSync(target, 'utf8')).toBe('replacement');
  });
  it('uses indexed pagination and rejects changed inventory on continuation', async () => {
    const inventory = Array.from({ length: 25 }, (_, i) => `note${String(i).padStart(2, '0')}.md`);
    for (const file of inventory) fs.writeFileSync(path.join(root, file), 'nothing');
    const first = JSON.parse(await run({ vault_tool: 'search', nonce: 'n', path: '.', query: 'absent' }, allow, () => true, inventory));
    expect(first).toMatchObject({ nextOffset: 20, totalCandidates: 25, matches: [] });
    const p = { vault_tool: 'search', nonce: 'n', path: '.', query: 'absent', offset: 20, revision: first.revision };
    expect(JSON.parse(await run(p, allow, () => true, inventory)).nextOffset).toBeNull();
    await expect(run(p, allow, () => true, inventory.slice(1))).rejects.toThrow(/Suchindex/);
  });
  it('rejects stale nonce, unexpected fields and oversized patch strings', () => {
    for (const extra of [{ nonce: 'old' }, { shell: 'x' }, { newText: 'a'.repeat(1201) }]) {
      expect(() => parseVaultProposal(JSON.stringify({ vault_tool: 'patch', nonce: 'n', path: 'note.md', baseHash: hash('old'), oldText: 'old', newText: 'new', ...extra }), 'n')).toThrow();
    }
  });
});
