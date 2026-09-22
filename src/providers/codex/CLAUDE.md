# Codex Provider

Adaptor for OpenAI Codex via `codex app-server` over stdio JSON-RPC 2.0.

## Protocol Overview

The app-server speaks JSON-RPC 2.0 over stdio (newline-delimited JSON) with a required startup handshake and three ongoing message flows:
- **Startup handshake**: client sends `initialize`, then notifies `initialized`
- **Client → Server** (request/response): `thread/*`, `turn/*`, `skills/list`
- **Server → Client** (notifications): streaming deltas, item events, `turn/completed`, usage
- **Server → Client → Server** (server requests): approval gates, user input requests — the server asks a question, the client responds

The `initialize` handshake is mandatory and must include `{ experimentalApi: true }` to unlock extended capabilities. Wire types are probed against a specific app-server version in `codexAppServerTypes.ts`.

## Design Decisions

### Live Streaming Uses Raw JSON-RPC

Live turn output is streamed from `codex app-server` JSON-RPC notifications. `thread/start` and `thread/resume` request `experimentalRawEvents: true`, and `CodexNotificationRouter` projects both normalized item notifications and raw `rawResponseItem/completed` payloads into Claudian `StreamChunk`s.

**Why raw RPC owns live output**: polling the provider JSONL transcript during an active turn makes renderer work scale with total transcript size. Raw JSON-RPC preserves the provider-native `function_call`, `function_call_output`, `custom_tool_call`, and `custom_tool_call_output` payloads without rereading the transcript file.

JSONL remains the provider-owned replay source for history hydration and session-file discovery. Do not reintroduce live JSONL polling unless the app-server stops emitting an equivalent raw notification and the tradeoff is documented with a current wire trace.

### Skill Listing Via Ephemeral Process

`CodexSkillListingService` spawns a **separate short-lived app-server process** for each `skills/list` RPC call (TTL-cached for 5 seconds). This avoids coupling skill discovery to the chat runtime lifecycle — skills can be listed even when no chat is active, and skill discovery errors can't crash the main runtime.

### Environment Hash Invalidation

`codexSettingsReconciler` watches `OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`. Any hash change invalidates all existing Codex sessions (clears `sessionId` and `providerState`), preventing the UI from trying to resume sessions against a different API endpoint.

## Non-Obvious Behaviors

### Thread Resume Requirement

The app-server requires `thread/resume` before any operation on an existing thread in a new daemon process. `loadedThreadId` tracks which thread has been resumed in the current daemon session. If the process is killed and restarted, the next query will resume the thread first. For forks, `thread/resume` must be called on the **new fork** (not the source) before `thread/rollback`.

### Pending Turn Notification Buffering

The server may emit notifications before the client has processed the `turn/start` RPC response and set `currentTurnId`. These early notifications buffer in `pendingTurnNotifications` and flush once the turn ID is established.

### Compact Turn ID

For normal turns, the turn ID comes from the `turn/start` RPC response. For compact (`thread/compact/start`), the response is `{}` with no turn ID — the ID is established when the `turn/started` notification arrives. `routeNotification` handles this special case.

### JSONL Format Duality

A single session file may contain both legacy (`type: 'event'`) and modern (`type: 'event_msg'`, `type: 'response_item'`) records. The parser scans all records and uses the modern path if any modern records are present. A `type: 'compacted'` record completely resets the turn context and replays from `replacement_history`.

### Image Lifecycle

Images are written to a temp directory (`os.tmpdir()/claudian-codex-images-{random}/`), passed as `{ type: 'localImage', path }` inputs, and cleaned up in the `query()` `finally` block.

### Subagents (Child Threads)

Codex runs each subagent as its own thread. Two wire dialects exist and both are handled:

- **Collab items** (`collabAgentToolCall`): `spawnAgent`'s `receiverThreadIds[0]` is the child; `wait` / `interruptAgent` / `listAgents` report `agentsStates`. The router turns them into snake_case tool calls whose result JSON (`agent_id`, `receiver_thread_ids`, `agents_states`) the lifecycle adapter reads.
- **Multi-agent v2** (Codex Desktop, `spawn_agent {task_name, fork_turns, message}`): there is no `wait`. The parent gets `subAgentActivity` items — `started` shares its id with the spawn call and names `agentThreadId`; `completed`/`interrupted` carry a synthetic id. The router replays those completions as a hidden `subagent_activity` status call (with `spawn_tool_id`), because the chat only settles lifecycle cards from status calls. The spawn `message` is Fernet-encrypted: never display it (`isOpaqueCodexPayload`).

`CodexChildThreadRelay` owns child-thread traffic. `CodexChatRuntime` offers every notification to it **before** the foreign-thread rejection (so a child's `turn/*` never touches the parent's turn state) and lets it observe parent items **after** the router (so the spawn `tool_use` precedes relayed chunks). Each child gets its own `CodexNotificationRouter`; only tool calls and text survive as `subagent_tool_use` / `subagent_tool_result` / `subagent_text`, keyed by the spawn tool-call id. Usage, `done`, thinking, notices, plans and errors are dropped — a child must never move the parent's context meter or end its turn. Child traffic seen before the spawn names the thread is buffered (200 per thread, oldest dropped).

The relay survives the end of a parent turn (background agents keep running) and is reset only when the parent thread changes, the session is reset, or the app-server restarts. `cancelSubagent` sends `turn/interrupt` for the child's own live turn; the stop is confirmed with `subagent_update { cancelled: true }` once that turn ends `interrupted`. Child chunks arriving while no `query()` is streaming are dropped.

### `serverRequest/resolved`

The server can resolve approval/ask-user requests without waiting for client input (e.g., timeout). The `serverRequest/resolved` notification auto-dismisses the pending approval/ask-user UI.

## Gotchas

- `CodexAuxQueryRunner` uses its own separate process + transport + thread — completely independent from the chat runtime
- `CodexTaskResultInterpreter` is all no-ops — Claudian's async agent task system (used for Claude) doesn't apply to Codex
- Session file paths may include a date prefix (`{date}-{threadId}.jsonl`) — `findCodexSessionFile` handles both patterns via DFS fallback
- Codex is opt-in: `isEnabled()` defaults to `false`
