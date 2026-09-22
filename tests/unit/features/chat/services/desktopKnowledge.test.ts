import { DesktopKnowledgeService } from '../../../../../src/features/chat/services/desktopKnowledge';

function fixture() {
  const controller = new AbortController();
  const adapters = {
    graph: jest.fn(async () => [['Notes/a.md', 'Notes/b.md'], ['Notes/c.md', 'Notes/a.md'], ['Notes/b.md', 'Notes/a.md'], ['Else/x.md', 'Notes/a.md']] as [string, string][]),
    memories: jest.fn(async () => [{ path: '.claudian/memory/apple.md', topic: 'apple', content: 'apple knowledge', tags: [], mtime: 1 }]),
    readNote: jest.fn(async () => '---\ntopic: apple\n---\n' + 'full text '.repeat(200)),
  };
  const approve = jest.fn(async () => true);
  const service = new DesktopKnowledgeService({ turnId: 'turn', scope: 'Notes', memoryFolder: '.claudian/memory', signal: controller.signal, allowed: () => true, approve }, adapters);
  return { service, adapters, approve, controller };
}

describe('DesktopKnowledgeService', () => {
  it('traverses true backlinks, deduplicates cycles and excludes outside scope', async () => {
    const { service, adapters } = fixture();
    const result = await service.graph('Notes/a.md', 'both', 2);
    expect(result.items.map(item => item.path)).toEqual(['Notes/b.md', 'Notes/c.md']);
    expect(adapters.readNote).not.toHaveBeenCalled();
    expect((await service.graph('Notes/a.md', 'both', 2)).items).toEqual(result.items);
  });
  it('denial precedes metadata enumeration and memory text loading', async () => {
    const { service, adapters, approve } = fixture();
    approve.mockResolvedValue(false);
    await expect(service.graph('Notes/a.md')).rejects.toThrow();
    await expect(service.recall(['apple'])).rejects.toThrow();
    expect(adapters.graph).not.toHaveBeenCalled();
    expect(adapters.memories).not.toHaveBeenCalled();
  });
  it('recalls locally then snapshots exact raw note, not parsed/truncated memory', async () => {
    const { service, adapters, controller } = fixture();
    const result = await service.recall(['apple']);
    const snapshot = await service.snapshot([result.items[0].id]);
    let id: string | null = snapshot.manifest().items[0].firstPageId;
    let text = '';
    while (id) {
      const page = await snapshot.readPage(id, async () => true, controller.signal, () => true);
      text += page.data;
      id = page.nextPageId;
    }
    expect(text).toBe(await adapters.readNote());
    service.dispose();
    expect(() => snapshot.manifest()).toThrow();
  });
  it.each(['../x.md', 'Notes/../x.md', 'Notes/.obsidian/x.md', 'Notes/secrets/x.md', 'Notes2/a.md', 'Notes/a\\b.md'])('rejects unsafe graph seed %s before enumeration', async path => {
    const { service, adapters } = fixture();
    await expect(service.graph(path)).rejects.toThrow();
    expect(adapters.graph).not.toHaveBeenCalled();
  });
  it('aborts pending consent without later reads', async () => {
    const { service, adapters, approve, controller } = fixture();
    let resolve!: (value: boolean) => void;
    approve.mockImplementation(() => new Promise<boolean>(r => { resolve = r; }));
    const pending = service.recall(['apple']);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow();
    resolve(true);
    await Promise.resolve();
    expect(adapters.memories).not.toHaveBeenCalled();
  });
  it('fails closed on oversized graph and strict query caps', async () => {
    const { service, adapters } = fixture();
    adapters.graph.mockResolvedValue(Array.from({ length: 4097 }, () => ['Notes/a.md', 'Notes/b.md']));
    await expect(service.graph('Notes/a.md')).rejects.toThrow();
    await expect(service.recall(['../secret'])).rejects.toThrow();
    expect((await service.recall([])).items).toEqual([]);
    expect(adapters.memories).not.toHaveBeenCalled();
  });
  it('rejects late memory completion after disposal and never publishes metadata', async () => {
    const { service, adapters, approve } = fixture();
    let resolve!: (notes: Awaited<ReturnType<typeof adapters.memories>>) => void;
    adapters.memories.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = service.recall(['apple']);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(adapters.memories).toHaveBeenCalledTimes(1);
    service.dispose();
    await expect(pending).rejects.toThrow();
    resolve([]);
    await Promise.resolve();
    expect(approve).toHaveBeenCalledTimes(1);
  });
  it('denies selected note reads and rejects escaped memory loader results', async () => {
    const { service, adapters, approve } = fixture();
    const result = await service.graph('Notes/a.md');
    approve.mockResolvedValue(false);
    await expect(service.snapshot([result.items[0].id])).rejects.toThrow();
    expect(adapters.readNote).not.toHaveBeenCalled();
    approve.mockResolvedValue(true);
    adapters.memories.mockResolvedValue([{ path: '.claudian/settings.md', topic: 'apple', content: 'apple', tags: [], mtime: 1 }]);
    await expect(service.recall(['apple'])).rejects.toThrow();
  });
  it('keeps backlink direction separate from outgoing edges', async () => {
    const { service } = fixture();
    expect((await service.graph('Notes/c.md', 'backlinks')).items).toEqual([]);
    expect((await service.graph('Notes/c.md', 'outgoing')).items.map(item => item.path)).toEqual(['Notes/a.md']);
  });
  it('requires metadata egress approval and exact selected path read permission', async () => {
    const { service, approve, adapters } = fixture();
    approve.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(service.graph('Notes/a.md')).rejects.toThrow();
    expect(adapters.readNote).not.toHaveBeenCalled();
    await expect(service.snapshot(['model-chosen-path'])).rejects.toThrow();
  });
});
