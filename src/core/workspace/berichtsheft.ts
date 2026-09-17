/**
 * IHK-style weekly report (Ausbildungsnachweis / Berichtsheft) prompt.
 *
 * Pure expansion: the chat slash command, Work-mode starter, and tests all
 * call this. The agent writes vault-ready German Markdown; we never invent
 * an employer or school name.
 */

const REQUIRED_SECTIONS = [
  'Kalenderwoche',
  'Betrieb',
  'Berufsschule',
  'Tätigkeiten',
  'Stunden',
] as const;

export const BERICHTSHEFT_REQUIRED_SECTIONS: readonly string[] = REQUIRED_SECTIONS;

/**
 * Expands optional incident / week notes into the Berichtsheft writing prompt.
 * Empty input still asks for a complete weekly report so `/berichtsheft` works
 * with no arguments.
 */
export function buildBerichtsheftPrompt(incidentSnippet = ''): string {
  const notes = incidentSnippet.trim();
  const notesBlock = notes
    ? `Rohnotizen / Vorfall dieser Woche:\n${notes}`
    : 'Es liegen noch keine Rohnotizen vor. Frage kurz nach Kalenderwoche und den wichtigsten Tätigkeiten, dann schreibe den Entwurf.';

  return [
    'Schreibe einen IHK-Ausbildungsnachweis (Berichtsheft, wöchentlich) als vault-fertiges deutsches Markdown.',
    '',
    'Pflichtabschnitte mit genau diesen Überschriften:',
    '## Kalenderwoche',
    'KW-Nummer und Zeitraum (von–bis).',
    '## Betrieb',
    'Tätigkeiten und Lernziele im Ausbildungsbetrieb. Keinen Firmennamen erfinden.',
    '## Berufsschule',
    'Unterrichtsthemen der Woche. Keinen Schulnamen erfinden.',
    '## Tätigkeiten',
    'Konkrete Arbeitsschritte, Störungen, Tickets, Diagnosen — lernzielbezogen, erste Person, sachlich.',
    '## Stunden',
    'Stunden im Betrieb, in der Berufsschule und Summe.',
    '',
    notesBlock,
    '',
    'Stil: prüfungsfest, kurz, ohne Floskeln. Speichere nichts als PDF — nur Markdown.',
  ].join('\n');
}
