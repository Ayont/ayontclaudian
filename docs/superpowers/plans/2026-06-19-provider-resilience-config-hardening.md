# Provider Resilience & Config Hardening — Implementation Plan

## Phase 1: Foundation (no runtime wiring)

1. **Harden CLI binary locator**
   - Add `findCliBinaryPathSafe` to `src/utils/cliBinaryLocator.ts`.
   - Keep `findCliBinaryPath` unchanged for backwards compatibility.
   - Run `npm run typecheck && npm run lint && npm run test && npm run build`.

2. **Extend CLI detection**
   - Add `resolveProviderCliPath` and `isProviderCliInstalled` to `src/core/install/cliDetection.ts`.
   - Add unit tests in `tests/unit/core/install/cliDetection.test.ts`.
   - Run checks.

3. **Add provider-config validator**
   - Create `src/core/providers/providerConfigValidator.ts` with `validateProviderConfig`, `repairProviderConfig`, `validateAllProviderConfigs`.
   - Add optional `configValidator` to `ProviderRegistration` in `src/core/providers/types.ts`.
   - Create `tests/unit/core/providers/providerConfigValidator.test.ts`.
   - Run checks.

4. **Add model-config sync registry**
   - Create `src/core/providers/modelConfigSync.ts` with `ProviderModelConfigSync`, registry, and `syncProviderModelConfig`.
   - Add optional `modelConfigSync` to `ProviderRegistration`.
   - Create `tests/unit/core/providers/modelConfigSync.test.ts`.
   - Run checks.

## Phase 2: Provider-specific wiring

5. **Register Kimi model-config sync**
   - Move the existing `ensureKimiModelConfigured` call behind the sync registry in `src/providers/kimi/registration.ts`.
   - Call `syncProviderModelConfig` in `KimiChatRuntime` before spawning.
   - Call `syncProviderModelConfig` in `kimiSettingsReconciler.reconcileModelWithEnvironment` when the model changes.
   - Extend `tests/unit/providers/kimi/modelOptions.test.ts`.
   - Run checks.

6. **Register per-provider config validators (minimal)**
   - Add a minimal validator for Kimi and Codex that checks `enabled`, `cliPath`, and `environmentVariables` shape.
   - Keep other providers without validators (core cross-cutting checks still apply).
   - Run checks.

## Phase 3: Runtime integration

7. **Extend health-check service**
   - Add `checkProviderHealth` and `ensureProviderHealthy` to `src/core/diagnostics/providerHealthCheck.ts`.
   - Add a short TTL cache keyed by provider id.
   - Extend `tests/unit/core/diagnostics/providerHealthCheck.test.ts`.
   - Run checks.

8. **Wire pre-flight health check into chat send flow**
   - In `src/main.ts` `sendMessage` (or the chat controller it delegates to), call `ensureProviderHealthy` for the active tab's provider.
   - On failure, emit an inline error `StreamChunk` and stop the turn.
   - Run checks.

9. **Auto-repair on settings load**
   - In `src/app/settings/ClaudianSettingsStorage.ts`, after merging defaults, run `repairProviderConfig` for each registered provider and persist if repaired.
   - Run checks.

## Phase 4: Verification & reporting

10. **Run full verification**
    - `npm run typecheck`
    - `npm run lint`
    - `npm run test`
    - `npm run build`

11. **Commit history**
    - Conventional commits after each phase.

12. **Write `WORKSTREAM_REPORT.md`**
    - Summary, files touched, test results, blockers/follow-ups.
