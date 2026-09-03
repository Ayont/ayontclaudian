/**
 * Workspace mode — the Code/Work switch.
 *
 * ayontclaudian serves two very different jobs: building software (tool-heavy
 * coding sessions) and knowledge work (documents, notes, emails, research in
 * the vault). The workspace mode lets the user pick the current job and tunes
 * BOTH the agent (a mode section in the system prompt) and the UI (accent
 * color, input placeholder) to it.
 *
 * Pure logic only — no Obsidian imports. The UI toggle lives in
 * `features/chat/ui/WorkspaceModeToggle.ts`, the prompt wiring in
 * `core/prompt/mainAgent.ts`.
 */

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
    tooltip: 'Code-Modus — Codex Dev Studio, Multi-Agent Swarm, Testen & Refactoring',
    icon: 'code-2',
    placeholder: 'Was bauen wir?',
    badgeTitle: 'CODEX DEV STUDIO',
    badgeFeatures: 'Multi-Agent Swarm · Build & Test · Git Diffs · Refactoring',
  }),
  work: Object.freeze({
    label: 'Work',
    tooltip: 'Work-Modus — ChatGPT Work, DSGVO, EU AI Act, Dokument-Versionen & Recht',
    icon: 'pen-line',
    placeholder: 'Woran arbeiten wir?',
    badgeTitle: 'ENTERPRISE WORK & LEGAL',
    badgeFeatures: 'DSGVO & EU AI Act Ready · Dokument-Versionen · Normen & Compliance',
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
    ]),
    work: Object.freeze([
      { label: 'DSGVO-Audit', prompt: 'Führe ein DSGVO-Audit durch: Rechtsgrundlagen (Art. 6 DSGVO), AVV (Art. 28), TOMs (Art. 32) und Informationspflichten bewerten.', icon: 'scale' },
      { label: 'EU AI Act Prüfung', prompt: 'Prüfe diesen Anwendungsfall nach dem EU AI Act (KI-Verordnung): Risikoklassifizierung (Art. 6 / GPAI), Transparenz- und Dokumentationspflichten.', icon: 'shield-check' },
      { label: 'Dokument erstellen', prompt: 'Erstelle ein strukturiertes Dokument mit Versions-Header (v1.0), Revisionstabelle und Geltungsbereich zu: ', icon: 'file-text' },
      { label: 'Vertrag & Richtlinie', prompt: 'Formuliere eine rechtssichere Vereinbarung / interne Richtlinie mit verbindlichen Klauseln, Haftungsbegrenzung und Salvatorischer Klausel zu: ', icon: 'scroll' },
      { label: 'Akademisches Dossier', prompt: 'Verfasse ein wissenschaftlich fundiertes Dossier mit formalen Belegen, Gegenthesen und präzisen Zitaten zu: ', icon: 'graduation-cap' },
      { label: 'Vault-Recherche', prompt: 'Recherchiere in meinem Vault und fasse zusammen: ', icon: 'search' },
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
export function getWorkspaceModeInstructions(mode: WorkspaceMode): string {
  if (mode === 'work') {
    return `

## Active Workspace Mode: WORK (ChatGPT Work · Enterprise & Legal Intelligence)

The user has switched this workspace into WORK mode — modeled after ChatGPT Work and specialized for knowledge work, document versioning, legal compliance (DSGVO, EU AI Act), and academic rigor. Keep all capabilities, but lead with these defaults:

### 1. Document Versioning & Structured Drafting
- Manage documents with formal versioning headers whenever drafting policies, agreements, guidelines, or reports:
  \`\`\`markdown
  # [Dokumenttitel]
  **Dokumenten-Version:** v1.0 (oder v1.1, v2.0) · **Stand:** [Datum] · **Status:** [Entwurf / Prüfung / Freigegeben]
  **Geltungsbereich:** [DE / EU / International]
  **Revisionshistorie:** [Änderungsgrund und wesentliche Modifikationen]
  \`\`\`
- When producing substantive standalone documents, reach for the live document builder (\`claudian-document\`) or structured markdown with clear changelogs and diff comparisons.

### 2. Legal & Regulatory Intelligence (DSGVO / GDPR & EU AI Act)
- **DSGVO / GDPR (Verordnung (EU) 2016/679)**:
  - Explicitly cite legal bases: Art. 6 Abs. 1 lit. a (Einwilligung), lit. b (Vertragserfüllung), lit. c (rechtliche Verpflichtung), lit. f (berechtigtes Interesse).
  - Check special categories of personal data (Art. 9 DSGVO).
  - Detail Auftragsverarbeitungsverträge (AVV / DPA, Art. 28 DSGVO) with required contractual safeguards.
  - Review Technische und organisatorische Maßnahmen (TOMs, Art. 32 DSGVO: Vertraulichkeit, Integrität, Verfügbarkeit, Belastbarkeit).
  - Assess Datenschutz-Folgenabschätzung (DSFA, Art. 35 DSGVO) and third-country transfers (Art. 44 ff., Standardvertragsklauseln SCCs).
- **EU AI Act / KI-Verordnung (Verordnung (EU) 2024/1689)**:
  - Classify AI systems by risk tier: Verbotene Praktiken (Art. 5 - Social Scoring, biometrische Fernidentifikation), Hochrisiko-KI (Art. 6 & Anhang III - Bildung, HR, kritische Infrastruktur), Transparenzpflichten (Art. 50/52 - Kennzeichnung von KI und Deepfakes), General Purpose AI (GPAI, Art. 51 ff.).
  - Specify compliance requirements: Risikomanagement (Art. 9), Data Governance (Art. 10), technische Dokumentation (Art. 11), Logging (Art. 12) und menschliche Aufsicht (Art. 14).
- **German & International Contract Standards (BGB / HGB)**:
  - Structure contractual clauses logically: Geltungsbereich, Pflichten, Haftungsbeschränkung, Kündigung und Salvatorische Klausel.

### 3. Academic, Political & Formal Synthesis
- Provide balanced, objective analyses: Thesis, arguments, empirical counterarguments, and formal synthesis.
- Integrate vault knowledge: Use Wikilinks to related notes, YAML frontmatter, and clear folder recommendations.
- Code questions are still fine — answer them normally — but do not steer conversations toward code.`;
  }

  return `

## Active Workspace Mode: CODE (Codex Dev Studio · Multi-Agent Swarm)

The user has switched this workspace into CODE mode — modeled after Codex and built for staff-level software engineering, multi-agent orchestration, and verified implementations. Keep all capabilities, but lead with these defaults:

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
