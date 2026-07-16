# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.48.0] - 2026-07-16

### Added

- **Kimi K3 Support**:
  - Added `kimi-k3` (Moonshot flagship: 2.8T parameters, 1M-token context window, multimodal, always-on reasoning) to the curated Kimi model catalog.
  - Introduced a context-window catalog for known Kimi models: `kimi-k3` resolves to 1,048,576 tokens instead of the 256K coding default, and `ensureKimiModelConfigured` seeds new `[models.*]` config sections with the correct per-model `max_context_size`.

### Changed

- **Kimi Settings UI**: Feature showcase now lists the current model lineup (K3, K2.7 Code, K2.7 Code High-Speed, K2.6) and drops sunset models (K2 Turbo, Moonshot v1); settings placeholders reference `kimi-k3`.

### Fixed

- **Kimi Model Dropdown**: Curated catalog entries (K3, K2.7 Code) now surface with their curated labels and descriptions when configured — they were previously shadowed by generic "Configured" entries.

### Performance

- **Kimi Config Reads**: Memoized `~/.kimi/config.toml` / `~/.kimi-code/config.toml` parsing behind an mtime+size signature. The model dropdown previously re-read and re-parsed both files several times per rebuild; repeat reads are now stat-only.
- **Grok & Vibe Config Reads**: Applied the same stat-signature memoization to `~/.grok/config.toml` and `~/.vibe/config.toml`, and collapsed the duplicate config read in model resolution — one call chain now parses at most once.
- **Antigravity Transcript Polling**: The 120 ms transcript tail loop now `stat`s `transcript.jsonl` first and skips the full `readFileSync` + line split when the file is unchanged (O(1) instead of O(file) per poll — a whole turn was O(n²) on the main thread). Appends, rewrites, and truncation still trigger an immediate re-read.
- **CLI Resolution**: All provider CLI resolvers (Claude, Codex, Grok, Antigravity, Vibe, Opencode, Pi) now memoize their resolution — including misses — keyed on their inputs. The streaming status bar previously triggered a full `$PATH` scan plus two `~/.npmrc` reads up to 8×/second.
- **Stream Status Bar**: Unchanged activity/phrase updates no longer touch the DOM, and the activity history list only rebuilds when a new entry is actually appended (previously a full `empty()` + rebuild per stream chunk).
- **Math Escaping**: Streaming math-delimiter detection no longer builds a throwaway escaped copy of the entire message per frame; detection and escaping now share one state machine and the escaped string is computed at most once per frame.

## [5.6.2] - 2026-06-24

### Added

- **Premium Chat UI Redesign**:
  - Implemented glassmorphic, color-coded chat bubbles (`messages.css`) with micro-animations and OKLCH-based brand gradient backdrops.
  - Redesigned reasoning collapsible containers (`thinking.css`) with neon accent rails and pulsating glow stream badges.
  - Upgraded terminal panels (`toolcalls.css`) for CLI command executions with custom borders and status indicators.
  - Styled inline code tags (`code.css`) as premium badges with translucent background tints and colored borders.

### Changed

- **Renovate Dependency Upgrades**:
  - Upgraded `@anthropic-ai/claude-agent-sdk` to `v0.3.190`.
  - Upgraded `smol-toml` to `v1.7.0`.
  - Upgraded `@typescript-eslint` packages to `v8.62.0`.
  - Upgraded `@playwright/test` to `v1.61.1`.
  - Upgraded release actions to `softprops/action-gh-release@v3` and Node.js engine target to `24.18.0`.

## [5.6.1] - 2026-06-24

### Added

- **Premium Visual Design for Antigravity (agy 2.0)**:
  - Created a dedicated stylesheet `antigravity-ui.css` for custom settings cards and modals.
  - Implemented glassmorphic, color-coded account connection cards with pulse notifications for Google Account authentication.
  - Styled CLI actions and version panels to use modern CSS layouts with flexbox and micro-animations.
  - Redesigned the changelog viewer with monospace code blocks, shadow elevations, and premium scroll interfaces.

## [5.6.0] - 2026-06-24

### Added

- **Antigravity CLI 2.0 Integration**:
  - Exposed provider-level commands `/agy-version`, `/agy-changelog`, `/agy-models`, `/agy-plugins`, and `/agy-update` in the composer autocomplete.
  - Implemented dynamic runtime command execution to process these slash commands locally and stream the output.
  - Added native OS installation commands for Windows PowerShell and macOS/Linux in the installation catalog.
  - Added a CLI Management panel in settings displaying the installed version, authenticated Google account, and actions (Update CLI, View Changelog, and Import Plugins).
  - Created a custom scrollable modal (`AgyChangelogModal`) to render release notes.
  - Added friendly warning prompts for authentication failures in both chat sessions and settings.

## [5.0.0] - 2026-06-19

### Added

- **Universal Steer (S1)**: A unified model/command steering layer that lets users direct prompts to any registered provider with a single syntax.
- **Multi-Agent Team Engine (S2)**: `/team` slash command to spawn coordinated subagent teams, run parallel tasks, and aggregate results back into chat.
- **Dashboard 2.0 (S3)**: `Claudian OS` dashboard view with memory browser, mission log, workflow browser, token usage breakdown, live activity feed, and keyboard navigation.
- **Prompt Templates (S4)**: `/template` slash command to list, search, and insert vault-wide prompt templates from a configurable folder.
- **Vault Health (S4)**: `/vault-health` slash command that scans the vault for broken links, orphans, duplicate notes, and empty files, then renders a markdown report.
- Built-in command catalog now exposes `team`, `template`, and `vault-health` actions with full type coverage.
- Settings UI additions for template folder path and vault-health configuration.

### Changed

- Dashboard modals refactored to use type-only `App` imports, improving testability and build performance.
- Input controller command dispatching split into explicit handler cases for the new S4 commands.

### Fixed

- Removed accidentally tracked `node_modules` symlinks from repository history across S1–S3 branches and `main`.
- Resolved rebase conflicts during S4 integration in `builtInCommands.ts`, `InputController.ts`, and `main.ts`.

### Internal

- Added unit tests for `PromptTemplateService` and `VaultHealthService`.
- Updated `builtInCommands.test.ts` to assert all 9 built-in command definitions.
- 315 test suites / 6,244 tests passing.
