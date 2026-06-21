import { VectorStore } from '../../../../../src/core/intelligence/vectorStore/VectorStore';

function vector(dim: number, value: number): number[] {
  return new Array(dim).fill(value);
}

describe('VectorStore', () => {
  it('upserts and searches records', () => {
    const store = new VectorStore();
    store.upsert({ id: 'a', text: 'foo', embedding: vector(4, 1), metadata: {}, mtime: 1 });
    store.upsert({ id: 'b', text: 'bar', embedding: vector(4, -1), metadata: {}, mtime: 1 });

    const results = store.search(vector(4, 1), { limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].record.id).toBe('a');
    expect(results[0].score).toBeGreaterThan(0.99);
  });

  it('deletes records', () => {
    const store = new VectorStore();
    store.upsert({ id: 'a', text: 'foo', embedding: vector(4, 1), metadata: {}, mtime: 1 });
    store.delete('a');
    expect(store.size()).toBe(0);
  });

  it('serializes and loads', () => {
    const store = new VectorStore();
    store.upsert({ id: 'a', text: 'foo', embedding: vector(4, 1), metadata: {}, mtime: 1 });
    const serialized = store.serialize();

    const store2 = new VectorStore();
    store2.load(serialized);
    expect(store2.size()).toBe(1);
  });

  it('reports the embedding dimension and persists it in the envelope', () => {
    const store = new VectorStore();
    expect(store.dimension()).toBe(0);
    store.upsert({ id: 'a', text: 'foo', embedding: vector(768, 1), metadata: {}, mtime: 1 });
    expect(store.dimension()).toBe(768);

    const envelope = JSON.parse(store.serialize());
    expect(envelope.dimension).toBe(768);
    expect(Array.isArray(envelope.records)).toBe(true);
  });

  it('loads legacy bare-array indexes for backward compatibility', () => {
    const legacy = JSON.stringify([
      { id: 'a', text: 'foo', embedding: vector(4, 1), metadata: {}, mtime: 1 },
    ]);
    const store = new VectorStore();
    store.load(legacy);
    expect(store.size()).toBe(1);
  });
});
