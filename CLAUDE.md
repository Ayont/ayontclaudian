# CLAUDE.md

## Project Overview

**ayontclaudian** (`Ayont/ayontclaudian`) embeds coding-agent CLIs as chat runtimes
directly inside an Obsidian vault. The vault is the agent's working directory: it
reads and writes notes, searches, runs bash, and drives agentic workflows in place.

This is a fork of [`YishenTu/claudian`](https://github.com/YishenTu/claudian) that
has diverged substantially. **It is not in the Obsidian community registry** — it
ships via GitHub releases and BRAT.

- Plugin id: `realclaudian` · display name: `ayontclaudian` · author: `Ayont`
- Deployed folder in a vault: `.obsidian/plugins/realclaudian/`

## Conventions that are easy to get wrong

- **User-facing strings are German.** Chat copy, notices, settings descriptions,
  GUI labels. Code — identifiers, comments, commit messages, docs — is English.
  There are 10 locale files under `src/i18n/locales/`, but German is the product
  voice; new UI text should be written in German unless it is a code-level label.
- **Comment why, not what.** No narration, no redundant JSDoc.
- **No `console.*` in production code.**
- **TDD for behavior changes:** failing test first in the mirrored `tests/` path.
- Throwaway scripts and handoff notes go in `.context/` (git-ignored), not `dev/`.

## Providers (8)

Every provider is a directory under `src/providers/<id>/` plus two calls in
`src/providers/index.ts` and one entry in `defaultProviderConfigs.ts`.
`ProviderId` is a bare `string` (`src/core/types/provider.ts`) — there is no union
to extend. What differs between providers is the **transport shape**:

| Provider | Integration shape |
|---|---|
| `claude` | Official Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). Full-feature reference implementation. |
| `codex` | `codex app-server` over JSON-RPC, plus JSONL transcript reload |
| `opencode` | ACP (shared code in `src/providers/acp/`) |
| `kimi` | `--print` + full-message NDJSON |
| `vibe` | `--print` + full-message NDJSON |
| `grok` | `--print` + delta JSON with resume |
| `antigravity` | `agy --print`, single-shot; state recovered by tailing `transcript.jsonl` |
| `pi` | `--print` |

`Conversation` carries `providerId` plus opaque, provider-owned `providerState`.

**Adding a provider is mechanical but touches ~10 files outside its own directory.**
See [`docs/adding-a-provider.md`](docs/adding-a-provider.md) for the checklist —
do not try to infer the list by reading one existing provider, you will miss
several (icons, brand CSS vars, status-bar colors, CLI install catalog, locales,
usage estimation, keepalive, command expansion).

## Architecture

| Layer | Purpose |
|---|---|
| `src/app/` | Shared settings defaults, plugin-level storage helpers |
| `src/core/` | Provider-neutral contracts and infrastructure — see [`src/core/CLAUDE.md`](src/core/CLAUDE.md) |
| `src/providers/<id>/` | One adaptor per CLI; `acp/` is shared transport code |
| `src/features/chat/` | The main chat surface — see [`src/features/chat/CLAUDE.md`](src/features/chat/CLAUDE.md) |
| `src/features/` | `artifacts`, `dashboard`, `inline-edit`, `multiAgent`, `productivity`, `related`, `settings`, `templates` |
| `src/shared/` | Reusable UI building blocks (dropdowns, modals, mention UI, icons) |
| `src/style/` | Modular CSS — see [`src/style/CLAUDE.md`](src/style/CLAUDE.md) |
| `src/i18n/` | 10 locales |
| `src/utils/` | Cross-cutting helpers (env, path, markdown, diff, context, image, session) |

`src/core/` has ~31 subdirectories. The larger ones a newcomer will not guess from
the name: `intelligence/` (multi-agent orchestration + RAG), `control/` (workflow
engine, scheduled jobs), `budget/` (token budget + rate-limit windows),
`bootstrap/` (session storage), `undo/` (vault snapshots for turn undo),
`timeline/` (run timelines), `memory/`, `audio/`, `diagnostics/`.

## Traps

Each of these has cost a real debugging session. They are not theoretical.

1. **`ChatState.messages` returns a copy.** The getter is `return [...this.state.messages]`
   (`src/features/chat/state/ChatState.ts`). Calling `.push()` on it silently
   no-ops *and* skips the `onMessagesChanged` callback — use `addMessage()`.
   This is how multi-agent results once vanished from the UI.
2. **Theme-dependent CSS custom properties go on `body`, never `:root`.**
   Obsidian sets `theme-light`/`theme-dark` on `body`, and `var()` resolves against
   the declaring element. Declaring on `:root` silently locks the surface to one
   theme — this is what broke the dashboard in light mode.
3. **Never hand a foreign `sessionId` to a CLI after a mid-chat provider switch.**
   Read only your own `providerState`. Reference: `AntigravityChatRuntime.syncConversationState`.
4. **A new CSS module must be `@import`-ed in `src/style/index.css`** or the build fails.
5. **Provider capability claims must be verified against the real CLI or the
   bundled SDK typings**, never assumed. Model context windows, effort levels, and
   flag support have all been wrong in shipped code because they were guessed.
   `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` is authoritative for
   Claude; for the others, run the binary (`--help`, `models`, `changelog`).
   For a context window, the most reliable source is a one-token turn read back
   from `modelUsage[<id>].contextWindow` — published summaries have been wrong.
6. **The production bundle is minified, and one build step rewrites it afterwards.**
   `scripts/rendererSafeUnref.js` turns bundled `setTimeout(...).unref()` into
   `.unref?.()`, because timers return a number in Electron's renderer and the
   bare call throws. It finds its targets by paren matching, NOT by matching the
   surrounding source formatting — an earlier regex version silently stopped
   working the moment minification was switched on. If you touch it, keep it
   formatting-agnostic and keep it descending into nested timer calls; the build
   fails loudly when any unsafe site survives.

## Commands

```bash
npm run dev          # watch build
npm run build        # production build (also builds CSS)
npm run typecheck
npm run lint         # 0 errors required; ~12 pre-existing warnings are expected
npm run lint:fix
npm run test
npm run test:coverage
npm run preview      # design preview harness
npm run test:visual  # visual regression
```

Tests mirror `src/` under `tests/unit/` and `tests/integration/`:

```bash
npm run test -- --selectProjects unit
npm run test -- --selectProjects integration
```

## Releasing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The one thing to internalize before your
first release: **`origin` is a different fork.** Releases go to the `ayont` remote.

## Storage

| Path | Contents |
|------|----------|
| `.claudian/claudian-settings.json` | Shared app settings + per-provider config |
| `.claudian/sessions/*.meta.json` | Provider-neutral session metadata |
| `.claudian/usage.json` | Token usage, budgets, rate-limit window events |
| `.claude/settings.json` | Claude Code-compatible project settings and permissions |
| `.claude/mcp.json` | Claudian-managed MCP servers for Claude |
| `.claude/commands/**/*.md` | Claude slash commands |
| `.claude/skills/*/SKILL.md` · `.claude/agents/*.md` | Claude skills / vault agents |
| `.codex/skills/*/SKILL.md` · `.agents/skills/*/SKILL.md` | Codex vault skills |
| `.codex/agents/*.toml` | Codex vault subagent definitions |
| `~/.claude/projects/{vault}/*.jsonl` | Claude-native transcripts |
| `~/.codex/sessions/**/*.jsonl` | Codex-native transcripts |

## Development Notes

- **Provider-native first.** Adapt to what the CLI/SDK already does instead of
  shadowing it locally.
- **Inspect real runtime output before integrating.** Claude data lands under
  `~/.claude/`, Codex under `~/.codex/`, Antigravity under its brain dir. Real
  transcripts beat guessed event shapes.
- Run `npm run typecheck && npm run lint && npm run test && npm run build` after editing.
