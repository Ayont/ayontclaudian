import { getLastPerf, perfAsync, perfMark, perfSince } from '@/core/diagnostics/perfLog';

describe('perfLog', () => {
  it('perfMark returns a monotonic-ish timestamp', () => {
    const a = perfMark();
    const b = perfMark();
    expect(typeof a).toBe('number');
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it('perfSince stores the last measurement per key for /status (getLastPerf)', () => {
    const start = perfMark();
    perfSince(start, 'memory-recall', '3 matched, 14 notes');

    const record = getLastPerf('memory-recall');
    expect(record).toBeDefined();
    expect(typeof record!.ms).toBe('number');
    expect(record!.ms).toBeGreaterThanOrEqual(0);
    expect(record!.detail).toBe('3 matched, 14 notes');
  });

  it('getLastPerf returns undefined for an unseen key', () => {
    expect(getLastPerf('never-recorded')).toBeUndefined();
  });

  it('perfSince overwrites the previous measurement for the same key', () => {
    perfSince(perfMark(), 'memory-recall', 'first');
    perfSince(perfMark(), 'memory-recall', 'second');
    expect(getLastPerf('memory-recall')?.detail).toBe('second');
  });

  it('perfAsync runs the work and records the key', async () => {
    const result = await perfAsync('vault-rag', async () => 42, '3 chunks');
    expect(result).toBe(42);
    expect(getLastPerf('vault-rag')?.detail).toBe('3 chunks');
  });
});
