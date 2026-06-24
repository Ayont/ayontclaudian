# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
