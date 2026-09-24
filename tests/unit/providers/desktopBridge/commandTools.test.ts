import * as os from 'os';

import { runCommand } from '../../../../src/providers/desktopBridge/commandTools';

const run = (code: string, timeout = 3000, signal = new AbortController().signal, enabled = () => true) =>
  runCommand(process.execPath, ['-e', code], os.tmpdir(), timeout, signal, enabled);

describe('host command process boundary', () => {
  it.each(['timeout', 'cancel', 'revoke'] as const)('escalates TERM-resistant real process on %s and reaps its PID', async kind => {
    const controller = new AbortController();
    let enabled = true;
    const pending = run('process.on("SIGTERM",()=>{});process.stdout.write(String(process.pid));setInterval(()=>{},50);', kind === 'timeout' ? 400 : 3000, controller.signal, () => enabled);
    const timer = setTimeout(() => { if (kind === 'cancel') controller.abort(); if (kind === 'revoke') enabled = false; }, 400);
    try {
      const result = await pending;
      expect(result.signal).toBe('SIGKILL');
      expect(kind === 'timeout' ? result.timedOut : result.cancelled).toBe(true);
      expect(Number(result.data)).toBeGreaterThan(0);
      expect(() => process.kill(Number(result.data), 0)).toThrow();
    } finally { clearTimeout(timer); }
  });
  it('bounds pipe draining when a detached descendant retains stdout', async () => {
    const started = Date.now();
    const result = await run('require("child_process").spawn(process.execPath,["-e","setTimeout(()=>process.exit(0),1500)"],{stdio:"inherit",detached:true});process.exit(0);', 3000);
    expect(result.exitCode).toBe(0);
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it('reports a negative exit as the platform exit status', async () => {
    expect((await run('process.exit(-1)')).exitCode).toBe(255);
  });
  it('rejects spawn failure without waiting for timeout', async () => {
    await expect(runCommand('/nonexistent/desktop-test-node', [], os.tmpdir(), 3000, new AbortController().signal, () => true)).rejects.toThrow('konnte nicht gestartet');
  });
  it('cleans remaining group members when the leader exits, not at timeout', async () => {
    const result = await run('require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},100)"],{stdio:"inherit"});process.exit(7);', 800);
    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });
  it('caps retained output at 32 KiB without splitting a code point', async () => {
    // Only the cap is under test; a loaded machine can take seconds just to start node.
    const result = await run('process.stdout.write("😀".repeat(20000));', 15_000);
    expect(Buffer.byteLength(result.data, 'utf8')).toBeLessThanOrEqual(32768);
    expect(result.data).toBe('😀'.repeat(8192));
    expect(result.outputTruncated).toBe(true);
  });
  it('decodes split UTF-8 independently for stdout and stderr', async () => {
    const result = await run('process.stdout.write(Buffer.from([0xf0,0x9f])); setTimeout(()=>{process.stderr.write("E");process.stdout.write(Buffer.from([0x98,0x80]));},80);');
    expect(result.data).toContain('😀');
    expect(result.data).toContain('E');
    expect(result.data).not.toContain('�');
  });
});
