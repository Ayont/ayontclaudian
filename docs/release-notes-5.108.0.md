# ayontclaudian 5.108.0

**Release Date:** 2026-09-03  
**Minimum Obsidian Version:** 1.7.2  
**Plugin ID:** `realclaudian`

---

## Overview

Release 5.108.0 delivers major full-stack improvements across UI visualization, multi-modal capabilities, git control, dashboard usability, settings ergonomics, and global internationalization.

---

## 1. Interactive Git Branch Management in Commit Bar

- **Clickable Branch Badge**: The Git branch indicator above the chat input is now a styled, interactive pill with hover lighting and chevron icon.
- **Switch Branches**: Clicking the branch badge queries `git.listBranches()` and opens a popup menu showing all local branches with active branch checkmark.
- **Create New Branch**: Built-in modal (`+ New branch...`) allows creating and checking out a new Git branch directly inside Obsidian without opening a terminal.
- **Change Count Formatting**: Accurately reports singular and plural file changes in the active locale.

---

## 2. Dashboard Stability, Fluid Scrolling & Leaf Reuse

- **Single-Instance Enforcement**: `openDashboard()` now detects and reuses existing dashboard leaves, eliminating duplicate stacked tabs.
- **Smooth Bounded Scrolling**: The dashboard container is now explicitly bounded with `overflow-y: auto`, smooth touch/mouse scrolling, and custom glassmorphism scrollbars.
- **Fault-Tolerant Metrics**: All stat cards and metrics are wrapped in safe promise fallbacks, preventing background service hiccups from interrupting the UI.

---

## 3. Multi-Image Attachments & Universal Media Activity Viewer

- **Multi-Image Antigravity Fix**: Solved collision and indexing bugs where attaching multiple images only processed one image. Each attachment is now uniquely hashed and tracked by file path and content.
- **Media Activity Cards**: Media tools across all providers (`analyze_image`, `show_image`, `view_video`, `read_audio`, PDFs) render as rich liquid-glass cards.
- **Inspection & Lightbox**: Includes format badge, filename, copy file path button, model analysis drawer, and click-to-zoom full-screen modal with keyboard navigation.

---

## 4. Full Internationalization (English Default & German Localization)

- Hardcoded German strings across the codebase have been replaced with locale-aware lookups.
- English is the clean global default; German is dynamically enabled when Obsidian's language is set to German.
- Covers Dashboard capabilities, relative timestamps, live events, Commit Bar, Model Selector, and Media Activity Cards.

---

## 5. Model Picker "High to Low" Variant Selection

- Variant option rows in `ModelSelectModal` now allow clicking anywhere on the row to select the primary/selected model variant, while preserving fine-grained effort buttons (`Low`, `Medium`, `High`).

---

## 6. Modern Settings Tab Navigation

- Redesigned the settings tab navigation into a segmented pill bar with clean active indicators.
- Added live provider status dots (green when enabled, muted when inactive) so configured providers are visible at a glance.

---

## Verification & Quality Assurance

- **Unit & Integration Tests**: 477 test suites passed (7,884 tests passed, 0 failures).
- **TypeScript**: 0 compiler errors (`tsc --noEmit`).
- **ESLint**: 0 warnings or errors across the entire codebase.
- **Visual Regression**: 63 Playwright visual test specs passed.
- **Production Build**: Verified bundle generation (`main.js`, `manifest.json`, `styles.css`).
