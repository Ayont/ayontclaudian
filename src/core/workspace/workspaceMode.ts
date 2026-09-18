/**
 * Workspace mode — the Code/Work switch.
 *
 * ayontclaudian serves two very different jobs: building software (tool-heavy
 * coding sessions) and knowledge work (IT-ops incidents, tickets, notes,
 * Berichtsheft, documents in the vault). The workspace mode lets the user pick
 * the current job and tunes BOTH the agent (a mode section in the system
 * prompt) and the UI (accent color, input placeholder) to it.
 *
 * Pure logic only — no Obsidian imports. The UI toggle lives in
 * `features/chat/ui/WorkspaceModeToggle.ts`, the prompt wiring in
 * `core/prompt/mainAgent.ts`.
 */

export { buildBerichtsheftPrompt } from './berichtsheft';
export { buildAngebotPrompt, buildDiagramPrompt, buildMindmapPrompt } from './visualPrompts';

export type WorkspaceMode = 'code' | 'work';

export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = 'code';

/** Normalizes a persisted/unknown value onto a valid mode. */
export function normalizeWorkspaceMode(value: unknown): WorkspaceMode {
  return value === 'work' ? 'work' : DEFAULT_WORKSPACE_MODE;
}

export interface WorkspaceModeMeta {
  /** Short segmented-control label (German UI). */
  label: string;
  /** Tooltip on the toggle segment (German UI). */
  tooltip: string;
  /** Obsidian icon id for the segment. */
  icon: string;
  /** Chat input placeholder while the mode is active (German UI). */
  placeholder: string;
  /** Environment badge text (e.g. for banners and indicators). */
  badgeTitle: string;
  /** Environment subtitle / active capabilities. */
  badgeFeatures: string;
}

const MODE_META: Readonly<Record<WorkspaceMode, WorkspaceModeMeta>> = Object.freeze({
  code: Object.freeze({
    label: 'Code',
    tooltip: 'Code-Modus — Dev Studio, Multi-Agent Swarm, Testen & Refactoring',
    icon: 'code-2',
    placeholder: 'Was bauen wir?',
    badgeTitle: 'CODE STUDIO',
    badgeFeatures: 'Multi-Agent Swarm · Build & Test · Git Diffs · Refactoring',
  }),
  work: Object.freeze({
    label: 'Work',
    tooltip: 'Work-Modus — IT-Betrieb, Schule, Angebote & Privates',
    icon: 'pen-line',
    placeholder: 'Was ist kaputt — oder was halten wir fest?',
    badgeTitle: 'WORK STUDIO',
    badgeFeatures: 'IT-Störungen · Berichtsheft · Angebot · Privat',
  }),
});

export function getWorkspaceModeMeta(mode: WorkspaceMode): WorkspaceModeMeta {
  return MODE_META[mode];
}

/** Container CSS class carrying the active mode (drives accents + transitions). */
export function getWorkspaceModeClass(mode: WorkspaceMode): string {
  return `claudian-mode-${mode}`;
}

export const WORKSPACE_MODE_CLASSES: readonly string[] = Object.freeze([
  'claudian-mode-code',
  'claudian-mode-work',
]);

export interface WorkspaceQuickPrompt {
  /** Chip label (German UI). */
  label: string;
  /** Text inserted into the composer. Trailing space/colon → user completes it. */
  prompt: string;
  /** Obsidian icon id. */
  icon: string;
}

/**
 * Mode-specific quick actions shown above the composer while it is empty —
 * the tangible everyday difference between the two modes.
 */
const QUICK_PROMPTS: Readonly<Record<WorkspaceMode, readonly WorkspaceQuickPrompt[]>> =
  Object.freeze({
    code: Object.freeze([
      { label: 'Multi-Agent Sprint', prompt: 'Starte einen Multi-Agenten Code-Sprint: Analysiere die Architektur, plane Schritte, implementiere und verifiziere mit Tests.', icon: 'bot' },
      { label: 'Build & Tests', prompt: 'Führe Build und Test-Suite aus, isoliere fehlschlagende Tests und behebe auftretende Fehler.', icon: 'play' },
      { label: 'Bugs finden', prompt: 'Finde Bugs, Race Conditions und Sicherheitslücken im aktuellen Projekt und priorisiere sie nach Schwere.', icon: 'bug' },
      { label: 'Änderungen reviewen', prompt: 'Reviewe meine aktuellen Änderungen (git diff) und gib konkretes Feedback zu Codequalität und Risiken.', icon: 'git-compare' },
      { label: 'Refactoring', prompt: 'Schlage sinnvolle Refactorings für den Code vor, an dem wir arbeiten: ', icon: 'wrench' },
      { label: 'Architektur & Plan', prompt: 'Analysiere das System und erstelle einen fundierten Architektur- und Umsetzungsplan für: ', icon: 'layers' },
    ]),
    work: Object.freeze([
      { label: 'Outlook / Mail', prompt: 'Störung: Outlook oder Mail geht nicht. Diagnose systematisch (Client, Autodiscover, Konto, Server, Netzwerk) und gib reproduzierbare Schritte plus eine Ticket-Notiz.', icon: 'mail' },
      { label: 'Firewall / Netz', prompt: 'Störung: Firewall oder Netzwerk ist down bzw. blockiert. Eingrenzen (Client, Switch, Gateway, Firewall-Policy, DNS) und ein klares Incident-Protokoll schreiben.', icon: 'shield' },
      { label: 'Ticket entwerfen', prompt: 'Formuliere aus dieser Störung eine klare IT-Ticket-Notiz (Symptom, Auswirkung, bisherige Schritte, nächster Check): ', icon: 'clipboard-list' },
      { label: 'Berichtsheft', prompt: 'Schreib den IHK-Ausbildungsnachweis (Berichtsheft) für diese Woche. Abschnitte: Kalenderwoche, Betrieb, Berufsschule, Tätigkeiten, Stunden. Keine Firmen- oder Schulnamen erfinden.', icon: 'notebook-pen' },
      { label: 'Angebot', prompt: 'Erstelle ein Kundenangebot: ', icon: 'file-text' },
      { label: 'Mindmap', prompt: 'Zeichne eine Mindmap zu: ', icon: 'git-fork' },
      { label: 'Privat / Plan', prompt: 'Private Notiz oder Wochenplan — ohne Arbeits- oder Schulkontext. Hilf mir, das klar, kurz und umsetzbar festzuhalten: ', icon: 'calendar' },
    ]),
  });

export function getWorkspaceQuickPrompts(mode: WorkspaceMode): readonly WorkspaceQuickPrompt[] {
  return QUICK_PROMPTS[mode];
}

/**
 * Mode section for the system prompt. Deliberately a FOCUS hint, not a
 * restriction — the agent keeps all capabilities in both modes, it just
 * leads with the right defaults for the current job.
 */
/** Compact turn-contract copy. Same source as the detailed mode section. */
export function getCompactWorkspaceModeInstructions(mode: WorkspaceMode): string {
  return mode === 'work'
    ? [
      '## Active Workspace Mode: WORK (Work Studio · IT operations)',
      'Lead with German IT-ops: Outlook/mail outages, firewall/network incidents, tickets, Ausbildungsnachweis / Berichtsheft, Word-like Angebote, diagrams, and private notes or weekly planning. Keep all capabilities. Code requests stay normal chat.',
      'Pick the visual from intent — slash commands are optional shortcuts, never required:',
      '- Standalone deliverable (Angebot, Protokoll, Arbeitsblatt, Berichtsheft, Konzept, Policy): one `claudian-document` fence, `theme: word`.',
      '- Mail or a reply to a named person: `claudian-email`.',
      '- Real network topology (firewall, VLAN, WAN, FortiGate): `network-map`.',
      '- Structure, process, mindmap, Ablauf: one `mermaid` fence (`mindmap` or `flowchart TD`). Never Draw.io XML.',
      '- Diagnosis, commands, checklists: ordinary Markdown. Never wrap those in a live document.',
    ].join('\n')
    : [
      '## Active Workspace Mode: CODE (Code Studio · Multi-Agent Swarm)',
      'Keep all capabilities. Lead with concrete engineering action, multi-agent orchestration, precise edits and test verification. Artifact requests remain available.',
      'Architecture or process questions may include a `mermaid` flowchart or sequenceDiagram in chat — no slash command needed.',
    ].join('\n');
}

export function getWorkspaceModeInstructions(mode: WorkspaceMode): string {
  if (mode === 'work') {
    return `

## Active Workspace Mode: WORK (Work Studio · IT operations)

The user has switched this workspace into WORK mode — specialized for German IT-ops incidents, tickets, vault documentation, and the weekly Ausbildungsnachweis (Berichtsheft). Keep all capabilities, but lead with these defaults:

### 1. Incident first (mail, firewall, network, tickets)
- Treat "Outlook geht nicht", mail delivery failures, firewall down / blocked, DNS, VPN, Wi-Fi, and similar sysadmin tickets as the primary job.
- Diagnose in layers (client → account → server → network → policy). Give reproducible checks, then a short Ticket-Notiz (Symptom, Auswirkung, bisherige Schritte, nächster Check).
- Do not invent employer names, customer names, or school names. Stay generic.

### 2. Berichtsheft / Ausbildungsnachweis
- When asked for a weekly report, write vault-ready German Markdown with Kalenderwoche, Betrieb, Berufsschule, Tätigkeiten, and Stunden.
- First person, sachlich, lernzielbezogen. Never fabricate a Firmenname or Schulname.

### 3. Word-like documents, Angebote, and diagrams
- Everyday deliverables (Arbeitsblatt, Angebot, Protokoll, Lernfeld, Berichtsheft) use \`claudian-document\` with \`theme: word\` so they look typed in Word — not a magazine.
- Use \`theme: editorial\` only when the user wants a designed look.
- For mind maps and process diagrams emit a \`mermaid\` fence (mindmap or flowchart). Never invent Draw.io XML.
- Slash commands (\`/angebot\`, \`/mindmap\`, \`/diagram\`, \`/berichtsheft\`) are optional shortcuts. Infer the same surfaces from ordinary German requests — the user should not need a command.

### 4. When to use a live document vs chat
- Use \`claudian-document\` when the user wants a standalone deliverable they could save as a page (Angebot, Protokoll, Arbeitsblatt, Berichtsheft, Konzept, Policy, Handbuch), even if they never say "Dokument".
- NEVER use it for shell commands, bash, diagnostics, troubleshooting tables, error investigations, or regular conversational answers. Those stay standard Markdown (\`\`\`bash, lists, tables).
- Manage formal documents with a versioning header when drafting policies, runbooks, or reports:
  \`\`\`markdown
  # [Dokumenttitel]
  **Dokumenten-Version:** v1.0 (oder v1.1, v2.0) · **Stand:** [Datum] · **Status:** [Entwurf / Prüfung / Freigegeben]
  **Geltungsbereich:** [DE / EU / International]
  **Revisionshistorie:** [Änderungsgrund und wesentliche Modifikationen]
  \`\`\`

### 5. Private life
- Personal notes, household planning, calendar, errands: keep them out of the workplace/school voice. Short, practical, vault-ready Markdown.

### 6. Vault notes
- Integrate vault knowledge: Wikilinks, YAML frontmatter, clear folder recommendations.
- Code questions are still fine — answer them normally — but do not steer conversations toward code.`;
  }

  return `

## Active Workspace Mode: CODE (Code Studio · Multi-Agent Swarm)

The user has switched this workspace into CODE mode — built for staff-level software engineering, multi-agent orchestration, and verified implementations. Keep all capabilities, but lead with these defaults:

### 1. Multi-Agent Coordination & Engineering
- Act as the Lead Software Architect and Multi-Agent Orchestrator.
- For non-trivial features, break tasks into clear engineering phases:
  1. Discovery & Architecture (read existing files, search patterns, grep codebase).
  2. Plan & Spec (modular design, risk assessment, interface contracts).
  3. Precise Edits (minimal, clean, type-safe modifications matching project conventions).
  4. Verification & Testing (execute builds and tests, inspect git diffs).
- Coordinate subagents whenever parallel analysis or independent verification speeds up and improves output.

### 2. Concrete Action & Technical Precision
- Prefer concrete engineering action: inspect relevant files first, make precise edits, and run tests to verify.
- Be terse and technical; lead with the change, not prose. Show diffs/paths over long explanations.
- Proactively surface risks: breaking changes, missing unit tests, race conditions, and security vulnerabilities.
- Document-shaped requests are still fine — but default to shipping working code.`;
}
