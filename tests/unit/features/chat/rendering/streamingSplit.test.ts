import { findStableMarkdownSplit } from '@/features/chat/rendering/streamingSplit';

describe('findStableMarkdownSplit', () => {
  it('returns no split for content below the engagement threshold', () => {
    expect(findStableMarkdownSplit('Kurze Antwort.', { minStable: 100, minTail: 20 })).toBe(0);
  });

  it('splits after a blank line that starts a new paragraph', () => {
    const stable = `${'Erster Absatz. '.repeat(20)}\n\n`;
    const tail = 'Zweiter Absatz, noch im Fluss';
    const markdown = stable + tail;

    expect(findStableMarkdownSplit(markdown, { minStable: 50, minTail: 10 })).toBe(stable.length);
  });

  it('never splits inside an open code fence', () => {
    const markdown = [
      'Hier ist Code:',
      '',
      '```ts',
      'const a = 1;',
      '',
      'const b = 2;',
      '',
      'const c = 3;',
    ].join('\n');

    // The only safe boundary is the blank line before the fence opens.
    const split = findStableMarkdownSplit(markdown, { minStable: 5, minTail: 5 });
    expect(split).toBeLessThanOrEqual(markdown.indexOf('```ts'));
  });

  it('splits after a closed fence', () => {
    const stable = 'Text davor.\n\n```ts\nconst a = 1;\n```\n\n';
    const tail = 'Und der Fließtext danach geht weiter und weiter.';
    const markdown = stable + tail;

    expect(findStableMarkdownSplit(markdown, { minStable: 10, minTail: 10 })).toBe(stable.length);
  });

  it('does not split when the stable side would end inside a list', () => {
    const markdown = [
      '- erster Punkt',
      '',
      '- zweiter Punkt',
      '',
      '- dritter Punkt, noch im Fluss',
    ].join('\n');

    expect(findStableMarkdownSplit(markdown, { minStable: 5, minTail: 5 })).toBe(0);
  });

  it('does not split when the stable side would end inside a table', () => {
    const markdown = [
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '| 3 | 4 |',
    ].join('\n');

    expect(findStableMarkdownSplit(markdown, { minStable: 5, minTail: 5 })).toBe(0);
  });

  it('does not split when the stable side would end inside a blockquote', () => {
    const markdown = '> Zitat Zeile eins\n\n> Zitat Zeile zwei und mehr Text';

    expect(findStableMarkdownSplit(markdown, { minStable: 5, minTail: 5 })).toBe(0);
  });

  it('keeps at least minTail characters unsplit so the live edge stays re-renderable', () => {
    const markdown = `${'Absatz eins. '.repeat(20)}\n\nkurz`;

    expect(findStableMarkdownSplit(markdown, { minStable: 10, minTail: 50 })).toBe(0);
  });

  it('prefers the latest safe boundary', () => {
    const first = `${'A'.repeat(60)}\n\n`;
    const second = `${'B'.repeat(60)}\n\n`;
    const markdown = `${first}${second}${'C'.repeat(60)}`;

    expect(findStableMarkdownSplit(markdown, { minStable: 10, minTail: 10 }))
      .toBe(first.length + second.length);
  });

  it('is monotonic: growing the tail never moves the boundary backwards', () => {
    const base = `${'Absatz. '.repeat(30)}\n\nlaufender Text`;
    const grown = `${base} der immer weiter waechst und waechst`;

    const firstSplit = findStableMarkdownSplit(base, { minStable: 20, minTail: 10 });
    const secondSplit = findStableMarkdownSplit(grown, { minStable: 20, minTail: 10 });

    expect(secondSplit).toBeGreaterThanOrEqual(firstSplit);
  });
});
