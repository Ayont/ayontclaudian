import { neutralizeNonMathDollars } from '@/utils/markdownMath';

/**
 * Pasted terminal sessions are the single most common thing in this product,
 * and shell uses `$` constantly. Rendering `$(sudo …)` … `$VAL` as one inline
 * math span flips the whole command into a serif italic math font and lets it
 * run out of the message box — the text stops being a command and stops being
 * readable.
 *
 * Real math still has to survive: the escape is targeted at shell syntax, not
 * at every dollar.
 */
describe('neutralizeNonMathDollars', () => {
  const rendersAsMath = (markdown: string): boolean =>
    neutralizeNonMathDollars(markdown) === markdown;

  describe('shell syntax is never math', () => {
    it.each([
      'VAL=$(sudo -u postgres psql -At -d database_single -c "select value from parameter")',
      '[ "$VAL" = "30" ] || echo "ALARM: FAX_PCMU_T38_FALLBACK_TIMEOUT steht auf $VAL statt 30"',
      'printf "%-22s %s\\n" "$p" "$(sed -n \'/^2026-09-09 14:48/p\' /var/log/x.log | grep -c "$p")"',
      'echo "${HOME}/bin"',
      'for p in "Probing voice" "VOICE Received"; do echo "$p"; done',
    ])('neutralizes: %s', (line) => {
      expect(rendersAsMath(line)).toBe(false);
    });

    it('escapes every shell dollar on the line, not just the first', () => {
      const out = neutralizeNonMathDollars('echo "$A" and "$B"');

      expect(out).toBe('echo "\\$A" and "\\$B"');
    });
  });

  describe('real math still renders', () => {
    it.each([
      'Die Formel $E = mc^2$ ist bekannt.',
      'Sei $x$ die Anzahl der Zeilen.',
      'Wir erhalten $\\frac{a}{b}$ als Ergebnis.',
      '$$\n\\sum_{i=1}^{n} i\n$$',
    ])('leaves untouched: %s', (markdown) => {
      expect(rendersAsMath(markdown)).toBe(true);
    });
  });

  describe('code stays code', () => {
    it('never touches a fenced block', () => {
      const markdown = '```bash\nVAL=$(echo hi)\necho "$VAL"\n```';

      expect(rendersAsMath(markdown)).toBe(true);
    });

    it('never touches an inline code span', () => {
      const markdown = 'Setze `export VAL=$(id -u)` und fertig.';

      expect(rendersAsMath(markdown)).toBe(true);
    });
  });

  it('leaves text without any dollar completely alone', () => {
    const markdown = 'Ganz normaler Satz ohne Sonderzeichen.';

    expect(neutralizeNonMathDollars(markdown)).toBe(markdown);
  });
});
