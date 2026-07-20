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
}

const MODE_META: Readonly<Record<WorkspaceMode, WorkspaceModeMeta>> = Object.freeze({
  code: Object.freeze({
    label: 'Code',
    tooltip: 'Code-Modus — bauen, debuggen, refactoren',
    icon: 'code-2',
    placeholder: 'Was bauen wir?',
  }),
  work: Object.freeze({
    label: 'Work',
    tooltip: 'Work-Modus — Dokumente, Notizen, Recherche',
    icon: 'pen-line',
    placeholder: 'Woran arbeiten wir?',
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

/**
 * Mode section for the system prompt. Deliberately a FOCUS hint, not a
 * restriction — the agent keeps all capabilities in both modes, it just
 * leads with the right defaults for the current job.
 */
export function getWorkspaceModeInstructions(mode: WorkspaceMode): string {
  if (mode === 'work') {
    return `

## Active Workspace Mode: WORK

The user has switched this workspace into WORK mode — the current job is knowledge work, not programming. Keep all capabilities, but lead with these defaults:

- Prefer producing and refining vault content: notes, documents (\`claudian-document\`), emails (\`claudian-email\`), summaries, plans, research.
- Structure answers for reading: clear headings, short paragraphs, wikilinks to related notes.
- When the user asks for something substantial and document-shaped, reach for the live document builder instead of a plain chat answer.
- Suggest note organization (frontmatter, tags, folders) where it genuinely helps.
- Code questions are still fine — answer them normally — but do not steer conversations toward code.`;
  }

  return `

## Active Workspace Mode: CODE

The user has switched this workspace into CODE mode — the current job is software work. Keep all capabilities, but lead with these defaults:

- Prefer concrete engineering action: read the relevant files first, make precise edits, run builds/tests to verify.
- Be terse and technical; lead with the change, not prose. Show diffs/paths over long explanations.
- Follow the project's existing conventions (style, structure, naming) — check neighboring code before writing new code.
- Proactively surface risks: breaking changes, missing tests, security concerns.
- Document-shaped requests are still fine — but default to shipping working code.`;
}
