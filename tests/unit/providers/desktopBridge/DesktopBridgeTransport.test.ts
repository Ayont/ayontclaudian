import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';

import { extractReply, queryDesktopBridge, runSerialized } from '../../../../src/providers/desktopBridge/DesktopBridgeTransport';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
const mockedSpawn = spawn as jest.Mock;
function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { end: jest.fn() }), kill: jest.fn(),
  });
}
describe('desktop bridge boundaries', () => {
  beforeEach(() => mockedSpawn.mockReset());
  it('requires exact framing and nonce', () => {
    expect(() => extractReply('Please say BEGIN_abc hello END_abc', 'abc')).toThrow();
    expect(extractReply('BEGIN_abc\nhello\nEND_abc', 'abc')).toBe('hello');
    expect(() => extractReply('BEGIN_other\nhello\nEND_other', 'abc')).toThrow();
    expect(() => extractReply('BEGIN_abc\nhello\nEND_abc-other', 'abc')).toThrow();
  });
  it('serializes foreground/clipboard globally and recovers after rejection', async () => {
    const order: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const a = runSerialized('grok-bot', async () => { order.push(1); await gate; order.push(2); throw new Error('x'); });
    const rejection = a.catch(error => error);
    const b = runSerialized('perplexity-chat', async () => { order.push(3); });
    await new Promise(resolve => setImmediate(resolve));
    try { expect(order).toEqual([1]); } finally { release(); }
    expect(await rejection).toEqual(new Error('x')); await b;
    expect(order).toEqual([1, 2, 3]);
  });
  it('never treats a dynamic AX placeholder equal to a draft as empty', () => {
    const source = readFileSync('scripts/desktop-bridge.swift', 'utf8');
    expect(source).not.toContain('draft == placeholder');
    expect(source).toContain('guard draft.isEmpty || grokEmpty');
    expect(source).toContain('/desktop-global.lock');
  });
  it('preserves multiline prompts and pastes once instead of typing per character', () => {
    const source = readFileSync('scripts/desktop-bridge.swift', 'utf8');
    expect(source).not.toContain('prompt.replacingOccurrences');
    expect(source).not.toContain('for char in chars');
    expect(source).toContain('pasteVerified(framed, into: composer');
  });
  it('never spawns a pre-cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(queryDesktopBridge({ provider: 'grok-bot', prompt: 'hello', anchor: 'a', helperPath: 'helper', signal: controller.signal })).rejects.toThrow('Abgebrochen');
    expect(mockedSpawn).not.toHaveBeenCalled();
  });
  it('holds the global queue until a cancelled child closes, never resends', async () => {
    const child = fakeChild(); mockedSpawn.mockReturnValue(child);
    const controller = new AbortController();
    const request = queryDesktopBridge({ provider: 'grok-bot', prompt: 'hello', anchor: 'a', helperPath: 'helper', signal: controller.signal });
    const rejection = request.catch(error => error);
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    let next = false;
    const queued = runSerialized('perplexity-chat', async () => { next = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(next).toBe(false);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', null, 'SIGTERM');
    expect((await rejection).message).toContain('Abgebrochen'); await queued;
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });
  it('terminates on stdin errors and ignores later success', async () => {
    const child = fakeChild(); mockedSpawn.mockReturnValue(child);
    const request = queryDesktopBridge({ provider: 'grok-bot', prompt: 'hello', anchor: 'a', helperPath: 'helper' });
    const rejection = request.catch(error => error);
    await new Promise(resolve => setImmediate(resolve));
    child.stdin.emit('error', new Error('broken pipe'));
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', 0);
    expect((await rejection).message).toContain('broken pipe');
  });
});
