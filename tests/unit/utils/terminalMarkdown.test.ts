import { neutralizeTerminalMarkdown } from '@/utils/markdownTerminalText';

/**
 * Terminal and PowerShell output is pasted into this product constantly, and
 * two of its most ordinary decorations collide with Markdown:
 *
 *   === Aenderung wird angewendet ===   →  ==…== is Obsidian's highlight, so the
 *                                          banner came out yellow with a stray
 *                                          `=` left on each side
 *   -------- ----------- ------          →  a table rule became a horizontal line
 *
 * Both are unambiguous: highlight uses exactly two `=`, and a real Markdown rule
 * is one unbroken run of `-`.
 */
describe('neutralizeTerminalMarkdown', () => {
  const survivesUnchanged = (markdown: string): boolean =>
    neutralizeTerminalMarkdown(markdown) === markdown;

  describe('banner lines stop turning yellow', () => {
    it.each([
      '=== Aenderung wird angewendet ===',
      '=== Verifikation ===',
      '===== Aktuelle Foederationskonfiguration =====',
      'Ausgabe: === Verbindung zu Microsoft Teams ===',
    ])('neutralizes: %s', (line) => {
      expect(survivesUnchanged(line)).toBe(false);
    });

    it('renders the banner with all of its equals signs intact', () => {
      const out = neutralizeTerminalMarkdown('=== Verifikation ===');

      expect(out).toBe('\\=\\=\\= Verifikation \\=\\=\\=');
    });
  });

  describe('real highlight still works', () => {
    it.each([
      'Das ist ==wichtig== fuer uns.',
      '==Nur Markiertes==',
      'a == b ist ein Vergleich',
    ])('leaves untouched: %s', (markdown) => {
      expect(survivesUnchanged(markdown)).toBe(true);
    });
  });

  describe('PowerShell table rules stop becoming horizontal lines', () => {
    it('neutralizes a multi-column rule', () => {
      expect(survivesUnchanged('-------- ----------- ------')).toBe(false);
    });

    it('leaves a genuine Markdown rule alone', () => {
      expect(survivesUnchanged('---')).toBe(true);
      expect(survivesUnchanged('-----')).toBe(true);
    });

    it('leaves a Markdown table delimiter row alone', () => {
      expect(survivesUnchanged('| --- | --- |')).toBe(true);
    });

    it('leaves list items alone', () => {
      expect(survivesUnchanged('- erster Punkt')).toBe(true);
    });
  });

  describe('code stays code', () => {
    it('never touches a fenced block', () => {
      const markdown = '```powershell\n=== Verifikation ===\n-------- ------\n```';

      expect(survivesUnchanged(markdown)).toBe(true);
    });

    it('never touches an inline code span', () => {
      expect(survivesUnchanged('Schreibe `=== Titel ===` in die Datei.')).toBe(true);
    });
  });

  it('leaves ordinary prose completely alone', () => {
    const markdown = 'Ganz normaler Satz ohne Sonderzeichen.';

    expect(neutralizeTerminalMarkdown(markdown)).toBe(markdown);
  });
});
