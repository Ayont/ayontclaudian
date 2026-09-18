import {
  buildToolOutputFileName,
  planToolOutputRendering,
  TOOL_OUTPUT_INLINE_CHAR_CAP,
  TOOL_OUTPUT_INLINE_LINE_CAP,
} from '@/features/chat/rendering/toolOutputOffload';

/**
 * A `bash` call that tails a log can return tens of thousands of lines. Mounting
 * those as one DOM node per line freezes the renderer and leaves the user
 * scrolling forever — so past a hard cap the output is never mounted in full;
 * it goes to a .txt in the vault instead.
 */
describe('planToolOutputRendering', () => {
  const lines = (count: number, text = 'line'): string[] =>
    Array.from({ length: count }, (_, index) => `${text} ${index}`);

  it('mounts a short output in full and offloads nothing', () => {
    const plan = planToolOutputRendering(lines(20));

    expect(plan.offloaded).toBe(false);
    expect(plan.renderableLines).toHaveLength(20);
    expect(plan.droppedLines).toBe(0);
  });

  it('caps a very long output instead of mounting every line', () => {
    const plan = planToolOutputRendering(lines(13_684));

    expect(plan.offloaded).toBe(true);
    expect(plan.renderableLines).toHaveLength(TOOL_OUTPUT_INLINE_LINE_CAP);
    expect(plan.droppedLines).toBe(13_684 - TOOL_OUTPUT_INLINE_LINE_CAP);
  });

  it('caps by characters too, so few-but-enormous lines cannot slip through', () => {
    const huge = [' '.repeat(TOOL_OUTPUT_INLINE_CHAR_CAP + 1)];

    const plan = planToolOutputRendering(huge);

    expect(plan.offloaded).toBe(true);
  });

  it('keeps the head of the output, which is where the useful part usually is', () => {
    const plan = planToolOutputRendering(lines(2_000));

    expect(plan.renderableLines[0]).toBe('line 0');
    expect(plan.renderableLines.at(-1)).toBe(`line ${TOOL_OUTPUT_INLINE_LINE_CAP - 1}`);
  });

  it('treats an output exactly at the cap as still mountable', () => {
    const plan = planToolOutputRendering(lines(TOOL_OUTPUT_INLINE_LINE_CAP));

    expect(plan.offloaded).toBe(false);
    expect(plan.droppedLines).toBe(0);
  });
});

describe('buildToolOutputFileName', () => {
  it('is readable, unique per call and always a .txt', () => {
    const first = buildToolOutputFileName('Bash', new Date('2026-09-18T11:50:00Z'), 'abc123');

    expect(first).toMatch(/^bash-2026-09-18-\d{4}-abc123\.txt$/);
  });

  it('sanitizes a tool name that would otherwise break the path', () => {
    const name = buildToolOutputFileName('mcp__foo/bar baz', new Date('2026-09-18T11:50:00Z'), 'x1');

    expect(name).not.toMatch(/[/\\ ]/);
    expect(name.endsWith('.txt')).toBe(true);
  });

  it('falls back to a generic name when the tool is unnamed', () => {
    const name = buildToolOutputFileName('', new Date('2026-09-18T11:50:00Z'), 'x1');

    expect(name.startsWith('tool-output-')).toBe(true);
  });
});
