# Chat Feature

Main sidebar chat interface. `ClaudianView` assembles tabs, controllers, renderers, and provider-backed services around the shared `ChatRuntime` boundary.

## Provider Boundary Status

- Chat features depend on `ChatRuntime`, `ProviderCapabilities`, and provider-neutral conversation data. `InputController` builds `ChatTurnRequest`; runtimes own prompt encoding through `prepareTurn()`.
- Session bookkeeping lives in `Conversation.providerState` and is usually updated through `ChatRuntime.buildSessionUpdates()`, with fork/bootstrap state also seeded through provider history services. Feature code must not read provider-specific fields directly.
- Provider-owned services are resolved through registries
  - `ProviderRegistry`: runtime, title generation, instruction refinement, inline edit, task-result interpretation
  - `ProviderWorkspaceRegistry`: command catalogs, agent mention providers, MCP managers, CLI resolution
- Current feature split
  - Claude exposes rewind, instruction mode, runtime command discovery, and in-app MCP controls
  - Codex exposes fork, history reload, plan mode, instruction mode, images, inline edit, `$` skills, and subagents, but not rewind

## Architecture

```text
ClaudianView (lifecycle + assembly)
├── ChatState
├── Controllers
│   ├── ConversationController
│   ├── StreamController
│   ├── InputController
│   ├── SelectionController
│   ├── BrowserSelectionController
│   ├── CanvasSelectionController
│   └── NavigationController
├── Services
│   ├── SubagentManager
│   └── BangBashService
├── Rendering
│   ├── MessageRenderer
│   ├── RichOutputFences
│   ├── LiveDocumentRenderer
│   ├── EmailTemplateRenderer
│   ├── NetworkMapRenderer
│   ├── ToolCallRenderer
│   ├── ThinkingBlockRenderer
│   ├── WriteEditRenderer
│   ├── DiffRenderer
│   ├── TodoListRenderer
│   ├── SubagentRenderer
│   ├── InlineExitPlanMode
│   ├── InlinePlanApproval
│   └── InlineAskUserQuestion
├── Tabs
│   ├── TabManager
│   ├── TabBar
│   └── Tab
└── UI Components
    ├── InputToolbar
    ├── FileContextManager
    ├── ImageContextManager
    ├── StatusPanel
    ├── NavigationSidebar
    ├── InstructionModeManager
    └── BangBashModeManager
```

## State Flow

```text
User Input
  -> InputController
  -> ensure runtime for active provider
  -> ChatRuntime.prepareTurn()
  -> ChatRuntime.query()
  -> StreamController
  -> MessageRenderer + ChatState persistence
```

The feature layer consumes provider-neutral `StreamChunk` values. Providers own prompt encoding, history/session fallback, and task-result interpretation.

`InputController` also resolves an application-owned `OutputSurface` for every
ordinary turn. The value is persisted on the assistant message and semantic text
blocks; it is not inferred again from rendered prose after reload.

## Controllers

| Controller | Responsibility |
|------------|----------------|
| `ConversationController` | Session switching, history reload, save, and rewind |
| `StreamController` | Consume stream chunks, update streaming state, auto-scroll, abort handling |
| `InputController` | Text input, mentions, images, resume dispatch, command dispatch, and post-plan approval flow |
| `SelectionController` | Editor selection polling and CM6 decorations |
| `BrowserSelectionController` | Browser view selection tracking |
| `CanvasSelectionController` | Canvas selection tracking |
| `NavigationController` | Vim-style keyboard navigation |

## Rendering Pipeline

| Renderer | Handles |
|----------|---------|
| `MessageRenderer` | Main message orchestration, rewind/fork affordances, interrupt markers |
| `RichOutputFences` | Fence inspection, tool-boundary continuity, fallback wrapping, map canonicalization |
| `LiveDocumentRenderer` | Editable document canvas plus explicit save/dock actions |
| `EmailTemplateRenderer` | Plain-text mail variants and copy/save controls |
| `NetworkMapRenderer` | Explicit `network-map` topology fences only |
| `ToolCallRenderer` | Tool blocks and tool state |
| `ThinkingBlockRenderer` | Thinking / reasoning summaries |
| `WriteEditRenderer` | File writes and edits with diff previews |
| `DiffRenderer` | Inline diff rendering |
| `InlineExitPlanMode` | Claude tool-driven exit-plan approval |
| `InlinePlanApproval` | Shared post-plan approval flow driven by consumed turn metadata (currently Codex) |
| `InlineAskUserQuestion` | Ask-user cards emitted by provider runtimes |
| `todoUtils` | The one todo renderer (header summary + list) shared by `StatusPanel` and the TodoWrite card; every provider's list is normalized by `core/tools/todo` first, ACP `plan` updates arrive via `providers/acp/AcpPlanTodoBridge` |
| `SubagentRenderer` | Background agent lifecycle rendering |

## Key Patterns

### Runtime Initialization — warmup, NOT lazy

`ensureServiceInitialized()` is the single entry point for provider runtime
creation, and `InputController` calls it before every send.

**Tabs do not stay cold until the first send.** Providers may declare a
`tabWarmupPolicy` that spawns the CLI as soon as a tab is opened or switched to, so
the cold-start cost is paid while the user is still typing. Claude
(`ClaudeWorkspaceServices`), Pi, and Opencode all register one.

If you are debugging an unexpected CLI process, look at the warmup policy first —
not at the send path.

### Message Streaming

```typescript
const preparedTurn = runtime.prepareTurn(request);

for await (const chunk of runtime.query(preparedTurn, history)) {
  streamController.handleStreamChunk(chunk);
}
```

### Streamed Markdown is rendered incrementally

`renderContent` empties the element and re-renders the whole string, so calling
it per frame with a growing answer is quadratic — that was the main source of
"the UI feels heavy on long answers". Streaming therefore goes through
`MessageRenderer.renderStreamingContent`, which commits settled Markdown once
and re-renders only the live edge.

- The cut comes from `findStableMarkdownSplit` and is deliberately conservative:
  only a blank line outside a code fence, never right after a list item, table
  row, or blockquote, since those can still be continued.
- Correctness does not depend on the cut. `finalizeStreamingContent` re-renders
  the full answer once when the stream ends, so a finished message is identical
  to a reloaded one. **If you add a new streaming render path, call it** — the
  committed/tail wrapper divs must not survive into the final DOM.
- Rich output surfaces bypass the split entirely; their passes inspect the
  complete Markdown and must never see a fragment.

### Auto-Scroll

- Enabled by default during streaming
- User scroll-up disables it
- Scroll-to-bottom re-enables it
- Resets to the saved setting on a new query

### Rich Output Continuity

- Specialized output is opt-in through `OutputSurface`; ordinary explanations remain `chat`.
- A document, email, skill, or network-map fence may stay open across thinking and tool chunks. `StreamController` keeps one semantic text block and preserves later prose order.
- Progressive maps are snapshots of one topology. Persist and render only the newest canonical frame.
- Document/email turns have a deterministic fenced fallback when a provider ignores the requested format. Network maps never infer topology from prose.
- `MessageRenderer` rehydrates assistant documents into the per-tab document library without writing to the vault. Only an explicit save action creates `.claudian/documents` files.
- Re-rendering identical content must remain idempotent; do not rebuild the full Markdown subtree or re-discover the same document on every frame.

## Subagents

One model, three surfaces. `SubagentManager` (per tab) is the only owner of
`SubagentInfo`; the inline card (`SubagentRenderer`), the swarm panel and the
inspector tab (`subagents/SubagentInspectorView`, a workspace leaf) all read it
through `subagents/subagentPresentation.ts`, so they never disagree about a
subagent's phase (`starting · running · stopping · completed · failed ·
cancelled · orphaned`).

- Providers report live facts as `subagent_update` (task id, type, model,
  activity line, counters, `cancelled`) and the subagent's own writing as
  `subagent_text`; child tools stay `subagent_tool_*`. Claude sends all of it
  (`forwardSubagentText`, `agentProgressSummaries`); Codex relays child threads
  (`CodexChildThreadRelay`); flat providers only give the Agent/Task call.
- Stopping goes through `SubagentActionController` for every surface. It stops
  exactly one subagent when the runtime implements `canCancelSubagent` /
  `cancelSubagent` (Claude `stopTask`, Codex `turn/interrupt` on the child
  thread), and otherwise says it will stop the whole answer. Two clicks, always.
- Card actions are delegated from the messages container via
  `data-subagent-action`; never nest a button inside the card's header.
- Cards restored from history never tick or offer Stop: no process is behind
  them. The inspector falls back to the saved conversation the same way.
- Codex lifecycle agents register with `trackLifecycleSubagent`; their spawn
  result arrives at once and must never go through the sync finalize path.

## Gotchas

- `ClaudianView.onClose()` must abort active tabs and dispose runtimes
- `ChatState` is per-tab; `TabManager` coordinates tab-level operations such as fork targets and provider-aware command catalogs
- Never derive a specialized surface from a loose substring such as `document`, `firewall`, or `image`; classification requires creation/operational intent or an explicit surface command
- Title generation runs concurrently per conversation and routes by the global title-generation model selection, not by the active chat tab provider
- `/compact`
  - Claude skips context injection so the provider recognizes the built-in command and persists the compaction boundary
  - Codex routes compact turns to `thread/compact/start` and persists the durable `context_compacted` boundary from JSONL history
- Plan mode
  - Claude uses provider/runtime events for enter and exit plan mode
  - Codex sets `collaborationMode` on `turn/start` and triggers shared post-plan approval from consumed turn metadata
- Bang-bash mode bypasses provider runtimes and executes a local shell command directly
  - It is available only when an enabled provider exposes it in `ProviderChatUIConfig` (currently Claude)
- Forking is provider-owned under the hood
  - Both Claude and Codex support fork
  - `ChatRuntime.resolveSessionIdForFork()` and provider history services own the provider-specific fork/session mapping
