import {
  escapeMathDelimitersForStreaming,
  hasStreamingMathDelimiters,
} from '@/utils/markdownMath';

describe('markdownMath', () => {
  describe('escapeMathDelimitersForStreaming', () => {
    it('escapes inline and display math delimiters outside code', () => {
      expect(escapeMathDelimitersForStreaming('Use $x + y$ and $$z^2$$.')).toBe(
        'Use \\$x + y\\$ and \\$\\$z^2\\$\\$.'
      );
    });

    it('preserves inline code and fenced code dollars', () => {
      const markdown = [
        'Text $x$',
        '`echo $PATH`',
        '```bash',
        'echo "$HOME"',
        '```',
        'Done $$y$$',
      ].join('\n');

      expect(escapeMathDelimitersForStreaming(markdown)).toBe([
        'Text \\$x\\$',
        '`echo $PATH`',
        '```bash',
        'echo "$HOME"',
        '```',
        'Done \\$\\$y\\$\\$',
      ].join('\n'));
    });

    it('keeps already escaped dollars unchanged', () => {
      expect(escapeMathDelimitersForStreaming('Cost is \\$5, math is $x$.')).toBe(
        'Cost is \\$5, math is \\$x\\$.'
      );
    });

    it('does not alter dollars inside raw html tag attributes', () => {
      expect(escapeMathDelimitersForStreaming('<span title="$x$">value $y$</span>')).toBe(
        '<span title="$x$">value \\$y\\$</span>'
      );
    });

    it('passes dollars inside an unclosed fence through untouched', () => {
      const markdown = 'Before\n```\n$x$';
      expect(escapeMathDelimitersForStreaming(markdown)).toBe(markdown);
    });
  });

  describe('hasStreamingMathDelimiters', () => {
    it('detects unescaped dollars outside code', () => {
      expect(hasStreamingMathDelimiters('math $x$')).toBe(true);
      expect(hasStreamingMathDelimiters('`echo $PATH`')).toBe(false);
      expect(hasStreamingMathDelimiters('\\$5')).toBe(false);
    });

    it('ignores dollars inside fenced code blocks', () => {
      expect(hasStreamingMathDelimiters('```js\nconst a = $x;\n```')).toBe(false);
      expect(hasStreamingMathDelimiters('~~~\n$x$\n~~~')).toBe(false);
      expect(hasStreamingMathDelimiters('```\n$x$')).toBe(false);
    });

    it('detects dollars once the fence is closed', () => {
      expect(hasStreamingMathDelimiters('```\n$x$\n```\n$y$')).toBe(true);
    });

    it('agrees with the escape output on every fixture', () => {
      // The decision helper used to be implemented as escape-and-compare; the
      // cheap scan must answer exactly what that comparison answered.
      const fixtures = [
        'Use $x + y$ and $$z^2$$.',
        [
          'Text $x$',
          '`echo $PATH`',
          '```bash',
          'echo "$HOME"',
          '```',
          'Done $$y$$',
        ].join('\n'),
        'Cost is \\$5, math is $x$.',
        '<span title="$x$">value $y$</span>',
        'math $x$',
        '`echo $PATH`',
        '\\$5',
        'no dollars at all',
        '',
        '``code`` $x$',
        '`` $x ``',
        '```js\nconst a = $x;\n```',
        '```\n$x$\n```\n$y$',
      ];

      for (const fixture of fixtures) {
        expect(hasStreamingMathDelimiters(fixture)).toBe(
          escapeMathDelimitersForStreaming(fixture) !== fixture
        );
      }
    });
  });
});
