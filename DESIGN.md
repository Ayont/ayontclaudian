# Claudian Design System

## Intent

Claudian is used for concentrated work in Obsidian, often for hours and frequently in narrow sidebars. The interface follows the host theme and uses provider color as a restrained provenance signal, never as a decorative wash.

## Color

- Strategy: restrained, theme-native neutrals plus one active provider accent.
- Base surfaces use Obsidian background tokens.
- Provider accents appear on marks, current selection, progress, focus, and live state.
- Success, warning, and error remain semantic and never inherit provider color.
- Use tinted near-black and near-white values, not pure black or white.

## Typography

- UI: Obsidian interface font or system sans.
- Code and metrics: Obsidian monospace.
- Compact fixed scale: 11, 12, 13, 15, 18, and 24px.
- Headings use weight and spacing, not display type or gradient text.

## Shape and Elevation

- Radius: 5px controls, 8px rows, 12px panels, pill only for compact status chips.
- Borders carry structure; shadows are reserved for floating menus and modals.
- Avoid nested cards. Use sections, separators, and rows inside major surfaces.

## Provider Identity

- Every provider has a stable accent token, icon, display name, and short model label.
- Active provider appears in the composer, live status, dashboard header, model picker, and response provenance.
- Provider switches are explicit events in chat history.
- Color is always paired with text or an icon.

## Feedback

- Immediate: hover, press, focus, selected, and disabled states.
- Live: provider name, activity phrase, elapsed time, progress, and latest tool activity.
- Completion: success or error state plus durable output location.
- Empty states explain the next useful action.

## Layout

- Chat prioritizes message flow and composer clarity in narrow widths.
- Dashboard uses a command header, compact metrics, quick actions, and an activity timeline.
- Multi-agent uses a mission brief, team roster, overall progress, per-agent telemetry, and synthesis.
- At widths below 560px, grids collapse, secondary copy truncates, and actions wrap without horizontal overflow.

## Feature Discovery

- The dashboard exposes enabled providers before individual capabilities.
- Capability matrices distinguish provider-native support from workspace-level features.
- The Feature Map shows both the feature name and its live state, including useful counts where available.
- Unsupported features remain visible and muted so users can discover them without confusing them for active controls.

## Motion

- 120 to 220ms, ease-out-quart/expo.
- Motion communicates state changes only.
- Animate opacity and transforms, not layout.
- Disable scans, pulses, and transitions under `prefers-reduced-motion`.
