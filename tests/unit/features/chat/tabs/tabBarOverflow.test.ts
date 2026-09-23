import { measureTabStripOverflow, scrollLeftToReveal } from '@/features/chat/tabs/tabBarOverflow';

// Nine 40px badges with 6px gaps: 0, 46, 92, ... 368 (last ends at 408).
const badges = Array.from({ length: 9 }, (_, index) => ({ id: `tab-${index + 1}`, left: index * 46, width: 40 }));

describe('measureTabStripOverflow', () => {
  it('reports nothing when every badge fits', () => {
    const result = measureTabStripOverflow({ scrollLeft: 0, clientWidth: 420, scrollWidth: 408 }, badges);
    expect(result).toEqual({ hiddenIds: [], canScrollStart: false, canScrollEnd: false });
  });

  it('counts badges scrolled out at the end', () => {
    const result = measureTabStripOverflow({ scrollLeft: 0, clientWidth: 210, scrollWidth: 408 }, badges);
    // 0..210 shows tab 1-4 fully and 26px (more than half) of tab 5.
    expect(result.hiddenIds).toEqual(['tab-6', 'tab-7', 'tab-8', 'tab-9']);
    expect(result.canScrollStart).toBe(false);
    expect(result.canScrollEnd).toBe(true);
  });

  it('counts badges on both sides when scrolled into the middle', () => {
    const result = measureTabStripOverflow({ scrollLeft: 92, clientWidth: 184, scrollWidth: 408 }, badges);
    expect(result.hiddenIds).toEqual(['tab-1', 'tab-2', 'tab-7', 'tab-8', 'tab-9']);
    expect(result.canScrollStart).toBe(true);
    expect(result.canScrollEnd).toBe(true);
  });
});

describe('scrollLeftToReveal', () => {
  const strip = { scrollLeft: 0, clientWidth: 200, scrollWidth: 408 };

  it('leaves a visible badge where it is', () => {
    expect(scrollLeftToReveal(strip, badges[1], 16)).toBeNull();
  });

  it('scrolls just far enough to show a badge past the end, clear of the fade', () => {
    expect(scrollLeftToReveal(strip, badges[5], 16)).toBe(230 + 40 + 16 - 200);
  });

  it('never scrolls past the end of the strip', () => {
    expect(scrollLeftToReveal(strip, badges[8], 16)).toBe(408 - 200);
  });

  it('scrolls back to show a badge before the start', () => {
    expect(scrollLeftToReveal({ ...strip, scrollLeft: 300 }, badges[2], 16)).toBe(92 - 16);
    expect(scrollLeftToReveal({ ...strip, scrollLeft: 300 }, badges[0], 16)).toBe(0);
  });
});
