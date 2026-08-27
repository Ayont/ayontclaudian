# Adding a Provider

Playbook for wiring a new coding-agent CLI into ayontclaudian.

> **Introspect first — never guess.**
> Run `<cli> --help`, `<cli> --version`, and read the README plus any config under
> `~/.<cli>/` to establish the **exact** flags, output schema, auth flow, and model
> ids. Every provider capability that shipped wrong in this codebase was a guess.
> Vibe and Grok were both built directly against the real binary.

## Prerequisite

The CLI needs a **headless / print mode** that answers a single request — typically
`-p` / `--prompt "…"`, ideally with `--output-format json|streaming-json`.

If the CLI speaks **ACP** instead, use Opencode as the template: the shared
transport already lives in `src/providers/acp/`.

## Reference providers

Copy the one whose transport matches your CLI:

| Shape | Copy from |
|---|---|
| Print + delta JSON + resume | `src/providers/grok/` |
| Print + full-message NDJSON (one complete OpenAI message per line) | `src/providers/kimi/`, `src/providers/vibe/` |
| ACP | `src/providers/opencode/` + `src/providers/acp/` |
| Single-shot print, state recovered by tailing a transcript | `src/providers/antigravity/` |
| HTTP + SSE against a local app API (no child process) | `src/providers/freebuff/` |
| Official SDK (full-feature reference) | `src/providers/claude/` |

## Steps

1. **Scaffold.** `cp -R src/providers/vibe src/providers/<id>`, rename `Vibe*` files
   to `<Id>*`, then rewrite identifiers across the copied `.ts` files:
   `sed -i '' 's/VIBE/<ID>/g; s/Vibe/<Id>/g; s/vibe/<id>/g'`
2. **LaunchSpec** (`runtime/<Id>LaunchSpec.ts`) — the real flags: prompt, output
   format, model (`-m`), cwd, permission posture
   (`--always-approve` / `--permission-mode`), resume (`-r <session>`).
   Argument **order** can matter; some CLIs use Go's `flag` package and stop
   parsing at the first bare positional.
3. **Parser** (`normalization/streamEvents.ts` + `streamMapping.ts`) — match the
   real schema, and capture the **sessionId** so resume works.
4. **ChatRuntime** (`runtime/<Id>ChatRuntime.ts`) — parse loop, sessionId mirror,
   model selection.
5. **Models** (`types/models.ts`) — real model ids, default, **per-model context
   windows**, `DEFAULT_<ID>_MODELS`.
6. **registration.ts** — `displayName`, `environmentKeyPatterns` (e.g. `[/^XAI_/i]`),
   and `createAuxQueryRunner`. The auxiliary runner must start a fresh, passive,
   session-isolated query for hidden title/refine/edit and adversarial goal
   verification calls; it must never reuse or mutate the visible chat session.
7. **Register** in `src/providers/index.ts`: `ProviderRegistry.register('<id>', …)`
   **and** `ProviderWorkspaceRegistry.register('<id>', …)`. Plus one entry in
   `defaultProviderConfigs.ts`. `ProviderId` is a bare `string` — there is no union
   to maintain.
8. **Icon** (`src/shared/icons.ts`) — `<ID>_PROVIDER_ICON`. Gradient logos use
   `kind: 'composite'` with `defs > linearGradient > stop` (see Mistral/Grok).
   Return it from `getProviderIcon()` in `ui/<Id>ChatUIConfig.ts`.
9. **Brand color** — four places:
   - `src/style/base/variables.css`: `--claudian-brand-<id>` (+ `-rgb`), a
     light-theme override, and a `.claudian-container[data-provider="<id>"]` rule
   - `src/style/components/tabs.css`: streaming border + tab underline
   - `src/features/chat/ui/ProviderStatusBar.ts`: `PROVIDER_COLOR`
   - optional `brandColor` / `brandColorLight` on the registration (themes the
     multi-agent modal)
10. **Install catalog** (`src/core/install/cliInstallCatalog.ts`) — `binary`,
    `methods` (mac/win/linux command), `docsUrl`. Drives the in-app CLI installer
    and the "greyed out when not installed" state.
11. **capabilities.ts / settings.ts** — ship `enabled: false` and declare the
    verified prompt-delivery policy: `native-system`, `session-preamble`, or
    `stateless-turn`. Never rely on the compatibility fallback in production.
12. **Locales** — `src/i18n/locales/*.json` (10 files).
13. **Tests** — at minimum a parser test under `tests/unit/providers/<id>/`.
    Note the three newest providers are the *thinnest* examples (vibe has 3 test
    files, grok 4, antigravity 8); prefer `claude` (42) or `codex` (31) as the
    model for what coverage should look like.
14. **Verify** — `npm run typecheck && npm run lint && npm run test && npm run build`,
    all green with 0 lint errors. Then deploy (see [`../CONTRIBUTING.md`](../CONTRIBUTING.md)).

## `ProviderRegistration` fields

Required: `displayName`, `blankTabOrder`, `isEnabled`, `capabilities`,
`chatUIConfig`, `settingsReconciler`, `createRuntime`,
`createTitleGenerationService`, `createInstructionRefineService`,
`createInlineEditService`, `historyService`, `taskResultInterpreter`.

Optional: `environmentKeyPatterns`, `subagentLifecycleAdapter`, `configValidator`,
`modelConfigSync`, `defaultConfig`, `brandColor`, `brandColorLight`,
`createAuxQueryRunner`. Although optional in the compatibility type, every new
provider must implement `createAuxQueryRunner`; without it the goal loop can only
fall back to the agent's own completion marker.

## Known traps

These are the ones that actually cost time.

- **Disabled by default.** A new provider ships `enabled: false`, so it will not
  appear in the model picker until it is switched on under Settings → Setup →
  Enable. This looks like a broken registration.
- **Provider switch inside one chat: never pass a foreign `sessionId` to a CLI.**
  Use only your own `providerState` session. A shared `conversation.sessionId` is
  safe only if it genuinely belongs to this provider — otherwise the CLI answers
  "session/conversation not found". Reference:
  `AntigravityChatRuntime.syncConversationState` (plus its `hasAntigravityTranscript`
  guard), and `isSessionExpiredError` recovery in `utils/session.ts` for Claude.
- **Fresh retries need the prepared current turn, not only display history.** On
  a stale native session, replay bounded/sanitized history, remove a pending
  duplicate current user bubble, and append the full prepared prompt once. Keep
  output/goal/context envelopes and emit `user_message_start` only once. See
  `core/conversation/printRetryHistory.ts`.
- **Commands and skills need explicit expansion.** Set
  `supportsProviderCommands: true`, register `SharedVaultCommandCatalog` in
  WorkspaceServices, and call `expandProviderCommandInput()` in the send path —
  print-mode CLIs do **not** expand `/cmd` or `$skill` themselves.
- **Context meter for CLIs that report no tokens.** Use
  `buildEstimatedUsageInfo` (`core/providers/usage/estimateUsage.ts`) and emit a
  `usage` event with `reportType: 'final'` before `done` (see Kimi / Antigravity / Vibe / Grok). Because
  nothing corrects the estimate downstream, the **context window must be per
  model** — a flat default silently mis-scales the badge for every model that
  differs from it.
- **Keepalive.** A watchdog kills turns that go silent; long-running providers must
  emit keepalive so a slow-but-alive turn is not treated as dead.
