import {
  applyTurnOutputContract,
  asksForMermaidGuidance,
  buildTurnOutputContract,
  resolveTurnOutputSurface,
} from '@/core/prompt/mainAgent';

describe('turn output contract', () => {
  // A user weighing up what to do next is asking for advice, not for the
  // deliverable. Opening the e-mail editor on "soll ich die Mail schon
  // schreiben?" buries a one-line answer in a 200-word draft nobody asked for.
  it.each([
    'Soll ich jetzt schon die Mail schreiben, oder erst die Logs prüfen und dann die Mail mit dem neuen Termin anlegen?',
    'Schreibe ich die Mail jetzt, oder soll ich erst messen?',
    'Soll ich dem Kunden direkt antworten?',
    'Sollte ich dazu ein Dokument anlegen?',
    'Should I send the email now or check the logs first?',
    'Was meinst du, Mail jetzt oder morgen?',
    'Würdest du dem Kunden jetzt eine Antwort schreiben?',
    'Macht es Sinn, dafür einen Bericht zu erstellen?',
  ])('keeps a deliberation question in chat: %s', (text) => {
    expect(resolveTurnOutputSurface(text, undefined, { workspaceMode: 'work' })).toBe('chat');
  });

  it('still produces the deliverable when actually instructed to', () => {
    expect(resolveTurnOutputSurface(
      'Schreib die Mail an Thorsten mit dem neuen Termin.',
      undefined,
      { workspaceMode: 'work' },
    )).toBe('email');
  });

  it('an explicit surface command still wins over a question', () => {
    expect(resolveTurnOutputSurface('Soll ich das so schreiben?', 'email', { workspaceMode: 'work' }))
      .toBe('email');
  });

  it('keeps ordinary engineering requests in chat even when they mention renderer features', () => {
    const text = 'Behebe das Dokument-System, den network-map Renderer und verwende die passenden Skills.';

    expect(resolveTurnOutputSurface(text)).toBe('chat');
  });

  it.each([
    'Beschreibe den Fehler im Dokument-System.',
    'Fixe den FortiGate-Renderer im Code.',
    'Erkläre den Firewall-Parser.',
    'Erstelle Tests für den Image-Renderer.',
    'Was ist eine Firewall?',
    'Erkläre mir VLANs.',
    'Was unterscheidet Router und Switch?',
    'Warum ist die Antwort des Kunden unklar?',
    'Fasse die E-Mail zusammen.',
    'Wie erstelle ich ein Angebot?',
    'Erkläre mir, wie ich einen Projektbericht schreibe.',
    'How do I write a proposal?',
    'Irgendwann: DNS geht nicht.',
    // Compounds and substrings that used to hijack the surface (5.102 bug: "aus
    // dem Nichts wird eine E-Mail / ein Word-Dokument").
    'Erstelle die E-Mail-Validierung im Signup-Formular.',
    'Baue ein Image-Upload-Feature für Avatare.',
    'Mach weiter und passe den Bildschirm-Screenshot-Flow an.',
    'Write a brief summary of what changed in this PR.',
    'The user reported that the dialog was closed too early. Erstelle einen Fix.',
    'Erstelle eine Zusammenfassung der Änderungen.',
    'Mach mir eine Notiz in die Datei.',
    'Erstelle die Dokumentation für die API-Endpoints.',
    'Beantworte die Frage vom Kunden: warum ist der Build rot?',
    'Erstelle ein Logo-Component in React.',
    'Erstelle eine Visualisierung der Testabdeckung im Terminal.',
  ])('does not mistake engineering or diagnostic language for a rich artifact: %s', (text) => {
    expect(resolveTurnOutputSurface(text, undefined, { workspaceMode: 'work' })).toBe('chat');
    expect(resolveTurnOutputSurface(text)).toBe('chat');
  });

  it.each([
    ['Erstelle ein strukturiertes Angebot für den Kunden.', 'live-document'],
    ['Schreibe eine freundliche E-Mail an den Kunden.', 'email'],
    ['Antworte dem Kunden höflich.', 'email'],
    ['Formuliere eine Antwort für den Kunden.', 'email'],
    ['Erzeuge ein Kampagnenbild für die Startseite.', 'image'],
    ['Erstelle einen Agent Skill für PDF-Formulare.', 'skill'],
    ['Analysiere FortiGate, VLAN 20 und den Core Switch.', 'network-map'],
    ['Schreib ein technisches Handbuch für den Renderer.', 'live-document'],
    ['Mach mir bitte ein Angebot für den Kunden.', 'live-document'],
    ['Generate an image for the campaign.', 'image'],
    ['LAN und WAN funktionieren nicht.', 'network-map'],
    ['Erstelle einen Bericht über den Ausfall gestern.', 'live-document'],
    ['Erstelle einen strukturierten Projektbericht.', 'live-document'],
    ['Schreib eine Mail an das Team wegen des Releases.', 'email'],
  ] as const)('routes %s to %s in work mode', (text, expected) => {
    expect(resolveTurnOutputSurface(text, undefined, { workspaceMode: 'work' })).toBe(expected);
  });

  it('keeps every inferred surface off in code mode; only explicit surfaces pass', () => {
    const code = { workspaceMode: 'code' } as const;
    expect(resolveTurnOutputSurface('Erstelle ein strukturiertes Angebot für den Kunden.', undefined, code)).toBe('chat');
    expect(resolveTurnOutputSurface('Schreibe eine freundliche E-Mail an den Kunden.', undefined, code)).toBe('chat');
    expect(resolveTurnOutputSurface('Erzeuge ein Kampagnenbild für die Startseite.', undefined, code)).toBe('chat');
    expect(resolveTurnOutputSurface('Analysiere FortiGate, VLAN 20 und den Core Switch.', undefined, code)).toBe('chat');
    // A /document, /email, … command still wins regardless of mode.
    expect(resolveTurnOutputSurface('Q3-Rollout', 'live-document', code)).toBe('live-document');
    expect(resolveTurnOutputSurface('Kunde X', 'email', code)).toBe('email');
  });

  it('applyTurnOutputContract honors the workspace mode when inferring the surface', () => {
    const text = 'Erstelle ein strukturiertes Angebot für den Kunden.';
    expect(applyTurnOutputContract({ text }, { workspaceMode: 'code' }).outputSurface).toBe('chat');
    expect(applyTurnOutputContract({ text }, { workspaceMode: 'work' }).outputSurface).toBe('live-document');
  });

  it('includes only the selected specialized surface manual', () => {
    const contract = buildTurnOutputContract({
      text: 'Erstelle einen Projektbericht.',
      outputSurface: 'live-document',
    }, { workspaceMode: 'work' });

    expect(contract).toContain('surface="live-document"');
    expect(contract).toContain('```claudian-document');
    expect(contract).not.toContain('```claudian-email');
    expect(contract).not.toContain('## Desktop Control');
    expect(contract).not.toContain('## Video Analysis');
  });

  it('lets an explicit surface override ambiguous short input', () => {
    const request = applyTurnOutputContract(
      { text: 'Q3-Rollout', outputSurface: 'live-document' },
      { workspaceMode: 'work' },
    );

    expect(request.outputSurface).toBe('live-document');
    expect(request.text).toContain('Q3-Rollout');
    expect(request.text).toContain('```claudian-document');
  });

  it('does not alter raw provider slash commands', () => {
    const request = { text: '/compact keep the decisions' };

    expect(applyTurnOutputContract(request, { workspaceMode: 'code' })).toEqual(request);
  });

  it('adds video guidance only when a video is actually referenced', () => {
    const withVideo = buildTurnOutputContract({
      text: 'Bitte analysieren.\n\n@.claudian/attachments/demo.mp4',
    }, { workspaceMode: 'work' });
    const ordinary = buildTurnOutputContract({ text: 'Erkläre Videocodecs.' }, { workspaceMode: 'work' });

    expect(withVideo).toContain('## Video Analysis');
    expect(ordinary).not.toContain('## Video Analysis');
  });

  it.each([
    ['Zeichne eine Mindmap zu VLANs', 'work'],
    ['Erklär den DHCP-Prozess', 'work'],
    ['Erklär den Ablauf von Autodiscover', 'work'],
    ['Skizziere die Architektur des Auth-Flows', 'code'],
  ] as const)('attaches mermaid guidance without a slash command: %s', (text, mode) => {
    expect(asksForMermaidGuidance(text, mode)).toBe(true);
    const contract = buildTurnOutputContract({ text }, { workspaceMode: mode });
    expect(contract).toContain('```mermaid');
    expect(resolveTurnOutputSurface(text, undefined, { workspaceMode: mode })).toBe('chat');
  });

  it('does not attach a mermaid manual to ordinary code review', () => {
    expect(asksForMermaidGuidance('Reviewe den aktuellen Code.', 'code')).toBe(false);
  });

  it.each([
    ['Schreib das Berichtsheft für KW 12', 'live-document'],
    ['Mach mir ein Arbeitsblatt zu Lernfeld 4', 'live-document'],
    ['Erstelle den Ausbildungsnachweis für diese Woche', 'live-document'],
  ] as const)('opens a live document from ordinary Work wording: %s', (text, expected) => {
    expect(resolveTurnOutputSurface(text, undefined, { workspaceMode: 'work' })).toBe(expected);
    expect(resolveTurnOutputSurface(text, undefined, { workspaceMode: 'code' })).toBe('chat');
  });

  it('keeps the ordinary per-turn contract compact', () => {
    const contract = buildTurnOutputContract(
      { text: 'Reviewe den aktuellen Code.' },
      { workspaceMode: 'code' },
    );

    expect(contract.length).toBeLessThan(800);
  });

  it.each([
    ['live-document', 'Erstelle einen Projektbericht.', 2_200],
    ['email', 'Schreibe eine E-Mail an den Kunden.', 1_800],
    ['network-map', 'Analysiere FortiGate und VLAN 20.', 1_700],
    ['image', 'Erzeuge ein Kampagnenbild.', 1_600],
    ['skill', 'Erstelle einen Agent Skill.', 1_800],
  ] as const)('keeps the %s surface manual bounded', (outputSurface, text, maxLength) => {
    const contract = buildTurnOutputContract({ text, outputSurface }, { workspaceMode: 'work' });

    expect(contract.length).toBeLessThan(maxLength);
  });
});
