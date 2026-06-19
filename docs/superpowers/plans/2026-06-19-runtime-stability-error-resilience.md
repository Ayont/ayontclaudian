# Runtime Stability & Error Resilience — Implementation Plan

**Workstream:** Runtime Stability & Error Resilience  
**Branch:** 4.0.0-dev-wt-1  
**Date:** 2026-06-19

## Phase 1 — Logger + tests

1. Create `src/utils/logger.ts` with `Logger` interface, `createLogger(scope)`, `pluginLogger`, and a `NO_OP_LOGGER`.
2. Create `tests/unit/utils/logger.test.ts` (TDD).
3. Run `npm run typecheck && npm run lint && npm run test -- --selectProjects unit && npm run build`.
4. Commit.

## Phase 2 — Error recovery service + tests

1. Create `src/core/diagnostics/errorRecovery.ts` with `ProviderErrorState` and `ProviderErrorRecoveryService`.
2. Create `tests/unit/core/diagnostics/errorRecovery.test.ts` (TDD).
3. Run tests and build.
4. Commit.

## Phase 3 — Wire recovery into chat controllers

1. In `InputController.sendMessage`, replace the raw `**Error:**` append with a `StreamChunk` of type `error` and record the error via `ProviderErrorRecoveryService`.
2. In `StreamController.handleStreamChunk` for `error` chunks, record the error via the recovery service.
3. Add `ProviderErrorRecoveryService` to the plugin (`ClaudianPlugin`) and pass it to the chat tab / controllers.
4. Run tests and build.
5. Commit.

## Phase 4 — Status-panel UI

1. Add error-state rendering to `ProviderStatusBar` with restart/clear callbacks.
2. Add `setErrorState` / `clearErrorState` to `StatusPanel`, rendering a recovery card.
3. Add i18n keys for new strings.
4. Create/update unit tests for `ProviderStatusBar`.
5. Run tests and build.
6. Commit.

## Phase 5 — Dashboard alert + console replacement

1. Make `ClaudianDashboardView` listen to `ProviderErrorRecoveryService` changes and render a top alert.
2. Replace `console.*` calls in `PluginUpdater.ts` with the logger.
3. Run full test + build + lint.
4. Commit.

## Phase 6 — Final verification & report

1. Run `npm run typecheck && npm run lint && npm run test && npm run build`.
2. Write `WORKSTREAM_REPORT.md`.
3. Final commit.
