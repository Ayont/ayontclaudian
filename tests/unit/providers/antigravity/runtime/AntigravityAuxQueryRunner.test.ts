import { EventEmitter } from 'node:events';

import type { AuxQueryConfig } from '@/core/auxiliary/AuxQueryRunner';
import {
  deleteAntigravityConversationDir,
} from '@/providers/antigravity/history/AntigravityBrainStore';
import { AntigravityAuxQueryRunner } from '@/providers/antigravity/runtime/AntigravityAuxQueryRunner';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('@/providers/antigravity/history/AntigravityBrainStore', () => ({
  deleteAntigravityConversationDir: jest.fn(),
  readAntigravityTranscript: jest.fn(() => null),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require('node:child_process') as { spawn: jest.Mock };

const mockDeleteConversation = jest.mocked(deleteAntigravityConversationDir);

interface FakeProcess extends EventEmitter {
  exitCode: number | null;
  kill: jest.Mock;
  pid: number;
  stderr: EventEmitter;
  stdin: { end: jest.Mock };
  stdout: EventEmitter;
}

function createProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  proc.exitCode = null;
  proc.kill = jest.fn().mockReturnValue(true);
  proc.pid = 8123;
  proc.stderr = new EventEmitter();
  proc.stdin = { end: jest.fn() };
  proc.stdout = new EventEmitter();
  return proc;
}

function createRunner(): AntigravityAuxQueryRunner {
  return new AntigravityAuxQueryRunner({
    app: {
      vault: {
        adapter: { basePath: '/tmp/antigravity-vault' },
      },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/bin/agy'),
    settings: {
      providerConfigs: {
        antigravity: { enabled: true },
      },
    },
  } as any);
}

function config(abortController?: AbortController): AuxQueryConfig {
  return {
    abortController,
    systemPrompt: 'Antworte knapp.',
  };
}

describe('AntigravityAuxQueryRunner hidden-conversation cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('deletes the fresh hidden conversation when stdout supplied the answer', async () => {
    const proc = createProcess();
    spawn.mockReturnValue(proc);
    const query = createRunner().query(config(), 'Titel');

    proc.stdout.emit('data', '{"event":"init","conversation_id":"fresh-aux","init":{}}\n');
    proc.stdout.emit('data', '{"event":"result","result":{"conversation_id":"fresh-aux","status":"SUCCESS","response":"Kurzer Titel"}}\n');
    proc.exitCode = 0;
    proc.emit('exit', 0);
    await jest.advanceTimersByTimeAsync(400);

    await expect(query).resolves.toBe('Kurzer Titel');
    expect(mockDeleteConversation).toHaveBeenCalledWith('fresh-aux');
  });

  it('deletes the fresh hidden conversation after a non-zero exit', async () => {
    const proc = createProcess();
    spawn.mockReturnValue(proc);
    const query = createRunner().query(config(), 'Titel');

    proc.stdout.emit('data', '{"event":"init","conversation_id":"fresh-aux","init":{}}\n');
    proc.stderr.emit('data', 'provider failed');
    proc.exitCode = 2;
    proc.emit('exit', 2);
    let rejection: unknown;
    const settled = query.catch((error: unknown) => {
      rejection = error;
    });
    await jest.advanceTimersByTimeAsync(400);

    await settled;
    expect(rejection).toEqual(expect.objectContaining({
      message: expect.stringContaining('agy exited with code 2'),
    }));
    expect(mockDeleteConversation).toHaveBeenCalledWith('fresh-aux');
  });

  it('deletes the fresh hidden conversation after a process error', async () => {
    const proc = createProcess();
    spawn.mockReturnValue(proc);
    const query = createRunner().query(config(), 'Titel');

    proc.stdout.emit('data', '{"event":"init","conversation_id":"fresh-aux","init":{}}\n');
    proc.emit('error', new Error('spawn failed'));

    await expect(query).rejects.toThrow('spawn failed');
    expect(mockDeleteConversation).toHaveBeenCalledWith('fresh-aux');
  });

  it('deletes the fresh hidden conversation after abort', async () => {
    const proc = createProcess();
    spawn.mockReturnValue(proc);
    const abortController = new AbortController();
    const query = createRunner().query(config(abortController), 'Titel');

    proc.stdout.emit('data', '{"event":"init","conversation_id":"fresh-aux","init":{}}\n');
    abortController.abort();
    proc.exitCode = 143;
    proc.emit('exit', 143);

    await expect(query).rejects.toThrow('Cancelled');
    expect(proc.kill).toHaveBeenCalled();
    expect(mockDeleteConversation).toHaveBeenCalledWith('fresh-aux');
  });

  it('never deletes a conversation that existed before the auxiliary run', async () => {
    const proc = createProcess();
    spawn.mockReturnValue(proc);
    const query = createRunner().query(config(), 'Titel');

    proc.stdout.emit('data', 'Kurzer Titel');
    proc.exitCode = 0;
    proc.emit('exit', 0);
    await jest.advanceTimersByTimeAsync(400);

    await expect(query).resolves.toBe('Kurzer Titel');
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });

  it('never deletes a newer foreign conversation when the auxiliary run has no correlated id', async () => {
    const proc = createProcess();
    spawn.mockReturnValue(proc);
    const query = createRunner().query(config(), 'Titel');

    proc.stdout.emit('data', 'Kurzer Titel');
    proc.exitCode = 0;
    proc.emit('exit', 0);
    await jest.advanceTimersByTimeAsync(400);

    await expect(query).resolves.toBe('Kurzer Titel');
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });

  it('deletes only the conversation id emitted by its own stream when another run is parallel', async () => {
    const first = createProcess();
    const second = createProcess();
    spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const firstQuery = createRunner().query(config(), 'Titel 1');
    const secondQuery = createRunner().query(config(), 'Titel 2');

    first.stdout.emit('data', '{"event":"init","conversation_id":"aux-one","init":{}}\n');
    second.stdout.emit('data', '{"event":"init","conversation_id":"aux-two","init":{}}\n');
    first.stdout.emit('data', '{"event":"result","result":{"conversation_id":"aux-one","status":"SUCCESS","response":"Eins"}}\n');
    second.stdout.emit('data', '{"event":"result","result":{"conversation_id":"aux-two","status":"SUCCESS","response":"Zwei"}}\n');
    first.exitCode = 0;
    second.exitCode = 0;
    first.emit('exit', 0);
    second.emit('exit', 0);
    await jest.advanceTimersByTimeAsync(400);

    await expect(Promise.all([firstQuery, secondQuery])).resolves.toEqual(['Eins', 'Zwei']);
    expect(mockDeleteConversation.mock.calls).toEqual([['aux-one'], ['aux-two']]);
  });
});
