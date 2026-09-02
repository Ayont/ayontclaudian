# Claudian Design System

## Intent

Claudian is a T3 Code-style control plane for coding agents inside an Obsidian vault. The chat is a centered column: open assistant prose, contained user bubbles, and one floating composer as the only chrome. Provider color remains provenance, not decoration.

## Color

- Strategy: restrained, theme-native neutrals plus one active provider accent.
- Base surfaces use Obsidian background tokens.
- Provider accents appear on marks, current selection, the send button, progress, focus, and live state.
- Success, warning, and error remain semantic and never inherit provider color.
- Use tinted near-black and near-white values, not pure black or white.

## Typography

- UI: Obsidian interface font or system sans.
- Code and metrics: Obsidian monospace.
- Scale: 11, 12, 14, 16, and a 26–38px welcome greeting.
- Headings use weight and spacing, not display type or gradient text.

## Shape and Elevation

- Radius: 6px controls, 12px rows, 16px cards, 22px composer, pill for send and status chips.
- Material: liquid glass (web approximation, not Apple's native material). Tokens live in `variables.css` under `--cl-glass-*`; every glass surface is `background: var(--cl-glass-sheen), var(--cl-glass-body*)` + `backdrop-filter: var(--cl-glass-filter*)` + `box-shadow: var(--cl-glass-edge), <shadow>`. No hand-rolled rgba(255,255,255,x) rims.
- Glass surfaces: the composer, user bubbles, bash/tool plates, popovers (history, mentions, slash, effort, model dropdown), the model picker frame, dashboard panes, the usage center.
- Recessed content (code, shell output, logs) sits in an ink well: `--cl-ink*`, which flips with the theme via Obsidian's `--mono-rgb-0/100`. Never hardcode `rgba(0,0,0,x)` fills.
- One glass pane per surface, never nested glass: tiles inside a pane use `--cl-wash` plus a hairline, the pane owns the blur.
- Browser/desktop automation (`src/style/features/browser-activity.css`) renders as a miniature glass browser window: title bar (traffic dots + address pill) → action strip → viewport (ink well; screenshot or pulsing radar while running) → result strip. Desktop automation (cua-driver, `computer_use`) re-tints the card to system blue via `--claudian-brand-rgb` so it never reads as a web page. Every driver (Hermes `browser_*`, Claude-in-Chrome, Playwright/Chrome-DevTools/Browser-Use MCP) goes through `core/tools/browserActivity.ts`; add new drivers there, not in CSS.
- Other surfaces use hairline borders; nested cards stay banned.
- Speed mode uses a warm amber pill and composer edge, independent of the provider accent.
- Fallbacks: `prefers-reduced-transparency` and missing `backdrop-filter` collapse glass to opaque `--cl-surface-*`; contrast never depends on the blur.

## Token Scope

- Theme-dependent tokens are declared on `body` (and re-declared on `.claudian-container`), never on `:root`. A `:root` declaration resolves its `var()` references once against `html` and silently loses every theme value for surfaces outside the container (modals, dashboard, portals).

## Provider Identity

- Every provider has a stable accent token, icon, display name, and short model label.
- Active provider appears in the composer, live status, dashboard header, model picker, and response provenance.
- Provider switches are explicit events in chat history.
- Color is always paired with text or an icon.

## Feedback

- Immediate: hover, press, focus, selected, and disabled states.
- Live: provider name, activity phrase, elapsed time, progress, latest tool activity, and Speed / cooldown state.
- Completion: success or error state plus durable output location.
- Empty states show a greeting plus mode-aware starter chips.

## Layout

- Chat is a centered 760px column. User bubbles sit on the trailing edge; assistant turns stay open.
- History groups threads as Angepinnt / Heute / Gestern / Diese Woche / Älter.
- Dashboard uses a command header, compact metrics, quick actions, and an activity timeline.
- Multi-agent uses a mission brief, team roster, overall progress, per-agent telemetry, and synthesis.
- At widths below 560px, grids collapse, secondary copy truncates, and actions wrap without horizontal overflow.

## Feature Discovery

- The dashboard exposes enabled providers before individual capabilities.
- Capability matrices distinguish provider-native support from workspace-level features.
- The Feature Map shows both the feature name and its live state, including useful counts where available.
- Unsupported features remain visible and muted so users can discover them without confusing them for active controls.
- Tastenkürzel (`⌘ /` or `?`) list the operating shortcuts in place.

## Motion

- 120 to 220ms, ease-out-quart/expo.
- Motion communicates state changes only.
- Animate opacity and transforms, not layout.
- Disable scans, pulses, and transitions under `prefers-reduced-motion`.
