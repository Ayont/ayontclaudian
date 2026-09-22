import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { executeLocalProposal, parseLocalProposal } from '../../../../src/providers/desktopBridge/localTools';

describe('explicit host coding commands', () => {
  let root: string;
  beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-tools-'))); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  it.each([false, true])('requires opt-in before and after approval (revoke=%s)', async revoke => {
    let enabled = !revoke;
    const proposal = parseLocalProposal(JSON.stringify({ local_tool: 'run', nonce: 'n', path: '.', command: 'node', args: ['-e', 'process.exit(0)'] }), 'n')!;
    const approve = jest.fn(async () => { enabled = false; return 'allow' as const; });
    if (revoke) enabled = true;
    await expect(executeLocalProposal(proposal, root, approve, new AbortController().signal, () => true, () => enabled)).rejects.toThrow();
  });
  it.each([{ command: '/bin/sh' }, { args: ['bad\u0000arg'] }, { env: { TOKEN: 'synthetic' } }, { timeout: 120001 }])('rejects malformed/override schema %j', update => {
    expect(() => parseLocalProposal(JSON.stringify({ local_tool: 'run', nonce: 'n', path: '.', command: 'node', args: [], ...update }), 'n')).toThrow();
  });
  it('bounds real output, paginates it and omits inherited secrets', async () => {
    process.env.DESKTOP_SYNTHETIC_TOKEN = 'not-for-child';
    try {
      fs.writeFileSync(path.join(root, 'output.js'), 'process.stdout.write(String(process.env.DESKTOP_SYNTHETIC_TOKEN)+"x".repeat(100000));');
      const proposal = parseLocalProposal(JSON.stringify({ local_tool: 'run', nonce: 'n', path: '.', command: 'node', args: ['output.js'] }), 'n')!;
      const outputs = new Map();
      const result = JSON.parse(await executeLocalProposal(proposal, root, jest.fn().mockResolvedValue('allow'), new AbortController().signal, () => true, () => true, outputs));
      expect(result.data).toMatch(/^undefined/); expect(result.total).toBe(32768); expect(result.outputTruncated).toBe(true);
      const page = await executeLocalProposal({ local_tool: 'output', nonce: 'page', path: 'n', offset: result.nextOffset }, root, null, new AbortController().signal, () => true, () => true, outputs);
      expect(page.length).toBeLessThanOrEqual(1100); expect(JSON.parse(page).offset).toBe(result.nextOffset);
    } finally { delete process.env.DESKTOP_SYNTHETIC_TOKEN; }
  });
  it.each(['timeout', 'cancel'] as const)('terminates real fixture on %s', async kind => {
    fs.writeFileSync(path.join(root, 'wait.js'), 'setInterval(()=>{},100);');
    const controller = new AbortController();
    const proposal = parseLocalProposal(JSON.stringify({ local_tool: 'run', nonce: 'n', path: '.', command: 'node', args: ['wait.js'], timeout: kind === 'timeout' ? 100 : 3000 }), 'n')!;
    const timer = kind === 'cancel' ? setTimeout(() => controller.abort(), 100) : undefined;
    try {
      const result = JSON.parse(await executeLocalProposal(proposal, root, jest.fn().mockResolvedValue('allow'), controller.signal, () => true, () => true));
      expect(kind === 'timeout' ? result.timedOut : result.cancelled).toBe(true); expect(result.signal).toMatch(/SIGTERM|SIGKILL/);
    } finally { clearTimeout(timer); }
  });
  it('rejects a working root replaced during consent', async () => {
    const proposal = parseLocalProposal(JSON.stringify({ local_tool: 'run', nonce: 'n', path: '.', command: 'node', args: ['-e', 'process.exit(0)'] }), 'n')!;
    const moved = root + '-old';
    try {
      const approve = jest.fn(async () => { fs.renameSync(root, moved); fs.mkdirSync(root); return 'allow' as const; });
      await expect(executeLocalProposal(proposal, root, approve, new AbortController().signal, () => true, () => true)).rejects.toThrow('geändert');
    } finally { fs.rmSync(moved, { recursive: true, force: true }); }
  });
  it('does not revive execution when consent arrives after cancellation', async () => {
    const controller = new AbortController();
    let allow!: (value: 'allow') => void;
    const proposal = parseLocalProposal(JSON.stringify({ local_tool: 'run', nonce: 'n', path: '.', command: 'node', args: ['-e', 'require("fs").writeFileSync("marker","bad")'] }), 'n')!;
    const pending = executeLocalProposal(proposal, root, () => new Promise(resolve => { allow = resolve; }), controller.signal, () => true, () => true);
    controller.abort();
    await expect(pending).rejects.toThrow('Abgebrochen');
    allow('allow');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fs.existsSync(path.join(root, 'marker'))).toBe(false);
  });
  it('executes the immutable argv snapshot shown for consent', async () => {
    const proposal = parseLocalProposal(JSON.stringify({ local_tool: 'run', nonce: 'n', path: '.', command: 'node', args: ['-e', 'process.stdout.write("approved")'] }), 'n')!;
    const approve = jest.fn(async () => { proposal.args![1] = 'process.stdout.write("mutated")'; return 'allow' as const; });
    const result = JSON.parse(await executeLocalProposal(proposal, root, approve, new AbortController().signal, () => true, () => true));
    expect(result.data).toBe('approved');
  });
  it('runs a real node fixture after exact consent and returns nonzero as data', async () => {
    fs.writeFileSync(path.join(root, 'fixture.js'), 'process.stdout.write(process.argv[2]); process.exitCode=7;');
    const proposal = parseLocalProposal(JSON.stringify({ local_tool: 'run', nonce: 'n', path: '.', command: 'node', args: ['fixture.js', '; echo NOT_A_SHELL'], timeout: 3000 }), 'n')!;
    const approve = jest.fn().mockResolvedValue('allow');
    const result = JSON.parse(await executeLocalProposal(proposal, root, approve, new AbortController().signal, () => true, () => true));
    expect(result.exitCode).toBe(7);
    expect(result.data).toBe('; echo NOT_A_SHELL');
    expect(approve.mock.calls[0][2]).toMatch(/HOST EXECUTION.*NOT SANDBOX/);
    expect(approve.mock.calls[0][1].executable).toMatch(/^\//);
  });
});
