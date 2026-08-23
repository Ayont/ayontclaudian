/**
 * Claudian - Goal loop primitives
 *
 * A standing goal (see {@link ./goalPrompt}) only survives across turns — it does
 * not make the agent keep working until the objective is actually reached. The
 * goal LOOP does: after each turn the runtime asks "is this goal achieved?", and
 * when the answer is no it feeds the agent a continuation turn derived from the
 * verdict's next step. The loop ends on an explicit completion marker, a verifier
 * verdict, a stall, or an iteration cap.
 *
 * Everything here is pure so the decision logic is testable without spawning a CLI.
 */

/** Marker the agent is asked to print when it considers the goal fully reached. */
export const GOAL_DONE_MARKER = 'GOAL_ACHIEVED';
/** Marker the agent is asked to print when work remains. */
export const GOAL_CONTINUE_MARKER = 'GOAL_CONTINUE';

/** Hard ceiling so a misbehaving verifier can never spin forever. */
export const GOAL_LOOP_ITERATION_CEILING = 50;
/** Default iterations when the provider setting is unset. */
export const DEFAULT_GOAL_LOOP_MAX_ITERATIONS = 8;
/** Work excerpt handed to the verifier — enough signal, bounded cost. */
const VERIFIER_EXCERPT_CHARS = 6000;

export interface GoalVerdict {
  /** True when the goal is considered fully achieved. */
  done: boolean;
  /** Short justification, surfaced to the user. */
  reason: string;
  /** Concrete next action when `done` is false. Empty when done. */
  nextStep: string;
  /** Verifier self-reported confidence, clamped to 0..1. */
  confidence: number;
}

export type GoalLoopStopReason =
  | 'achieved'
  | 'max-iterations'
  | 'stalled'
  | 'cancelled'
  | 'paused'
  | 'error';

/**
 * Instruction block appended to every loop turn. It tells the agent that it is
 * running unattended toward a standing objective and that the LAST line of its
 * reply must be one of the two markers — that marker is the cheap, zero-token
 * completion signal that lets the loop skip a verifier round-trip entirely.
 */
export function buildGoalLoopDirective(
  goal: string,
  iteration: number,
  maxIterations: number,
): string {
  return [
    '<goal_loop>',
    `Du arbeitest autonom an einem stehenden Ziel (Durchlauf ${iteration}/${maxIterations}).`,
    `Ziel: ${goal.trim()}`,
    'Arbeite in diesem Durchlauf so weit wie möglich am Ziel weiter und führe die',
    'nötigen Schritte tatsächlich aus, statt sie nur vorzuschlagen.',
    `Beende deine Antwort mit genau EINER Zeile: "${GOAL_DONE_MARKER}", wenn das Ziel`,
    `vollständig und überprüfbar erreicht ist, sonst "${GOAL_CONTINUE_MARKER}".`,
    '</goal_loop>',
  ].join('\n');
}

/**
 * Reads the agent's own completion marker from a turn's output.
 * Only the tail is inspected: a marker mentioned mid-explanation ("ich schreibe
 * am Ende GOAL_ACHIEVED") must not end the loop.
 */
export function detectGoalMarker(text: string): 'done' | 'continue' | null {
  const lines = (text ?? '')
    .split('\n')
    .map((line) => line.trim().replace(/^[*_`#>\s-]+|[*_`\s]+$/g, ''))
    .filter(Boolean);

  for (const line of lines.slice(-3).reverse()) {
    if (line === GOAL_DONE_MARKER) return 'done';
    if (line === GOAL_CONTINUE_MARKER) return 'continue';
  }
  return null;
}

/** Strips loop scaffolding (markers, directive block) from text shown to the user. */
export function stripGoalLoopMarkers(text: string): string {
  return (text ?? '')
    .replace(/<goal_loop>[\s\S]*?<\/goal_loop>\n*/g, '')
    .replace(new RegExp(`^[*_\`>\\s-]*(?:${GOAL_DONE_MARKER}|${GOAL_CONTINUE_MARKER})[*_\`\\s]*$`, 'gm'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Bounded, most-recent excerpt of a turn's work for the verifier prompt. */
export function summarizeIterationWork(text: string, maxChars = VERIFIER_EXCERPT_CHARS): string {
  const clean = stripGoalLoopMarkers(text);
  if (clean.length <= maxChars) return clean;
  return `…${clean.slice(clean.length - maxChars)}`;
}

/**
 * Verifier prompt: a separate, cheap pass that judges the work against the goal.
 * It is deliberately adversarial — an agent asked "are you done?" says yes far
 * too readily, so the verifier is told to default to NOT done when unsure.
 */
export function buildGoalVerificationPrompt(goal: string, work: string): string {
  return [
    'Du bist ein strenger Prüfer. Bewerte, ob das folgende Ziel durch die geleistete',
    'Arbeit VOLLSTÄNDIG erreicht wurde. Sei skeptisch: Ankündigungen, Pläne oder',
    '"Ich werde …" zählen NICHT als Erledigung. Im Zweifel lautet die Antwort false.',
    '',
    `## Ziel\n${goal.trim()}`,
    '',
    `## Bisherige Arbeit\n${summarizeIterationWork(work)}`,
    '',
    'Antworte ausschließlich mit JSON in genau dieser Form, ohne Text davor oder danach:',
    '{"done": true|false, "reason": "kurze Begründung", "nextStep": "konkret nächster Schritt oder \\"\\"", "confidence": 0.0-1.0}',
  ].join('\n');
}

/**
 * Parses a verifier reply into a verdict. Tolerates code fences and surrounding
 * prose by extracting the first balanced JSON object. Returns null when nothing
 * usable is found so callers can fall back instead of guessing "done".
 */
export function parseGoalVerdict(raw: string): GoalVerdict | null {
  const source = (raw ?? '').trim();
  if (!source) return null;

  const candidate = extractFirstJsonObject(source);
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  if (typeof record.done !== 'boolean') return null;

  const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
    ? Math.min(1, Math.max(0, record.confidence))
    : 0.5;

  return {
    done: record.done,
    reason: typeof record.reason === 'string' ? record.reason.trim() : '',
    nextStep: typeof record.nextStep === 'string' ? record.nextStep.trim() : '',
    confidence,
  };
}

/** Finds the first balanced `{…}` block, ignoring braces inside JSON strings. */
function extractFirstJsonObject(source: string): string | null {
  const start = source.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

/**
 * Continuation turn for the next iteration: restates the goal, names what is
 * still missing, and forbids re-reporting already-finished work.
 */
export function buildGoalContinuationPrompt(
  goal: string,
  verdict: GoalVerdict | null,
  iteration: number,
  maxIterations: number,
): string {
  const missing = verdict?.reason?.trim();
  const next = verdict?.nextStep?.trim();

  const lines = [
    `Das Ziel ist noch NICHT erreicht. Mache weiter (Durchlauf ${iteration}/${maxIterations}).`,
    '',
    `## Ziel\n${goal.trim()}`,
  ];
  if (missing) lines.push('', `## Was noch fehlt\n${missing}`);
  if (next) lines.push('', `## Nächster Schritt\n${next}`);
  lines.push(
    '',
    '## Anweisung',
    'Führe den nächsten Schritt jetzt tatsächlich aus. Wiederhole nicht, was bereits',
    'erledigt ist, und fasse den bisherigen Stand nicht erneut zusammen.',
  );
  return lines.join('\n');
}

/**
 * Stall guard: two consecutive iterations that produce (effectively) the same
 * output mean the agent is spinning, and another round will not help.
 */
export function isStalledIteration(previous: string, current: string): boolean {
  const normalize = (text: string): string =>
    stripGoalLoopMarkers(text).replace(/\s+/g, ' ').trim().toLowerCase();

  const before = normalize(previous);
  const after = normalize(current);
  if (!after) return true;
  if (!before) return false;
  return before === after;
}

/** Clamps a configured iteration count into the supported range. */
export function normalizeGoalLoopIterations(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_GOAL_LOOP_MAX_ITERATIONS;
  }
  return Math.min(GOAL_LOOP_ITERATION_CEILING, Math.max(1, Math.round(value)));
}

/** User-facing summary line for a finished loop. */
export function describeGoalLoopOutcome(
  reason: GoalLoopStopReason,
  iterations: number,
  verdictReason?: string,
): string {
  const suffix = verdictReason?.trim() ? ` — ${verdictReason.trim()}` : '';
  switch (reason) {
    case 'achieved':
      return `✅ Ziel erreicht nach ${iterations} ${iterations === 1 ? 'Durchlauf' : 'Durchläufen'}${suffix}`;
    case 'max-iterations':
      return `⏹️ Maximale Durchläufe (${iterations}) erreicht — Ziel noch offen${suffix}`;
    case 'stalled':
      return `⏹️ Kein Fortschritt mehr nach ${iterations} Durchläufen — Loop gestoppt${suffix}`;
    case 'cancelled':
      return `⏹️ Goal-Loop abgebrochen nach ${iterations} Durchläufen`;
    case 'paused':
      return `⏸️ Goal-Loop nach ${iterations} Durchläufen pausiert — /goal resume fortsetzt ihn`;
    case 'error':
      return `⚠️ Goal-Loop nach ${iterations} Durchläufen wegen eines Fehlers beendet${suffix}`;
  }
}
