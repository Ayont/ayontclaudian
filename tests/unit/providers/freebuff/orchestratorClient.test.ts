import {
  FreebuffOrchestratorClient,
  isOrchestratorHealthPayload,
  parseListenPorts,
  parseProcessLaunchInfo,
} from '@/providers/freebuff/runtime/FreebuffOrchestratorClient';

describe('parseListenPorts', () => {
  it('extracts loopback listen ports from lsof output', () => {
    const output = [
      'bun 123 ayont 12u IPv4 TCP 127.0.0.1:50599 (LISTEN)',
      'bun 123 ayont 13u IPv6 TCP *:8787 (LISTEN)',
      'bun 123 ayont 14u IPv4 TCP 192.168.0.5:9000 (LISTEN)',
    ].join('\n');
    expect(parseListenPorts(output)).toEqual([50599]);
  });
});

describe('isOrchestratorHealthPayload', () => {
  it('accepts both the live status and the launch-id rejection fingerprint', () => {
    expect(isOrchestratorHealthPayload(200, JSON.stringify({ ok: true, launchId: 'l', pid: 1, port: 50599 }))).toBe(true);
    expect(isOrchestratorHealthPayload(401, '{"error":"invalid launch id"}')).toBe(true);
    expect(isOrchestratorHealthPayload(404, 'not found')).toBe(false);
    expect(isOrchestratorHealthPayload(200, '<html>other server</html>')).toBe(false);
  });

  it('recognizes the newer token-gate rejection of the desktop update', () => {
    const body = JSON.stringify({ error: { kind: 'bad_request', message: 'missing or invalid token' } });
    expect(isOrchestratorHealthPayload(401, body)).toBe(true);
    expect(isOrchestratorHealthPayload(401, 'totally different server')).toBe(false);
  });
});

describe('parseProcessLaunchInfo', () => {
  it('extracts port and launch id from the orchestrator process environment', () => {
    const info = parseProcessLaunchInfo('KEY=x PATH=/bin PORT=49451 FREEBUFF_LAUNCH_ID=bed71499 OTHER=1');
    expect(info).toEqual({ port: 49451, launchId: 'bed71499' });
  });

  it('tolerates missing values', () => {
    expect(parseProcessLaunchInfo('SOMETHING=else')).toEqual({});
    expect(parseProcessLaunchInfo('PORT=not-a-number')).toEqual({});
  });
});

function makeFetch(responses: Map<string, { status: number; body: string }>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string) => {
    calls.push(input);
    const hit = responses.get(input) ?? { status: 404, body: 'nope' };
    return { status: hit.status, text: async () => hit.body, json: async () => JSON.parse(hit.body), ok: hit.status < 400 } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('FreebuffOrchestratorClient', () => {
  it('validates an explicit port override before using it', async () => {
    const { fetchImpl } = makeFetch(new Map([
      ['http://127.0.0.1:7777/healthz', { status: 401, body: '{"error":"invalid launch id"}' }],
    ]));
    const client = new FreebuffOrchestratorClient({ fetchImpl, execImpl: async () => { throw new Error('no exec'); } });
    await expect(client.discoverPort('7777')).resolves.toBe(7777);
  });

  it('rejects a wrong override and returns null when pgrep finds nothing', async () => {
    const { fetchImpl } = makeFetch(new Map());
    const client = new FreebuffOrchestratorClient({
      fetchImpl,
      execImpl: async (file, args) => {
        if (file === 'pgrep') {
          return { stdout: '' };
        }
        throw new Error(`unexpected ${args.join(' ')}`);
      },
    });
    await expect(client.discoverPort('9999')).resolves.toBeNull();
  });

  it('discovers the orchestrator through pgrep plus lsof and fingerprints healthz', async () => {
    const { fetchImpl, calls } = makeFetch(new Map([
      ['http://127.0.0.1:1111/healthz', { status: 404, body: '' }],
      ['http://127.0.0.1:2222/healthz', { status: 200, body: '{"ok":true,"launchId":"l","pid":67018,"port":2222}' }],
    ]));
    const client = new FreebuffOrchestratorClient({
      fetchImpl,
      execImpl: async (file) => {
        if (file === 'pgrep') {
          return { stdout: '67018\n' };
        }
        return { stdout: 'TCP 127.0.0.1:1111 (LISTEN)\nTCP 127.0.0.1:2222 (LISTEN)' };
      },
    });
    await expect(client.discoverPort()).resolves.toBe(2222);
    expect(calls.some((url) => url.endsWith(':1111/healthz'))).toBe(true);
    // Memoized second call does no exec work.
    await expect(client.discoverPort()).resolves.toBe(2222);
  });

  it('discovers via ps environment and remembers the launch id for auth', async () => {
    const { fetchImpl, calls } = makeFetch(new Map([
      ['http://127.0.0.1:49451/healthz', { status: 401, body: '{"error":{"kind":"bad_request","message":"missing or invalid token"}}' }],
      ['http://127.0.0.1:49451/api/threads', { status: 200, body: '{"id":"t1"}' }],
    ]));
    const inits: RequestInit[] = [];
    const client = new FreebuffOrchestratorClient({
      fetchImpl: ((input: string, init?: RequestInit) => { inits.push(init ?? {}); return (fetchImpl as (i: string) => Promise<Response>)(input); }) as typeof fetch,
      execImpl: async (file) => {
        if (file === 'pgrep') return { stdout: '96642\n' };
        if (file === 'ps') return { stdout: 'PORT=49451 FREEBUFF_LAUNCH_ID=bed71499-xyz' };
        if (file === 'lsof') return { stdout: '' };
        throw new Error('unexpected ' + file);
      },
    });
    await expect(client.discoverPort()).resolves.toBe(49451);
    expect(client.getLaunchId()).toBe('bed71499-xyz');
    await client.createThread(49451, { projectPath: '/tmp' });
    const headers = (inits.find((init) => init.headers)?.headers ?? {}) as Record<string, string>;
    expect(headers['x-freebuff-launch-id']).toBe('bed71499-xyz');
    expect(calls.some((url) => url.includes(':49451'))).toBe(true);
  });

  it('revalidates the cached port and recovers after a desktop restart', async () => {
    const responses = new Map<string, { status: number; body: string }>([
      ['http://127.0.0.1:49451/healthz', { status: 404, body: '' }],
      ['http://127.0.0.1:60589/healthz', { status: 401, body: '{"error":"invalid launch id"}' }],
    ]);
    const client = new FreebuffOrchestratorClient({
      fetchImpl: ((input: string) => {
        const hit = responses.get(input) ?? { status: 404, body: 'nope' };
        return Promise.resolve({ status: hit.status, text: async () => hit.body } as unknown as Response);
      }) as typeof fetch,
      execImpl: async (file) => {
        if (file === 'pgrep') return { stdout: '9126\n' };
        if (file === 'ps') return { stdout: 'PORT=0 FREEBUFF_LAUNCH_ID=new-id' };
        if (file === 'lsof') return { stdout: 'TCP 127.0.0.1:60589 (LISTEN)' };
        throw new Error('unexpected ' + file);
      },
    });
    // Seed the cache with the port from the PREVIOUS desktop session.
    ;(client as unknown as { cachedPort: number }).cachedPort = 49451;
    // The desktop restarted; the old port is dead but the env now says PORT=0.
    await expect(client.discoverPort()).resolves.toBe(60589);
  });

  it('posts messages as JSON and reports acceptance', async () => {
    const bodies: string[] = [];
    const fetchImpl = (async (input: string, init?: RequestInit) => {
      bodies.push(`${input} ${String(init?.body ?? '')}`);
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '', } as unknown as Response;
    }) as unknown as typeof fetch;
    const client = new FreebuffOrchestratorClient({ fetchImpl });
    await expect(client.postMessage(50599, 'tid', 'hallo')).resolves.toBe(true);
    expect(bodies[0]).toContain('/api/thread/tid/message');
    expect(bodies[0]).toContain('hallo');
  });
});