import { createInlineThinkScrubber } from '@/utils/inlineThinkScrubber';

function run(deltas: string[]) {
  const scrubber = createInlineThinkScrubber();
  const out: Array<{ kind: 'text' | 'thinking'; content: string }> = [];
  for (const delta of deltas) out.push(...scrubber.feed(delta));
  out.push(...scrubber.flush());
  return out;
}

function join(parts: Array<{ kind: string; content: string }>, kind: string): string {
  return parts.filter((p) => p.kind === kind).map((p) => p.content).join('');
}

describe('createInlineThinkScrubber', () => {
  it('passes ordinary text through unchanged and in order', () => {
    const out = run(['Hallo ', 'Welt', '\n```ps\nls\n```']);
    expect(join(out, 'text')).toBe('Hallo Welt\n```ps\nls\n```');
    expect(join(out, 'thinking')).toBe('');
  });

  it('routes a complete <think> block to thinking', () => {
    const out = run(['<think>Ich überlege.</think>Antwort.']);
    expect(join(out, 'thinking')).toBe('Ich überlege.');
    expect(join(out, 'text')).toBe('Antwort.');
  });

  it('handles tags split across deltas (MiniMax / Kimi style)', () => {
    const out = run(['<thi', 'nk>Über', 'legung</thi', 'nk>\nAntwort']);
    expect(join(out, 'thinking')).toBe('Überlegung');
    expect(join(out, 'text')).toBe('\nAntwort');
  });

  it('streams thinking incrementally instead of buffering the whole block', () => {
    const scrubber = createInlineThinkScrubber();
    const first = scrubber.feed('<think>Teil eins ');
    expect(first).toEqual([{ kind: 'thinking', content: 'Teil eins ' }]);
    const second = scrubber.feed('Teil zwei</think>Text');
    expect(second).toEqual([
      { kind: 'thinking', content: 'Teil zwei' },
      { kind: 'text', content: 'Text' },
    ]);
  });

  it('accepts <thinking> and <reasoning> as aliases', () => {
    expect(join(run(['<thinking>a</thinking>b']), 'thinking')).toBe('a');
    expect(join(run(['<reasoning>a</reasoning>b']), 'text')).toBe('b');
  });

  it('leaves literal tags inside code fences alone', () => {
    const src = 'So sieht es aus:\n```xml\n<think>nicht denken</think>\n```\n';
    const out = run([src]);
    expect(join(out, 'text')).toBe(src);
    expect(join(out, 'thinking')).toBe('');
  });

  it('leaves inline-code tags alone', () => {
    const src = 'Der Tag `<think>` markiert Reasoning.';
    expect(join(run([src]), 'text')).toBe(src);
  });

  it('treats an unclosed block at end of stream as thinking, not lost text', () => {
    const out = run(['<think>nie geschlossen']);
    expect(join(out, 'thinking')).toBe('nie geschlossen');
    expect(join(out, 'text')).toBe('');
  });

  it('flushes a dangling partial tag as text when it turns out not to be a tag', () => {
    const out = run(['a <th', 'ree-way handshake']);
    expect(join(out, 'text')).toBe('a <three-way handshake');
  });

  it('drops a stray closing tag without an opener', () => {
    expect(join(run(['Antwort</think> weiter']), 'text')).toBe('Antwort weiter');
  });
});
