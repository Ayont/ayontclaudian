import type { AuxQueryConfig } from '@/core/auxiliary/AuxQueryRunner';
import { FreebuffAuxQueryRunner } from '@/providers/freebuff/runtime/FreebuffAuxQueryRunner';

type Deferred<T> = {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
};

type Settled<T> =
  | { status: 'fulfilled'; value: T }
  | { reason: unknown; status: 'rejected' }
  | { status: 'test-timeout' };

type MockClient = {
  closeThread: jest.Mock<Promise<void>, [number, string, AbortSignal?]>;
  createThread: jest.Mock<Promise<{ id: string } | null>, [number, Record<string, unknown>, AbortSignal?]>;
  discoverPort: jest.Mock<Promise<number | null>, [string?, AbortSignal?]>;
  openEventStream: jest.Mock<Promise<Response | null>, [number, AbortSignal]>;
  postMessage: jest.Mock<Promise<boolean>, [number, string, string, AbortSignal?]>;
  stopTurn: jest.Mock<Promise<void>, [number, string, AbortSignal?]>;
};

function deferred<T>(): Deferred<T> {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle, fail) => {
    reject = fail;
    resolve = settle;
  });
  return { promise, reject, resolve };
}

function createRunner(): { client: MockClient; runner: FreebuffAuxQueryRunner } {
  const plugin = {
    app: {
      vault: {
        adapter: { basePath: '/tmp/freebuff-vault' },
      },
    },
    settings: {
      providerConfigs: {
        freebuff: { enabled: true },
      },
    },
  };
  // Reflect keeps this red-state test source compatible with the old one-arg
  // constructor while exercising the new configurable deadlines once added.
  const runner = Reflect.construct(FreebuffAuxQueryRunner, [plugin, {
    cleanupTimeoutMs: 20,
    operationTimeoutMs: 20,
    totalTimeoutMs: 100,
  }]) as FreebuffAuxQueryRunner;
  const client = (runner as unknown as { client: MockClient }).client;
  client.discoverPort = jest.fn().mockResolvedValue(4242);
  client.createThread = jest.fn().mockResolvedValue({ id: 'thread-1' });
  client.postMessage = jest.fn().mockResolvedValue(true);
  client.openEventStream = jest.fn();
  client.stopTurn = jest.fn().mockResolvedValue(undefined);
  client.closeThread = jest.fn().mockResolvedValue(undefined);
  return { client, runner };
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs = 100): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'test-timeout' }), timeoutMs);
  });
  const settled = promise.then<Settled<T>, Settled<T>>(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ reason, status: 'rejected' }),
  );
  const result = await Promise.race([settled, timeout]);
  if (timer) {
    clearTimeout(timer);
  }
  return result;
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function expectRemoteCleanup(client: MockClient, threadId: string): void {
  expect(client.stopTurn).toHaveBeenCalledWith(4242, threadId, expect.any(AbortSignal));
  expect(client.closeThread).toHaveBeenCalledWith(4242, threadId, expect.any(AbortSignal));
}

function createConfig(abortController = new AbortController()): AuxQueryConfig {
  return {
    abortController,
    systemPrompt: 'Antworte knapp.',
  };
}

describe('FreebuffAuxQueryRunner cancellation cleanup', () => {
  it('does not continue after cancellation during port discovery', async () => {
    const { client, runner } = createRunner();
    const port = deferred<number | null>();
    client.discoverPort.mockReturnValue(port.promise);
    const config = createConfig();

    const query = runner.query(config, 'Titel');
    config.abortController?.abort();

    const result = await settleWithin(query);
    expect(result).toEqual(expect.objectContaining({
      reason: expect.objectContaining({ message: 'Cancelled' }),
      status: 'rejected',
    }));
    expect(client.createThread).not.toHaveBeenCalled();

    // A provider promise may reject after the cancellation race has already
    // settled. Its rejection must remain observed rather than leaking globally.
    port.reject(new Error('late discovery failure'));
    await flushPromises();
  });

  it('settles on reset during createThread and cleans a late thread result', async () => {
    const { client, runner } = createRunner();
    const thread = deferred<{ id: string } | null>();
    let markCreateStarted!: () => void;
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve;
    });
    client.createThread.mockImplementation(() => {
      markCreateStarted();
      return thread.promise;
    });
    const config = createConfig();

    const query = runner.query(config, 'Titel');
    await createStarted;
    runner.reset();

    const result = await settleWithin(query);
    expect(result).toEqual(expect.objectContaining({
      reason: expect.objectContaining({ message: 'Cancelled' }),
      status: 'rejected',
    }));
    expect(client.postMessage).not.toHaveBeenCalled();

    thread.resolve({ id: 'thread-late' });
    await flushPromises();
    expectRemoteCleanup(client, 'thread-late');
  });

  it('does not open SSE after cancellation while posting the message', async () => {
    const { client, runner } = createRunner();
    const accepted = deferred<boolean>();
    let markPostStarted!: () => void;
    const postStarted = new Promise<void>((resolve) => {
      markPostStarted = resolve;
    });
    client.postMessage.mockImplementation(() => {
      markPostStarted();
      return accepted.promise;
    });
    const config = createConfig();

    const query = runner.query(config, 'Titel');
    await postStarted;
    config.abortController?.abort();

    const result = await settleWithin(query);
    expect(result).toEqual(expect.objectContaining({
      reason: expect.objectContaining({ message: 'Cancelled' }),
      status: 'rejected',
    }));
    expect(client.openEventStream).not.toHaveBeenCalled();
    expectRemoteCleanup(client, 'thread-1');
  });

  it('does not attach an SSE reader when cancellation wins while opening the stream', async () => {
    const { client, runner } = createRunner();
    const response = deferred<Response | null>();
    let markOpenStarted!: () => void;
    const openStarted = new Promise<void>((resolve) => {
      markOpenStarted = resolve;
    });
    const getReader = jest.fn();
    client.openEventStream.mockImplementation(() => {
      markOpenStarted();
      return response.promise;
    });
    const config = createConfig();

    const query = runner.query(config, 'Titel');
    await openStarted;
    config.abortController?.abort();

    const result = await settleWithin(query);
    expect(result).toEqual(expect.objectContaining({
      reason: expect.objectContaining({ message: 'Cancelled' }),
      status: 'rejected',
    }));
    expect(getReader).not.toHaveBeenCalled();
    expectRemoteCleanup(client, 'thread-1');
  });

  it('reset cancels the active SSE reader and remote thread', async () => {
    const { client, runner } = createRunner();
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const reader = {
      cancel: jest.fn().mockReturnValue(new Promise<void>(() => {})),
      read: jest.fn().mockImplementation(() => {
        markReadStarted();
        return new Promise<ReadableStreamReadResult<Uint8Array>>(() => {});
      }),
    };
    client.openEventStream.mockResolvedValue({
      body: { getReader: () => reader },
    } as unknown as Response);

    const query = runner.query(createConfig(), 'Titel');
    await readStarted;
    runner.reset();

    const result = await settleWithin(query);
    expect(result).toEqual(expect.objectContaining({
      reason: expect.objectContaining({ message: 'Cancelled' }),
      status: 'rejected',
    }));
    expect(reader.cancel).toHaveBeenCalled();
    expectRemoteCleanup(client, 'thread-1');
  });

  it('enforces an operation deadline when discovery never settles', async () => {
    const { client, runner } = createRunner();
    client.discoverPort.mockReturnValue(new Promise<number | null>(() => {}));

    const result = await settleWithin(runner.query(createConfig(), 'Titel'));

    expect(result).toEqual(expect.objectContaining({
      reason: expect.objectContaining({ message: expect.stringContaining('discoverPort timed out') }),
      status: 'rejected',
    }));
    expect(client.createThread).not.toHaveBeenCalled();
  });

  it('bounds cleanup when remote stop and close never settle', async () => {
    const { client, runner } = createRunner();
    client.stopTurn.mockReturnValue(new Promise<void>(() => {}));
    client.closeThread.mockReturnValue(new Promise<void>(() => {}));
    const payload = new TextEncoder().encode([
      'data: {"type":"agent","threadId":"thread-1","event":{"type":"finish"}}',
      '',
      '',
    ].join('\n'));
    const reader = {
      cancel: jest.fn().mockResolvedValue(undefined),
      read: jest.fn().mockResolvedValue({ done: false, value: payload }),
    };
    client.openEventStream.mockResolvedValue({
      body: { getReader: () => reader },
    } as unknown as Response);

    const result = await settleWithin(runner.query(createConfig(), 'Titel'));

    expect(result).toEqual({ status: 'fulfilled', value: '' });
    expectRemoteCleanup(client, 'thread-1');
  });

  it('always aborts the local stream and closes the remote thread after success', async () => {
    const { client, runner } = createRunner();
    const payload = new TextEncoder().encode([
      'data: {"type":"agent","threadId":"thread-1","event":{"type":"text","text":"Antwort"}}',
      '',
      'data: {"type":"agent","threadId":"thread-1","event":{"type":"finish"}}',
      '',
      '',
    ].join('\n'));
    const reader = {
      cancel: jest.fn().mockResolvedValue(undefined),
      read: jest.fn().mockResolvedValue({ done: false, value: payload }),
    };
    client.openEventStream.mockImplementation(async () => {
      return { body: { getReader: () => reader } } as unknown as Response;
    });

    await expect(runner.query(createConfig(), 'Titel')).resolves.toBe('Antwort');

    const streamSignal = client.openEventStream.mock.calls[0][1];
    expect(streamSignal.aborted).toBe(true);
    expect(reader.cancel).toHaveBeenCalled();
    expectRemoteCleanup(client, 'thread-1');
  });
});
