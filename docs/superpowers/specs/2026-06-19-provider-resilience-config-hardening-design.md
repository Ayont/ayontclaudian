# Provider Resilience & Config Hardening — Design

## Workstream

ayontclaudian 4.0.0 worktree `-wt-2`.

## Goals

1. Add a provider health-check (ping/version) before starting a chat turn.
2. Harden CLI install detection and model-config synchronization, building on the Kimi CLI model-config fix from 3.0.6.
3. Add a unified provider-config validator and auto-repair for broken/missing settings.
4. Cover new logic with unit tests.

## Non-goals

- No new UI panels or settings tabs (keep changes minimal).
- No changes to other workstreams (`-wt-1`, `-wt-3`, `-wt-4`).
- No `console.log` clean-up (out of scope).

## Existing state

- `src/core/diagnostics/providerHealthCheck.ts` probes CLIs with `--version` and formats a Markdown report. It is only used by the diagnostics command.
- `src/core/install/cliDetection.ts` checks whether a CLI binary is on PATH via `findCliBinaryPath`.
- Kimi 3.0.6 fix: `ensureKimiModelConfigured()` writes missing custom models to `~/.kimi/config.toml` before spawn, and the model dropdown only shows configured models.
- Provider configs live in `settings.providerConfigs[providerId]`. Defaults are in `src/providers/<id>/settings.ts` and aggregated in `src/providers/defaultProviderConfigs.ts`.
- `ProviderWorkspaceRegistry.getCliResolver(providerId)` returns a provider-specific resolver.

## Proposed changes

### 1. Pre-flight provider health check

Extend `src/core/diagnostics/providerHealthCheck.ts`:

- `checkProviderHealth(providerId, settings, options)` resolves the CLI path, probes `--version` with the provider's runtime environment, and returns `{ ok, command, version, detail }`.
- `ensureProviderHealthy(providerId, settings, options)` returns an error result instead of throwing.
- Cache the last result per provider for a short TTL (e.g. 10 s) so rapid UI calls do not spawn repeatedly.

Integration point: call `ensureProviderHealthy` from `ClaudianPlugin.sendMessage` / chat controller before starting a turn. If unhealthy, emit a `StreamChunk` error so the UI shows the failure inline.

### 2. Hardened CLI install detection

Extend `src/core/install/cliDetection.ts`:

- `resolveProviderCliPath(providerId, settings)` uses `ProviderWorkspaceRegistry.getCliResolver` when available, falling back to `findCliBinaryPath(binary)` from the install catalog.
- `isProviderCliInstalled(providerId, settings)` reuses the resolver path.
- Keep `isCliInstalled(providerId, additionalPath)` for callers that only need PATH detection.

Harden `src/utils/cliBinaryLocator.ts`:

- `resolveConfiguredCliPath` skips broken symlinks (current code stats the link target implicitly through `fs.statSync`; ensure it follows only valid links).
- Add `findCliBinaryPathSafe` returning `{ path: string; isShim: boolean }` so Windows `.cmd` shims can be flagged.

### 3. Unified provider-config validator & auto-repair

New `src/core/providers/providerConfigValidator.ts`:

- `ProviderConfigIssue` type: `{ providerId; severity: 'error' | 'warning'; code; message; autoRepairable: boolean }`.
- `validateProviderConfig(providerId, settings)` returns issues.
- `repairProviderConfig(providerId, settings)` merges missing defaults and clears invalid structural values. Returns `{ repaired: boolean; issues: ProviderConfigIssue[] }`.
- `validateAllProviderConfigs(settings)` iterates registered providers.

Provider-specific validation is delegated through a lightweight `ProviderConfigValidator` registered per provider in `src/providers/<id>/registration.ts` (optional). Built-in cross-cutting checks:

- `enabled` must be boolean.
- `cliPath`, if non-empty, must point to an existing file.
- `environmentVariables` must be a string.
- Provider-specific checks can be added later without touching the core.

Auto-repair on load: in `ClaudianSettingsStorage.load()`, after merging defaults, call `repairProviderConfig` for every registered provider and persist if anything changed.

### 4. Model-config synchronization abstraction

New `src/core/providers/modelConfigSync.ts`:

- `ProviderModelConfigSync` interface: `{ syncModelConfig(model, settings): boolean }`.
- `ModelConfigSyncRegistry` to register provider-specific syncers.
- `syncProviderModelConfig(providerId, model, settings)` delegates to the registered syncer or returns false.

Kimi registration: move the existing `ensureKimiModelConfigured` logic behind the registry in `src/providers/kimi/modelOptions.ts` and call `syncProviderModelConfig` from `KimiChatRuntime` before spawn and from `kimiSettingsReconciler` when the model changes.

## Files expected to change

- `src/core/diagnostics/providerHealthCheck.ts`
- `src/core/install/cliDetection.ts`
- `src/utils/cliBinaryLocator.ts`
- `src/core/providers/providerConfigValidator.ts` (new)
- `src/core/providers/modelConfigSync.ts` (new)
- `src/core/providers/types.ts` (add optional validator/syncer contracts)
- `src/providers/kimi/modelOptions.ts`
- `src/providers/kimi/runtime/KimiChatRuntime.ts`
- `src/providers/kimi/registration.ts`
- `src/app/settings/ClaudianSettingsStorage.ts`
- `src/main.ts` (pre-flight check in send flow, optional diagnostics command reuse)
- Tests:
  - `tests/unit/core/diagnostics/providerHealthCheck.test.ts`
  - `tests/unit/core/install/cliDetection.test.ts`
  - `tests/unit/core/providers/providerConfigValidator.test.ts` (new)
  - `tests/unit/core/providers/modelConfigSync.test.ts` (new)
  - `tests/unit/providers/kimi/modelOptions.test.ts` (extend)

## Testing strategy

- Unit-test health-check cache, timeout, and error paths by mocking `probeCli`.
- Unit-test validator/repair with mocked defaults and a fake provider registration.
- Unit-test CLI detection with mocked resolvers and `findCliBinaryPath`.
- Unit-test Kimi model-config sync in isolation using temp `KIMI_HOME`.
- After every change run `npm run typecheck && npm run lint && npm run test && npm run build`.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Pre-flight check adds latency | Cache results for 10 s; probe only when CLI path resolved. |
| Auto-repair overwrites user intent | Only repair structural defaults / invalid types, never model or preference values. |
| Windows shim false positives | Flag shims but still accept them; health check will catch non-executable shims. |
| Breaking existing tests | Run full unit suite after each change; keep old `isCliInstalled` signature. |
