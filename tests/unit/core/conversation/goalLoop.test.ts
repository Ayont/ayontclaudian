import {
  buildGoalContinuationPrompt,
  buildGoalLoopDirective,
  buildGoalVerificationPrompt,
  describeGoalLoopOutcome,
  detectGoalMarker,
  GOAL_CONTINUE_MARKER,
  GOAL_DONE_MARKER,
  GOAL_LOOP_ITERATION_CEILING,
  type GoalVerdict,
  isStalledIteration,
  normalizeGoalLoopIterations,
  parseGoalVerdict,
  stripGoalLoopMarkers,
  summarizeIterationWork,
} from '../../../../src/core/conversation/goalLoop';

describe('detectGoalMarker', () => {
  test('detects the done marker on the last line', () => {
    expect(detectGoalMarker(`Fertig implementiert.\n\n${GOAL_DONE_MARKER}`)).toBe('done');
  });

  test('detects the continue marker on the last line', () => {
    expect(detectGoalMarker(`Noch offen.\n${GOAL_CONTINUE_MARKER}`)).toBe('continue');
  });

  test('ignores a marker mentioned mid-explanation', () => {
    const text = `Ich schreibe am Ende ${GOAL_DONE_MARKER}, wenn ich fertig bin.\n\nSchritt 1 …\nSchritt 2 …\nSchritt 3 …\nSchritt 4 …`;
    expect(detectGoalMarker(text)).toBeNull();
  });

  test('tolerates markdown decoration around the marker', () => {
    expect(detectGoalMarker(`Arbeit erledigt.\n\n**${GOAL_DONE_MARKER}**`)).toBe('done');
  });

  test('returns null when no marker is present', () => {
    expect(detectGoalMarker('Kein Marker hier.')).toBeNull();
  });
});

describe('parseGoalVerdict', () => {
  test('parses a plain JSON verdict', () => {
    const verdict = parseGoalVerdict('{"done": true, "reason": "alles da", "nextStep": "", "confidence": 0.9}');
    expect(verdict).toEqual({ done: true, reason: 'alles da', nextStep: '', confidence: 0.9 });
  });

  test('parses JSON wrapped in a code fence and prose', () => {
    const raw = 'Hier mein Urteil:\n```json\n{"done": false, "reason": "Tests fehlen", "nextStep": "Tests schreiben", "confidence": 0.4}\n```\nEnde.';
    expect(parseGoalVerdict(raw)?.nextStep).toBe('Tests schreiben');
  });

  test('does not break on braces inside strings', () => {
    const raw = '{"done": false, "reason": "Objekt {a} fehlt", "nextStep": "", "confidence": 0.2}';
    expect(parseGoalVerdict(raw)?.reason).toBe('Objekt {a} fehlt');
  });

  test('clamps out-of-range confidence', () => {
    expect(parseGoalVerdict('{"done": true, "confidence": 7}')?.confidence).toBe(1);
    expect(parseGoalVerdict('{"done": true, "confidence": -3}')?.confidence).toBe(0);
  });

  test('returns null when done is missing or output is unusable', () => {
    expect(parseGoalVerdict('{"reason": "keine Ahnung"}')).toBeNull();
    expect(parseGoalVerdict('völliger Unsinn')).toBeNull();
    expect(parseGoalVerdict('')).toBeNull();
  });
});

describe('stripGoalLoopMarkers', () => {
  test('removes markers and the directive block', () => {
    const raw = `${buildGoalLoopDirective('Ziel X', 1, 5)}\n\nEchte Antwort.\n\n${GOAL_CONTINUE_MARKER}`;
    expect(stripGoalLoopMarkers(raw)).toBe('Echte Antwort.');
  });
});

describe('summarizeIterationWork', () => {
  test('keeps the most recent work when truncating', () => {
    const excerpt = summarizeIterationWork(`${'a'.repeat(200)}ENDE`, 20);
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('ENDE')).toBe(true);
  });
});

describe('isStalledIteration', () => {
  test('flags identical consecutive output', () => {
    expect(isStalledIteration('gleiche Arbeit', '  gleiche   Arbeit  ')).toBe(true);
  });

  test('flags empty output', () => {
    expect(isStalledIteration('etwas', '   ')).toBe(true);
  });

  test('does not flag genuine progress', () => {
    expect(isStalledIteration('Schritt 1', 'Schritt 2')).toBe(false);
  });

  test('does not flag the first iteration', () => {
    expect(isStalledIteration('', 'Schritt 1')).toBe(false);
  });
});

describe('normalizeGoalLoopIterations', () => {
  test('falls back for non-numeric input', () => {
    expect(normalizeGoalLoopIterations(undefined)).toBeGreaterThan(0);
    expect(normalizeGoalLoopIterations('viele')).toBeGreaterThan(0);
  });

  test('clamps to the supported range', () => {
    expect(normalizeGoalLoopIterations(0)).toBe(1);
    expect(normalizeGoalLoopIterations(9999)).toBe(GOAL_LOOP_ITERATION_CEILING);
  });
});

describe('prompt builders', () => {
  test('the directive names both markers and the iteration position', () => {
    const directive = buildGoalLoopDirective('Ziel X', 2, 6);
    expect(directive).toContain('2/6');
    expect(directive).toContain(GOAL_DONE_MARKER);
    expect(directive).toContain(GOAL_CONTINUE_MARKER);
  });

  test('the verifier prompt is adversarial and carries the goal', () => {
    const prompt = buildGoalVerificationPrompt('Ziel X', 'etwas Arbeit');
    expect(prompt).toContain('Ziel X');
    expect(prompt).toContain('Im Zweifel');
  });

  test('the continuation prompt carries what is missing and the next step', () => {
    const verdict: GoalVerdict = { done: false, reason: 'Tests fehlen', nextStep: 'Tests schreiben', confidence: 0.3 };
    const prompt = buildGoalContinuationPrompt('Ziel X', verdict, 3, 8);
    expect(prompt).toContain('Tests fehlen');
    expect(prompt).toContain('Tests schreiben');
    expect(prompt).toContain('3/8');
  });

  test('the continuation prompt works without a verdict', () => {
    expect(buildGoalContinuationPrompt('Ziel X', null, 2, 4)).toContain('Ziel X');
  });
});

describe('describeGoalLoopOutcome', () => {
  test('reports success with a singular iteration label', () => {
    expect(describeGoalLoopOutcome('achieved', 1)).toContain('1 Durchlauf');
  });

  test('reports the cap and the stall distinctly', () => {
    expect(describeGoalLoopOutcome('max-iterations', 8)).toContain('Maximale Durchläufe');
    expect(describeGoalLoopOutcome('stalled', 3)).toContain('Kein Fortschritt');
  });
});
