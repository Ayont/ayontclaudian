# Kimi Code CLI Full Port into Claudian — Design Spec

## 1. Goal

Port the complete Kimi Code CLI surface documented at:

- https://www.kimi.com/code
- https://www.kimi.com/code/docs/en/
- https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html
- https://moonshotai.github.io/kimi-code/llms-full.txt

into the Claudian Obsidian plugin so that every major Kimi Code CLI capability is available inside Obsidian.

## 2. Current State

The plugin already supports:

- Single-shot print mode (`kimi -p --output-format stream-json`)
- Modern and legacy `kimi` binary detection
- Session resume via `-S <id>` / `--session <id>`
- Standing `/goal` mirrored in plugin state
- Vault commands/skills in the `/` dropdown with `/` prefix for skills
- Model selection (3 coding models)
- Basic tool-call rendering and todo extraction

Missing:

- Interactive slash-command handling in the UI (`/new`, `/fork`, `/sessions`, `/login`, `/logout`, `/help`, `/exit`)
- Native session browser / resume UI
- Authentication flow (`kimi login`, OAuth device code, API key input)
- Plan mode interactivity (`--plan`, ExitPlanMode callback)
- YOLO / auto permission mode toggles per tab
- Subagent / swarm lifecycle UI
- Background task panel (`/tasks`)
- ACP / hooks / plugins / themes

## 3. Decomposition

Because the full port is too large for a single implementation cycle, we split it into five phases. Each phase produces a working, testable increment.

### Phase 1 — Slash Commands & Session Management (this spec)
### Phase 2 — Authentication (`/login`, `/logout`, API key settings)
### Phase 3 — Plan Mode & Approval Flow (`--plan`, YOLO/auto, ExitPlanMode)
### Phase 4 — Subagents / Swarm & Background Tasks
### Phase 5 — ACP, Hooks, Plugins, Themes (optional, lowest priority)

## 4. Phase 1 Design

### 4.1 Scope

Implement all Kimi Code CLI slash commands as first-class plugin UI actions:

| Command | Behaviour |
|---------|-----------|
| `/new` | Start a new Kimi session in the current tab, clearing local session id and goal. |
| `/fork` | Fork the current session (native `kimi` fork if available; otherwise copy session id and start a branched local tab). |
| `/sessions` | Open a native session list modal. Selecting a session resumes it in the current tab. |
| `/model` | Open the model picker (reuse existing dropdown). |
| `/compact` | Send `/compact` to Kimi and update local session metadata. |
| `/login` | Spawn `kimi login` and stream device-code/result output (Phase 2 detail, but command surfaced now). |
| `/logout` | Spawn `kimi logout` (or send `/logout`) and clear local auth state. |
| `/help` | Show a help modal listing all slash commands and shortcuts. |
| `/exit` | Close the current chat tab. |
| `/goal` | Already implemented; keep. |
| `/skill:*` | Already surfaced; keep. |
| `/plan`, `/swarm`, `/tasks`, `/usage`, `/status`, `/undo` | Surface in dropdown and pass through; richer UI comes in later phases. |

### 4.2 Architecture

Add a new `KimiSlashCommandHandler` service in `src/providers/kimi/commands/` that receives the expanded user input before it is sent to `KimiChatRuntime.query()`.

```
User types `/new`
  → command catalog resolves to static entry
  → InputController sends expanded text to KimiChatRuntime.query()
  → KimiChatRuntime detects leading slash command via KIMI_SLASH_COMMAND_RE
  → delegates to KimiSlashCommandHandler.execute()
  → handler performs UI/session action
  → optionally sends a follow-up prompt to Kimi (e.g. `/new` also starts a fresh turn)
```

### 4.3 Components

1. **`src/providers/kimi/commands/KimiSlashCommandHandler.ts`**
   - Parses `/command [args]`.
   - Maps commands to handlers.
   - Returns `{ consumed: boolean; followUpPrompt?: string }`.

2. **`src/providers/kimi/commands/KimiSessionListModal.ts`**
   - Obsidian `Modal` that lists Kimi sessions from `~/.kimi-code/sessions/` and `~/.kimi/sessions/`.
   - Uses existing `KimiSessionStore` helpers.
   - On select: update current tab state with chosen session id and re-render history.

3. **`src/providers/kimi/commands/KimiHelpModal.ts`**
   - Shows all slash commands and keyboard shortcuts.

4. **`src/providers/kimi/app/KimiWorkspaceServices.ts`**
   - Add static entries for `/new`, `/fork`, `/sessions`, `/login`, `/logout`, `/help`, `/exit`.

5. **`src/providers/kimi/runtime/KimiChatRuntime.ts`**
   - Detect leading slash command before building launch spec.
   - Route consumed commands to handler and skip the CLI spawn.
   - For non-consumed commands (pass-through), keep current behaviour.

6. **`src/providers/kimi/types.ts`**
   - Extend `KimiProviderState` with `forkParentId?: string` for `/fork`.

### 4.4 Data Flow

- `/new`: clear `sessionId`, `goal`, `forkParentId`; spawn `kimi -p "hello"` or just send a system message into the chat.
- `/sessions`: open modal; on select call `loadSession(id)` on the active tab controller.
- `/fork`: read current session id, spawn `kimi` with fork flag when available, otherwise duplicate local state with new ephemeral id and notify user.
- `/exit`: call `TabManager.closeTab(currentTabId)`.
- `/help`: open `KimiHelpModal`.
- `/model`: open existing model dropdown.
- `/compact`, `/undo`, `/usage`, `/status`: pass through to CLI unchanged.

### 4.5 Error Handling

- If `kimi` binary is missing, `/login`, `/logout`, `/new` show an inline error card.
- If session directory cannot be read, `/sessions` shows empty state with path.
- All handlers are async and wrapped in try/catch; failures render as `InlineError` in the chat.

### 4.6 Testing

- Unit tests for `KimiSlashCommandHandler` covering each command.
- Unit tests for `KimiSessionListModal` data extraction (without Obsidian DOM).
- Integration test: `/new` clears provider state.
- Existing test suite must still pass.

## 5. Later Phases (Summary)

### Phase 2 — Authentication
- Add `/login`, `/logout` handlers.
- Spawn `kimi login` and parse device-code output.
- Add API-key input in Kimi settings tab.
- Store auth status in plugin data.

### Phase 3 — Plan Mode & Approval
- Add `--plan` launch flag when plan mode active.
- Implement `setExitPlanModeCallback` in `KimiChatRuntime`.
- Add YOLO (`-y`) and auto (`--auto`) toggles per tab.
- Render plan approval inline.

### Phase 4 — Subagents / Swarm & Background Tasks
- Implement `ProviderSubagentLifecycleAdapter` for Kimi.
- Parse `Agent`/`Task` tool calls and spawn child processes.
- Add background task panel and `/tasks` command integration.

### Phase 5 — ACP / Hooks / Plugins / Themes
- ACP server mode (`kimi acp` JSON-RPC bridge) — only if IDE integration is desired.
- Hook lifecycle script execution.
- Plugin/skill packaging and theme customization.

## 6. Success Criteria

After Phase 1:

- All slash commands listed in 4.1 appear in the `/` dropdown.
- `/new`, `/fork`, `/sessions`, `/model`, `/help`, `/exit` perform native UI actions.
- `/compact`, `/undo`, `/usage`, `/status` pass through to Kimi unchanged.
- Unit tests cover new handler logic.
- `npm run typecheck && npm run lint && npm run test -- --selectProjects unit && npm run build` passes.
