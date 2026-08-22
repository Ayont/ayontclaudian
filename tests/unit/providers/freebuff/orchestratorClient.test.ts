import {
  FreebuffOrchestratorClient,
  isOrchestratorHealthPayload,
  parseListenPorts,
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