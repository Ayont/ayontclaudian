import { ClineCallFill } from '@/providers/cline/runtime/callFill';

describe('ClineCallFill', () => {
  it('is the latest call\'s prompt, not the sum over the run', () => {
    const fill = new ClineCallFill();
    fill.startCall();
    fill.addUsage({ inputTokens: 500, cacheReadTokens: 100_000, cacheWriteTokens: 2_000 });
    fill.startCall();
    fill.addUsage({ inputTokens: 300, cacheReadTokens: 102_000 });
    fill.addUsage({ inputTokens: 40 });

    expect(fill.latest()).toBe(102_340);
  });

  it('reports nothing when the run had no per-call usage', () => {
    expect(new ClineCallFill().latest()).toBe(0);
  });
});
