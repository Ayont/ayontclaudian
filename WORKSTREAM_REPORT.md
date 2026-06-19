# Workstream Report: Multi-Agent Mission Polish (wt-4)

## Summary

Implemented crash-recovery, synthesis improvements, and a mission timeline/log viewer for ayontclaudian 4.0.0 multi-agent missions.

### What changed

1. **Mission state persistence**
   - Added `MissionState`, `MissionAgentState`, `MissionSynthesisState`, and `MissionEvent` types.
   - Added `MissionStateStorage` service that persists mission state to `.claudian/missions/{taskId}.json` and append-only event logs to `.claudian/missions/{taskId}.events.jsonl`.

2. **Resumable missions**
   - Extended `MultiAgentService.runMission` with optional `storage` and `onEvent` callbacks; state is saved after every progress update and on completion.
   - Added `MultiAgentService.resumeMission` which skips already-done agents, re-runs pending/errored agents, and re-runs synthesis when any agent succeeds.

3. **Improved synthesis**
   - Extracted `buildSynthesisPrompt` helper and updated `main.ts` `runSynthesisPrompt` to use it.
   - New prompt explicitly requests conflict resolution, de-duplication, specialist citations, and a concise actionable answer.

4. **Mission timeline / event log viewer**
   - Added `mission:event` to the global event bus.
   - `MultiAgentModal` now emits timeline events (started, agent-started/done/error, synthesis-started/done/error, completed, resumed) both to storage and the bus.
   - Dashboard subscribes to `mission:event` and shows a new **Mission Log** action button that exports the last 50 missions with their event timelines to a markdown note.
   - Added pure `formatMissionLogMarkdown` helper for testability.

5. **Tests**
   - `MissionStateStorage.test.ts` — save/load/list/delete, event JSONL, missing files, corrupt lines.
   - `MultiAgentService.test.ts` — persistence callbacks, resume re-runs errored agents only, resume synthesis, synthesis prompt content.
   - `formatMissionLogMarkdown.test.ts` — markdown output and empty state.

## Files touched

- `src/core/bootstrap/StoragePaths.ts`
- `src/core/events/EventBus.ts`
- `src/core/intelligence/multiAgent/MissionStateStorage.ts` (new)
- `src/core/intelligence/multiAgent/MultiAgentService.ts`
- `src/core/intelligence/multiAgent/formatMissionLogMarkdown.ts` (new)
- `src/features/dashboard/ClaudianDashboardView.ts`
- `src/features/multiAgent/MultiAgentModal.ts`
- `src/main.ts`
- `tests/unit/core/intelligence/multiAgent/MissionStateStorage.test.ts` (new)
- `tests/unit/core/intelligence/multiAgent/MultiAgentService.test.ts`
- `tests/unit/core/intelligence/multiAgent/formatMissionLogMarkdown.test.ts` (new)
- `docs/superpowers/specs/2026-06-19-multi-agent-mission-polish-design.md`
- `docs/superpowers/plans/2026-06-19-multi-agent-mission-polish.md`
- `WORKSTREAM_REPORT.md`

## Test results

```text
npm run typecheck   ✓
npm run lint        ✓ (0 errors, 61 pre-existing warnings)
npm run test        ✓ 5971 unit tests passed
npm run build       ✓
```

## Blockers / follow-ups

- No blockers.
- Future polish: expose a "Resume last mission" command in the command palette and surface persisted missions directly in the multi-agent modal.
- No files from the other three workstreams were touched.
