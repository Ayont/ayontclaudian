# Claudian 5.0.0 Release Notes

**Release Date:** 2026-06-19  
**Minimum Obsidian Version:** 1.7.2  
**Plugin ID:** `realclaudian`

## Overview

Claudian 5.0.0 is a major release that unifies four parallel streams of work into a single, coherent plugin experience. It introduces universal steering for all providers, a multi-agent team engine, a rebuilt dashboard, and vault-level productivity commands.

## What’s New

### S1 — Universal Steer
- One syntax to steer prompts to any registered provider/model.
- Works across Claude, Codex, Antigravity, Kimi, Vibe, Grok, OpenCode, and Pi.

### S2 — Multi-Agent Team Engine
- Inline `/team` slash command spawns coordinated subagent teams.
- Cross-provider parallel execution with aggregated results in chat.
- Configurable team size and mission context.

### S3 — Dashboard 2.0
- New **Claudian OS** dashboard view.
- Memory browser, mission log, workflow browser, token usage breakdown.
- Live activity feed and keyboard navigation.

### S4 — Prompt Templates & Vault Health
- `/template` lists, searches, and inserts prompt templates from a user-defined folder.
- `/vault-health` scans the vault and reports broken links, orphans, duplicates, and empty files.
- Markdown report rendered directly in chat.

## Quality

- 315 test suites passing.
- 6,244 tests passing.
- 0 lint errors.
- 0 TypeScript errors.
- Production build (`main.js`, `styles.css`) generated successfully.

## Migration Notes

- No breaking changes for existing users.
- The new `/team`, `/template`, and `/vault-health` commands appear automatically in the slash-command menu.
- Template folder defaults to `Templates/Prompts` and can be changed in Settings → Prompt Templates.

## Known Limitations

- S5–S8 streams were moved to a future 5.1.0 release because they are still in design phase.
