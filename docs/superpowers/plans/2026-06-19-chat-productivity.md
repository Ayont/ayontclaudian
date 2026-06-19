# Chat Productivity Features — 4.0.0 wt-3 Implementation Plan

> **For agentic workers:** implement task-by-task, run the verification commands after each major change, and commit frequently with conventional messages.

**Goal:** Add message search, bookmark/pin messages, and a vault-scoped prompt library to ayontclaudian 4.0.0.

**Scope boundary:** Only touch files needed for chat productivity. Do not modify provider runtimes, provider configs, or other workstream code.

---

## Task 1: Design doc & scaffolding

**Files:**
- `docs/superpowers/specs/2026-06-19-chat-productivity-design.md` (done)
- `docs/superpowers/plans/2026-06-19-chat-productivity.md` (this file)

**Steps:**
- [x] Write design spec.
- [x] Write implementation plan.
- [ ] Commit planning docs.

**Verification:** `git status` shows only the two new docs.

---

## Task 2: Bookmark support in `ChatState`

**Files:**
- Create: `tests/unit/features/chat/state/ChatState.bookmarks.test.ts`
- Modify: `src/features/chat/state/types.ts`, `src/features/chat/state/ChatState.ts`

**Steps:**
- [ ] Write failing tests for `toggleBookmark`, `isBookmarked`, `bookmarkedMessageIds` getter, callback, and reset.
- [ ] Run tests: `npm run test -- --selectProjects unit tests/unit/features/chat/state/ChatState.bookmarks.test.ts` → FAIL.
- [ ] Add `bookmarkedMessageIds: string[]` to `ChatStateData` and callbacks.
- [ ] Implement methods in `ChatState`.
- [ ] Update `createInitialState()` default.
- [ ] Run tests → PASS.
- [ ] Commit.

---

## Task 3: Persist bookmarks on `Conversation` / `SessionMetadata`

**Files:**
- Modify: `src/core/types/chat.ts`, `src/core/bootstrap/SessionStorage.ts`
- Modify: `src/features/chat/controllers/ConversationController.ts`
- Modify: `src/main.ts` (load path), `tests/unit/features/chat/state/ChatState.test.ts` (default state assertion)

**Steps:**
- [ ] Add optional `bookmarks?: string[]` to `Conversation` and `SessionMetadata`.
- [ ] Update `SessionStorage.toSessionMetadata()` to include `bookmarks`.
- [ ] In `ConversationController.save()`, add `bookmarks: state.bookmarkedMessageIds` to updates.
- [ ] In `ConversationController.restoreConversation()`, restore bookmarks into `ChatState`.
- [ ] In `main.ts` `loadSettings()`, map `meta.bookmarks` into the in-memory `Conversation`.
- [ ] Update existing `ChatState.test.ts` default-state assertion for the new field.
- [ ] Run unit tests for chat state and conversation controller area.
- [ ] Commit.

---

## Task 4: Bookmark UI in `MessageRenderer`

**Files:**
- Modify: `src/features/chat/rendering/MessageRenderer.ts`
- Modify: `src/style/components/messages.css`
- Test: update `tests/unit/features/chat/rendering/MessageRenderer.test.ts` if it exists; otherwise skip if purely DOM

**Steps:**
- [ ] Add `onBookmarkToggle?: (messageId: string) => void` to `MessageRenderer` constructor.
- [ ] Render a bookmark action button on every message (user + assistant).
- [ ] Add `claudian-message-bookmarked` class when bookmarked.
- [ ] Wire the bookmark callback to update `ChatState` and persist via `ConversationController.save()`.
- [ ] Add CSS for the bookmark button and pinned indicator.
- [ ] Run `npm run typecheck && npm run lint`.
- [ ] Commit.

---

## Task 5: Message search service

**Files:**
- Create: `src/features/chat/services/MessageSearch.ts`
- Create: `tests/unit/features/chat/services/MessageSearch.test.ts`

**Steps:**
- [ ] Write failing tests for exact/case-insensitive/multi-word/empty/tool-call search.
- [ ] Implement `searchMessages(messages, query, options)`.
- [ ] Run tests → PASS.
- [ ] Commit.

---

## Task 6: Message search UI

**Files:**
- Create: `src/features/chat/ui/MessageSearchBar.ts`
- Modify: `src/features/chat/ClaudianView.ts` (header action + wiring)
- Modify: `src/features/chat/rendering/MessageRenderer.ts` (highlight current match)
- Modify: `src/style/components/messages.css` and `src/style/components/header.css`

**Steps:**
- [ ] Implement `MessageSearchBar` component with input, prev/next, close, match count.
- [ ] Add header search button to `ClaudianView` `buildNavRowContent()`.
- [ ] Wire search to active tab's `state.messages` and `renderer`.
- [ ] Add methods on `MessageRenderer` to add/remove `claudian-search-match` and `claudian-search-current` classes and scroll matches into view.
- [ ] Add CSS for search bar and highlight states.
- [ ] Run `npm run typecheck && npm run lint`.
- [ ] Commit.

---

## Task 7: Prompt library service

**Files:**
- Create: `src/features/chat/services/PromptLibrary.ts`
- Create: `tests/unit/features/chat/services/PromptLibrary.test.ts`

**Steps:**
- [ ] Write failing tests for prompt parsing, scanning, `{{input}}` expansion, and missing-folder handling.
- [ ] Implement `PromptLibraryEntry` type, `parsePromptFile`, `expandPrompt`, and `loadPromptLibrary(vault)`.
- [ ] Run tests → PASS.
- [ ] Commit.

---

## Task 8: Prompt library UI

**Files:**
- Create: `src/features/chat/ui/PromptLibrarySelector.ts`
- Modify: `src/features/chat/ui/InputToolbar.ts` (createInputToolbar returns it)
- Modify: `src/features/chat/tabs/types.ts` (`TabUIComponents`)
- Modify: `src/features/chat/tabs/Tab.ts` (initialize + wire)
- Modify: `src/style/components/input.css`
- Modify: `src/main.ts` (command palette command)

**Steps:**
- [ ] Implement `PromptLibrarySelector` icon + dropdown.
- [ ] Add it to `createInputToolbar` return and `TabUIComponents`.
- [ ] Initialize in `Tab.ts` and wire `onSelect` to insert into `dom.inputEl.value`.
- [ ] Add CSS for prompt library dropdown and toolbar placement.
- [ ] Add `open-prompt-library` command in `main.ts`.
- [ ] Run `npm run typecheck && npm run lint`.
- [ ] Commit.

---

## Task 9: Full verification

**Steps:**
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run test`.
- [ ] Run `npm run build`.
- [ ] Fix any failures and commit.

---

## Task 10: Workstream report

**Files:**
- Create: `WORKSTREAM_REPORT.md`

**Steps:**
- [ ] Summarize changes, files touched, test results, blockers/follow-ups.
- [ ] Commit report.
- [ ] Show final `git log --oneline`.
