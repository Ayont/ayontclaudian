/**
 * Prompt expansions for everyday visual and office deliverables.
 * Used by Work-mode starters and slash commands.
 */

export function buildAngebotPrompt(brief = ''): string {
  const notes = brief.trim();
  return [
    'Erstelle ein Kundenangebot als Live-Dokument (claudian-document) mit theme: word — es soll aussehen wie ein in Word getipptes Angebot, nicht wie ein Magazin.',
    '',
    'Pflichtabschnitte:',
    '## Leistungsbeschreibung',
    '## Positionen (Tabelle: Pos., Leistung, Menge, Einzelpreis, Gesamt)',
    '## Konditionen und Gültigkeit',
    '## Annahmen / nicht enthalten',
    '',
    'Keine Firmen- oder Kundennamen erfinden. Fehlendes als [To be completed]. Preise nur wenn der User sie nennt.',
    notes ? `Briefing:\n${notes}` : 'Falls Details fehlen, frage kurz nach Leistung, Menge und Preisrahmen, dann schreibe den Entwurf.',
  ].join('\n');
}

export function buildMindmapPrompt(topic = ''): string {
  const subject = topic.trim() || 'das genannte Thema';
  return [
    `Zeichne eine Mindmap zu: ${subject}`,
    '',
    'Gib genau einen Mermaid-Block aus (Obsidian rendert ihn live):',
    '```mermaid',
    'mindmap',
    '  root((Thema))',
    '    Zweig A',
    '      Blatt',
    '    Zweig B',
    '```',
    '',
    'Kurz und lesbar, max. 3 Ebenen, deutsche Labels. Kein Draw.io-XML. Prosa nur als kurze Legende außerhalb des Blocks.',
  ].join('\n');
}

export function buildDiagramPrompt(topic = ''): string {
  const subject = topic.trim() || 'den beschriebenen Prozess';
  return [
    `Zeichne ein Prozess- oder Strukturdiagramm für: ${subject}`,
    '',
    'Gib genau einen Mermaid-flowchart (oder sequenceDiagram, wenn es um Abläufe zwischen Rollen geht):',
    '```mermaid',
    'flowchart TD',
    '  A[Start] --> B[Schritt]',
    '  B --> C[Ergebnis]',
    '```',
    '',
    'Deutsche Knotenbeschriftungen, wenige Knoten, keine erfundenen Firmennamen. Für Netzwerk-Topologie stattdessen network-map verwenden.',
  ].join('\n');
}
