# Runtime Stability & Error Resilience — Design Doc

**Workstream:** Runtime Stability & Error Resilience  
**Branch:** 4.0.0-dev-wt-1  
**Date:** 2026-06-19  
**Scope:** chat sidebar + dashboard, provider runtimes, logging.

## Goals

1. Centralize error handling so the chat sidebar and dashboard do not silently break when a provider CLI misbehaves.
2. Gracefully degrade when a provider process crashes or exits non-zero: surface a structured card, keep the conversation, and offer recovery actions.
3. Give users a "Restart Provider" / "Clear Error" affordance in the status panel.
4. Replace remaining `console.*` production calls with a plugin logger so diagnostics are consistent.
5. Add unit tests for the new recovery paths.

## Non-goals

- Do not rewrite provider adaptors (Claude/Codex/Kimi/…).
- Do not change the multi-agent mission recovery logic (owned by workstream 4).
- Do not add new provider health checks (owned by workstream 2).

## Current state

- `StreamController` already emits `❌ **Error:**` / `⚠️ **Blocked:**` / `⚠️ **Notice:**` markers and `errorClassification.ts` turns them into status cards.
- `errorHistory.ts` keeps an in-memory ring buffer of recent provider errors.
- `InputController.sendMessage` catches errors from `agentService.query()` and appends a raw `**Error:**` markdown line, but does not attempt recovery.
- Three `console.*` calls remain in `src/app/update/PluginUpdater.ts`.
- No plugin logger exists; no centralized error-boundary service exists.

## Proposed changes

### 1. Plugin logger (`src/utils/logger.ts`)

A tiny typed logger factory:

```ts
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
```

- Production implementation writes to `console` only when `process.env.NODE_ENV === 'development'` or a plugin setting enables verbose logging; otherwise it no-ops. This keeps the existing behavior (no console spam in released builds) while giving us a single seam to adjust later.
- A `createLogger(scope: string)` helper prefixes messages with `[ayontclaudian:<scope>]`.
- Exported singleton `pluginLogger` for modules that do not have DI access.

### 2. Error recovery service (`src/core/diagnostics/errorRecovery.ts`)

A provider-scoped recovery coordinator used by `InputController` and the dashboard:

```ts
export interface ProviderErrorState {
  providerId: ProviderId;
  error: Error;
  classified: ClassifiedError;
  timestamp: number;
  cleared: boolean;
}

export class ProviderErrorRecoveryService {
  recordError(providerId: ProviderId, error: Error): ClassifiedError;
  clearError(providerId: ProviderId): void;
  getError(providerId: ProviderId): ProviderErrorState | null;
  hasActiveError(providerId: ProviderId): boolean;
  isRecoverable(providerId: ProviderId): boolean;
  onChange(listener: (providerId: ProviderId) => void): () => void;
}
```

- Classifies errors via `classifyProviderError`.
- Stores one active error per provider so UI can render recovery actions.
- Emits change events so the status panel and dashboard can re-render.
- `isRecoverable` returns `true` when the classified error is `retryable` and the provider process is considered gone (e.g. CLI exited).

### 3. Graceful degradation in `InputController`

When `agentService.query()` throws:

1. Record the error in `ProviderErrorRecoveryService`.
2. Emit a structured `error` stream chunk so `StreamController` renders a status card (instead of raw markdown).
3. Reset streaming state and mark the provider as needing restart if the error looks like a process crash.
4. Do not append raw `**Error:**` text.

For non-zero CLI exits detected inside provider runtimes (they already emit `error` chunks), the service picks up the chunk and records it.

### 4. "Restart Provider" / "Clear Error" UI

Extend `ProviderStatusBar` and `StatusPanel` to show recovery state:

- `ProviderStatusBar.update` accepts an optional `errorState` field; when present the dot turns into an error indicator and a click offers "Restart Provider" / "Clear Error".
- `StatusPanel` gets `setErrorState` / `clearErrorState` methods. When an active error exists, it renders a compact card above the bash/todo sections with:
  - title + hint from `ClassifiedError`,
  - "Restart" button (resets session, re-initializes runtime, clears error),
  - "Clear" button (dismisses the error banner).

The dashboard also listens to `ProviderErrorRecoveryService` change events and shows a top-level alert when the active provider has an error.

### 5. Replace `console.*` in `PluginUpdater.ts`

Use `createLogger('updater')` for the three existing log sites.

## Files touched

- `src/utils/logger.ts` (new)
- `src/core/diagnostics/errorRecovery.ts` (new)
- `src/core/diagnostics/errorHistory.ts` (minor: import logger)
- `src/features/chat/controllers/InputController.ts` (use recovery service)
- `src/features/chat/controllers/StreamController.ts` (route errors through recovery service)
- `src/features/chat/ui/ProviderStatusBar.ts` (error indicator + actions)
- `src/features/chat/ui/StatusPanel.ts` (error card + restart/clear buttons)
- `src/features/dashboard/ClaudianDashboardView.ts` (error alert)
- `src/app/update/PluginUpdater.ts` (replace console.*)
- `src/i18n/locales/en.json`, `src/i18n/locales/de.json`, `src/i18n/types.ts` (new keys)
- `tests/unit/utils/logger.test.ts` (new)
- `tests/unit/core/diagnostics/errorRecovery.test.ts` (new)
- `tests/unit/features/chat/ui/ProviderStatusBar.test.ts` (new)

## Test strategy

- Unit tests for logger factory and log-level gating.
- Unit tests for `ProviderErrorRecoveryService`:
  - record/clear/get/hasActiveError,
  - classification pass-through,
  - change listener delivery,
  - `isRecoverable` logic.
- Unit tests for `ProviderStatusBar` error rendering and restart/clear callbacks.
- Existing tests must continue to pass.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Status panel DOM changes break visual tests | Keep new error card markup minimal and behind a conditional class. |
| Logger no-ops make local debugging harder | Logger still writes in development builds (`process.env.NODE_ENV === 'development'`). |
| Restart action can loop if provider keeps crashing | Only enable restart when classified as `retryable`; after two consecutive restarts within 30 s, disable the button and show "Check provider settings". |

## Follow-ups

- Wire the logger to a user-visible "Verbose logging" setting in a future release.
- Consider persisting the last error per provider for diagnostics copy.
