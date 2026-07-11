import type { RunTimeline } from '@/core/timeline/runTimeline';
import { RunTimelineStore } from '@/core/timeline/RunTimelineStore';

function timeline(id: string, startedAt: number): RunTimeline {
  return {
    id,
    conversationId: 'conversation-1',
    providerId: 'codex',
    model: 'gpt-5',
    promptPreview: 'Fix the streaming renderer',
    startedAt,
    events: [{ type: 'start', at: startedAt, label: 'Run started' }],
  };
}

function createAdapter() {
  const files = new Map<string, { content: string; mtime: number }>();
  let clock = 0;
  return {
    files,
    write: jest.fn(async (path: string, content: string) => {
      files.set(path, { content, mtime: ++clock });
    }),
    read: jest.fn(async (path: string) => files.get(path)?.content ?? ''),
    listFiles: jest.fn(async (folder: string) => [...files.keys()].filter(path => path.startsWith(`${folder}/`))),
    stat: jest.fn(async (path: string) => {
      const file = files.get(path);
      return file ? { mtime: file.mtime, size: file.content.length } : null;
    }),
    delete: jest.fn(async (path: string) => {
      files.delete(path);
    }),
  };
}

describe('RunTimelineStore', () => {
  it('persists and restores the newest timeline across plugin restarts', async () => {
    const adapter = createAdapter();
    const store = new RunTimelineStore(adapter as any);

    await store.save(timeline('old-run', 100));
    await store.save(timeline('new-run', 200));

    const restored = await new RunTimelineStore(adapter as any).getLatest();
    expect(restored).toMatchObject({ id: 'new-run', providerId: 'codex', startedAt: 200 });
    expect(restored).not.toBeNull();
    expect(restored!.events).not.toBe(timeline('new-run', 200).events);
  });

  it('keeps the configured newest history entries only', async () => {
    const adapter = createAdapter();
    const store = new RunTimelineStore(adapter as any, '.claudian/run-history', 2);

    await store.save(timeline('one', 1));
    await store.save(timeline('two', 2));
    await store.save(timeline('three', 3));

    expect([...adapter.files.keys()]).toHaveLength(2);
    expect([...adapter.files.keys()].join('\n')).not.toContain('one');
    expect([...adapter.files.keys()].join('\n')).toContain('two');
    expect([...adapter.files.keys()].join('\n')).toContain('three');
  });

  it('clears only persisted timeline files', async () => {
    const adapter = createAdapter();
    const store = new RunTimelineStore(adapter as any);
    await store.save(timeline('one', 1));
    await store.clear();

    expect(await store.getLatest()).toBeNull();
  });
});
