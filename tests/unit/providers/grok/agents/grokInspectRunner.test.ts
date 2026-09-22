import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { createGrokInspectRunner, GROK_INSPECT_TIMEOUT_MS } from '@/providers/grok/agents/grokInspectRunner';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

function makeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: jest.fn().mockReturnValue(true),
  });
}

describe('createGrokInspectRunner', () => {
  let child: ReturnType<typeof makeChild>;
  const options = {
    resolveCommand: () => '/bin/grok', resolveCwd: () => '/vault',
    resolveEnv: () => ({ PATH: '/bin' }),
  };
  beforeEach(() => {
    jest.useFakeTimers();
    child = makeChild();
    jest.mocked(spawn).mockReset().mockReturnValue(child as never);
  });
  afterEach(() => { jest.useRealTimers(); });

  it('terminates a timed-out child and detaches output consumers', async () => {
    const promise = createGrokInspectRunner(options)();
    jest.advanceTimersByTime(GROK_INSPECT_TIMEOUT_MS);
    await expect(promise).rejects.toThrow('Zeitlimit');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(child.stdout.listenerCount('data')).toBe(0);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    child.emit('error', new Error('late process error'));
    child.emit('close', 0);
  });

  it('bounds stdout memory and stops an oversized report', async () => {
    const promise = createGrokInspectRunner(options)();
    child.stdout.write('x'.repeat(4 * 1024 * 1024 + 1));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    await expect(promise).rejects.toThrow('zu groß');
  });

  it.each(['stdin', 'stdout', 'stderr'] as const)('handles %s stream failures without uncaught errors', async (stream) => {
    const promise = createGrokInspectRunner(options)();
    child[stream].emit('error', new Error('secret diagnostic'));
    await expect(promise).rejects.toThrow('fehlgeschlagen');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('refuses discovery without a vault directory', async () => {
    await expect(createGrokInspectRunner({ ...options, resolveCwd: () => '' })()).rejects.toThrow('Vault');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('sanitizes synchronous spawn failures', async () => {
    jest.mocked(spawn).mockImplementation(() => { throw new Error('secret diagnostic'); });
    await expect(createGrokInspectRunner(options)()).rejects.toThrow('konnte nicht gestartet');
  });

  it('does not accept stderr as a successful JSON report', async () => {
    const promise = createGrokInspectRunner(options)();
    child.stderr.write('{"agents":[]}');
    child.emit('close', 0);
    await expect(promise).rejects.toThrow('keine Bot-Liste');
  });

  it('closes stdin for read-only inspection and returns only stdout', async () => {
    const promise = createGrokInspectRunner(options)();
    expect(child.stdin.writableEnded).toBe(true);
    child.stdout.write('{"agents":[]}');
    child.stderr.write('warning');
    child.emit('close', 0);
    await expect(promise).resolves.toBe('{"agents":[]}');
    expect(spawn).toHaveBeenCalledWith('/bin/grok', ['inspect', '--json'], expect.objectContaining({
      cwd: '/vault', env: { PATH: '/bin' }, stdio: 'pipe', windowsHide: true,
    }));
    expect(jest.getTimerCount()).toBe(0);
  });
});
