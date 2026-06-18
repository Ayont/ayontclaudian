import { MetadataStore } from '../../../../../src/core/storage/metadata/MetadataStore';

interface TestRecord {
  id: string;
  name: string;
  score: number;
  [key: string]: unknown;
}

describe('MetadataStore', () => {
  async function createStore(initial = '{}'): Promise<MetadataStore> {
    let content = initial;
    return new MetadataStore(
      async () => content,
      async (value) => { content = value; },
    );
  }

  it('initializes empty when no data exists', async () => {
    const store = await createStore('');
    await store.initialize();
    expect(store.getAll('items')).toEqual([]);
  });

  it('reads existing data', async () => {
    const store = await createStore('{"version":1,"tables":{"items":{"records":{"a":{"id":"a","name":"A"}}}}}');
    await store.initialize();
    expect(store.get('items', 'a')).toEqual({ id: 'a', name: 'A' });
  });

  it('stores and retrieves records', async () => {
    const store = await createStore();
    await store.initialize();
    store.set<TestRecord>('items', { id: '1', name: 'One', score: 10 });
    await store.persist();
    expect(store.get<TestRecord>('items', '1')).toEqual({ id: '1', name: 'One', score: 10 });
  });

  it('queries with predicate and order', async () => {
    const store = await createStore();
    await store.initialize();
    store.set<TestRecord>('items', { id: '1', name: 'A', score: 10 });
    store.set<TestRecord>('items', { id: '2', name: 'B', score: 30 });
    store.set<TestRecord>('items', { id: '3', name: 'C', score: 20 });
    const results = store.query<TestRecord>('items', r => r.score > 15, { orderBy: 'score', order: 'desc', limit: 2 });
    expect(results.map(r => r.id)).toEqual(['2', '3']);
  });

  it('deletes records', async () => {
    const store = await createStore();
    await store.initialize();
    store.set<TestRecord>('items', { id: '1', name: 'One', score: 10 });
    store.delete('items', '1');
    expect(store.get('items', '1')).toBeUndefined();
  });
});
