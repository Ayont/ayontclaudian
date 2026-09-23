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

## Providers (15)

Every provider is a directory under `src/providers/<id>/` plus two calls in
`src/providers/index.ts` and one entry in `defaultProviderConfigs.ts`.
`ProviderId` is a bare `string` (`src/core/types/provider.ts`) — there is no union
to extend. What differs between providers is the **transport shape**:

| Provider | Integration shape |
|---|---|
| `claude` | Official Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). Full-feature reference implementation. |
| `codex` | `codex app-server` over JSON-RPC, plus JSONL transcript reload |
| `opencode` | ACP (shared code in `src/providers/acp/`) |
| `hermes` | ACP (`hermes acp`); model catalog + modes come from `session/new`, history from `~/.hermes/state.db` |
| `cline` | `--print`, plus the `/goal` verification loop (see below) |
| `kimi` | `--print` + full-message NDJSON, plus an ACP runtime |
| `vibe` | `--print` + full-message NDJSON |
| `grok` | `--print` + delta JSON with resume |
| `dsh` | `--print` |
| `antigravity` | `agy --print`, single-shot; state recovered by tailing `transcript.jsonl` |
| `pi` | `--print` |
| `zcode` | Z.ai GLM; CLI **or** direct API mode, chosen in settings |
| `omp` | ACP (`omp acp`); Oh My Pi. Model catalog, modes (`default`/`plan`) and thinking levels all arrive as `session/new` **config options**; history is JSONL under `~/.omp/agent/sessions/` |
| `grok-bot`, `perplexity-chat` | Desktop relay (`src/providers/desktopBridge/`). Not an API and not a CLI: a Swift helper drives the installed consumer app's own chat window. Shared code, two ids. Off by default; see the relay rules below. |

`Conversation` carries `providerId` plus opaque, provider-owned `providerState`.

**The two desktop relays are not coding agents.** They are a bounded, text-only
transport into someone else's chat UI, so `InputController` deliberately withholds
what every other provider gets: no automatic current-note/graph/RAG/memory recall,
no attachments, no auto-retry on timeout, no automatic memory writes. Explicitly
selected context still goes through. Anything you add to the send path must keep
that asymmetry — `useAutomaticContext` is the single switch.

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
engine, scheduled jobs), `budget/` (token budget, rate-limit windows, capacity and
cost), `bootstrap/` (session storage), `undo/` (vault snapshots for turn undo),
`timeline/` (run timelines), `memory/`, `audio/`, `diagnostics/`.

## Three subsystems you will not find by reading one file

**Goal loop (every provider).** A `/goal <text>` sets a standing objective AND
starts working on it immediately; the harness loop then re-runs turns until an
adversarial verifier agrees the goal is reached, or the loop hits its iteration
cap / stalls / is paused. The runner is provider-neutral:
`core/conversation/goalLoopRunner.ts` (moved out of Cline, which now re-exports it),
and `core/conversation/goalLoopRuntime.ts` wraps ANY runtime's query boundary so a
framed goal turns the turn into a verify-and-continue loop — Cline keeps its own
in-runtime wiring. `/goal pause|resume` suspends/resumes via `plugin.goalLoopPaused`;
`/goal done|clear` clears. Decision logic is pure in `core/conversation/goalLoop.ts`;
the wrapper sends visible work through the base runtime but runs adversarial
verification through a separate, session-isolated `AuxQueryRunner` with passive
permissions. Verifier usage is still accounted for without replacing the visible
turn's context meter. Loop turns suppress the duplicate `user_message_start` and
the loop owns the single terminal `done`.

**Native goals come first.** Providers with their own goal system declare
`capabilities.nativeGoal` (verified per trap 5), and `/goal` is handed to it
instead (`core/conversation/nativeGoal.ts` plans each sub-command):
- **Codex** (`rpc`): `thread/goal/set|clear`, status/budget via `thread/goal/updated`.
  Codex starts the follow-up rounds itself; the query holds its `done` across them
  (`GOAL_CONTINUATION_GRACE_MS`) and pauses the goal on Stop, so it never keeps
  working with no answer open.
- **Claude** (`slash`): raw `/goal <condition>`; Claude Code's Stop hook keeps the
  answer going. `ClaudeGoalTracker` turns its `Stop hook feedback:` messages into rounds.
- **Kimi print** (`slash`): headless `/goal`; exit codes 0/3/6 = complete/blocked/paused.

While the chat runs on the owning provider (`conversation.goalProviderId`), no
`<standing_goal>` is framed and Claudian's loop stays out; after a switch to another
provider the same goal falls back to Claudian's loop. Rounds render as `goal_round`
content blocks; the banner shows the provider's status (`GoalBanner.setNative`).

**Master prompter (multi-agent).** Missions no longer fan the same question out to
every specialist. `MasterPrompterService` runs one planning pass that writes a
tailored prompt per specialist (`masterPlan.ts`), then routes each subtask to a
provider that still has usage headroom (`core/budget/providerCapacity.ts` +
`ProviderCapacityService`). A specialist's preferred provider is a hint that only
wins when that provider has capacity. Both the `/team` inline flow and the mission
modal go through `plugin.runMasterMission`.

**Usage & cost center.** `renderUsageCostSection` is one surface with two entry
points (settings General tab and the dashboard's `TokenUsageModal`). Costs come
from `core/budget/providerPricing.ts`, which models subscription vs metered billing
and never invents a rate: an unpriced metered model reports "rate missing" rather
than a plausible-looking number. Streamed usage is explicitly a `snapshot`,
`final`, or additive `delta`; hidden title/refine/inline-edit/verifier calls use
the same accounting boundary and fall back to a marked estimate only when the
provider exposes no telemetry.

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
7. **An ACP agent can fail by succeeding.** `hermes acp` answers `session/load`
   for an unknown session with a bare `{}` — not an error — and the next
   `session/prompt` then returns `stopReason: "refusal"` with no content, which
   reads as an empty but successful turn. Treat a load response with neither
   `models` nor `modes` as a miss, and turn an output-less terminal stop reason
   into a real error (`HermesChatRuntime.loadSession` / `describeUnproductiveStopReason`).
8. **A prompt preamble can disable the agent's own slash commands.** Hermes only
   intercepts `/cmd` when the prompt text *starts* with `/`
   (`acp_adapter/server.py`). Anything prepended — Claudian's vault instructions,
   a history bootstrap — turns `/compress` into ordinary chat text.
9. **Visible history is not the current transport prompt.** The pending user
   bubble stores sanitized display text, while the prepared turn also carries
   output, goal, note, memory, and RAG envelopes. On a cold start, remove the
   duplicate pending bubble from replay and append the prepared turn exactly
   once; returning history alone silently drops those contracts.

10. **State that must survive a quit never goes through `saveData`.** Obsidian
    rewrites `data.json` in place, and two shutdown paths (view `onClose` and
    plugin `onunload`) used to rewrite it concurrently while the app exited. A
    cut-off write left it empty and the next start came up with one blank tab —
    every open chat "gone". Tab layout and drafts now use
    `core/storage/atomicJsonFile` (serialized, deduplicated, temp file + rename)
    and are saved while the user works, so there is nothing left to write at quit.
11. **Another plugin can close the view before it has restored.** The Homepage
    plugin rebuilds the whole workspace on layout-ready ("Replace all open
    notes"), which runs `ClaudianView.onClose()` before the deferred tab restore
    finished. The empty layout it saved then overwrote the real one on every
    start. `ClaudianView.getSavableTabState()` returns nothing until
    `tabLayoutRestored` is set; any path that persists tab state must go
    through it.
12. **A runtime wrapper must forward every optional runtime method.**
    `withGoalLoop` (every provider but Cline) and the prompt-delivery wrapper
    build a new object from the base runtime; an optional method they do not
    copy silently disappears. Per-subagent stop (`canCancelSubagent` /
    `cancelSubagent`) was implemented and tested in two providers and still
    never reached the chat until both wrappers forwarded it. Both now go through
    `core/runtime/forwardOptionalRuntimeMethods`; its list is type-checked against
    `ChatRuntime`, so a new optional method that is not listed fails the build.
13. **Nothing at startup may touch every tab or the whole RAG index.** Provider
    warmup built its context with `getConversationById` (full hydration) before
    checking whether the tab was visible, so nine restored tabs parsed ~45 MB of
    session files and transcripts on the main thread at every start; the RAG
    index (~20 MB JSON) was parsed 2.5 s after start. Hidden tabs now read only
    in-memory state (`getConversationSync`), idle hidden tabs release their CLI
    (`TabManager.releaseIdleRuntimes`), and the index loads on first use or when
    idle (`VaultRAGService.ready`). `.claudian/perf/last-startup.json` records
    what each start cost.
14. **A chat that was never opened has an empty message list in memory.** The
    startup list holds header fields only (`_lazyMessages`). Settings reconcilers
    that invalidated sessions after an env/model change saved those chats as-is and
    erased their history. Every conversation save goes through
    `SessionStorage.saveConversation`, which merges an unloaded chat onto its file
    and refuses to write over a file it could not read. Session files and the index
    are written atomically (`VaultFileAdapter.writeAtomic`); a file that fails to
    parse is copied to `.claudian/recovery/` before anything can replace it; delete
    moves chats to `.claudian/trash/` (30 days, undo notice).

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
| `.claudian/tab-state.json` | Open-tab layout (atomic temp-file + rename writes) |
| `.claudian/composer-drafts.json` | Unsent composer drafts per chat (text, file chips, staged image ids) |
| `.claudian/sessions/*.meta.json` | Provider-neutral session metadata |
| `.claudian/trash/*.meta.json` · `trash-index.json` | Deleted chats, restorable for 30 days (provider transcripts are kept until purge) |
| `.claudian/recovery/*.meta.json` | Byte-exact copies of session files that failed to parse |
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
