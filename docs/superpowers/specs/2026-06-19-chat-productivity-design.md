# Chat Productivity Features — 4.0.0 wt-3 Design Spec

## 1. Goal

Add three chat productivity capabilities to ayontclaudian 4.0.0 while staying inside the **wt-3** workstream boundary:

1. **Message search** inside the active conversation.
2. **Bookmark / pin messages** per conversation.
3. **Vault-scoped prompt library** (`.claudian/prompts/*.md`).

The implementation must be provider-neutral, reuse existing storage/serialization patterns, and include unit tests.

## 2. Current State

- `ChatMessage` already carries `id`, `role`, `content`, `displayContent`, `contentBlocks`, and `toolCalls`.
- `ChatState` owns per-tab message state and change callbacks.
- `Conversation` / `SessionMetadata` already persist UI-only metadata (`enabledMcpServers`, `externalContextPaths`, `usage`, etc.).
- `.claudian/` is the plugin's vault storage root (`CLAUDIAN_STORAGE_PATH`).
- The toolbar already has icon-button components (`ExternalContextSelector`, `McpServerSelector`) that expose a dropdown pattern we can mimic.
- `MessageRenderer` renders message action toolbars (copy, rewind, fork) and is the natural place to add bookmark and search-match indicators.

## 3. Decomposition

### 3.1 Message search

- Pure search logic lives in `src/features/chat/services/MessageSearch.ts`.
  - Case-insensitive search over message `content` (and `displayContent` for user messages).
  - Optional search over tool-call result text.
  - Returns ranked `MessageSearchMatch` objects (message id + match count).
- UI lives in `src/features/chat/ui/MessageSearchBar.ts`.
  - Header action button toggles a search bar above the transcript.
  - Input changes call `MessageSearch` and highlight matching messages by adding a CSS class to their row.
  - Prev/Next buttons scroll the current match into view.
  - Escape closes the bar and clears highlights.

### 3.2 Bookmarks / pinned messages

- Add `bookmarkedMessageIds: string[]` to `ChatStateData`, `Conversation`, and `SessionMetadata`.
- `ChatState` exposes `toggleBookmark(messageId)`, `isBookmarked(messageId)`, `bookmarkedMessageIds` getter.
- `MessageRenderer` adds a bookmark toggle button on every message and a pinned visual indicator.
- `ConversationController.save()` persists the tab's bookmark list on the conversation.
- `ConversationController.restoreConversation()` restores bookmarks into `ChatState`.
- `SessionStorage.toSessionMetadata()` round-trips `bookmarks` so they survive reload.
- `main.ts` load path preserves `bookmarks` when hydrating `Conversation` objects.

### 3.3 Prompt library

- Prompt library loader in `src/features/chat/services/PromptLibrary.ts`.
  - Scans `.claudian/prompts/*.md`.
  - Parses frontmatter (`name`, `description`, `tags`) and body.
  - Supports `{{input}}` placeholder expansion.
- UI: `PromptLibrarySelector` in `src/features/chat/ui/PromptLibrarySelector.ts`.
  - Icon button in the input toolbar with a dropdown listing prompts.
  - Clicking a prompt inserts its body into the active tab's input textarea.
- `main.ts` adds a command-palette command to open the prompt library modal for keyboard access.

## 4. Data Models

```ts
// src/core/types/chat.ts
interface Conversation {
  // ...existing fields...
  bookmarks?: string[];
}

interface SessionMetadata {
  // ...existing fields...
  bookmarks?: string[];
}

// src/features/chat/state/types.ts
interface ChatStateData {
  // ...existing fields...
  bookmarkedMessageIds: string[];
}

// src/features/chat/services/MessageSearch.ts
interface MessageSearchMatch {
  messageId: string;
  role: 'user' | 'assistant';
  matchCount: number;
}

// src/features/chat/services/PromptLibrary.ts
interface PromptLibraryEntry {
  id: string;
  name: string;
  path: string;
  description?: string;
  tags?: string[];
  body: string;
}
```

## 5. UI/UX Details

- Search bar:
  - Header search icon (`search`) opens/closes the bar.
  - Input placeholder: "Search conversation…"
  - Match count label: "3 / 7"
  - Prev/Next use `chevron-up` / `chevron-down`.
- Bookmarks:
  - Bookmark button uses `bookmark` / `bookmark-minus` depending on state.
  - Bookmarked messages get a subtle left-border accent (`claudian-message-bookmarked`).
- Prompt library:
  - Toolbar icon uses `library` (or `file-text` if unavailable in Lucide subset).
  - Dropdown shows name + description; clicking inserts body; if input is non-empty, appends after a newline.

## 6. Testing

- `tests/unit/features/chat/services/MessageSearch.test.ts`
  - Exact, case-insensitive, multi-word, empty query, tool-call content.
- `tests/unit/features/chat/services/PromptLibrary.test.ts`
  - Parsing, frontmatter handling, placeholder expansion, scanning via a mock vault adapter.
- `tests/unit/features/chat/state/ChatState.bookmarks.test.ts`
  - Toggle, deduplication, callback fire, reset for new conversation.
- Existing `ChatState.test.ts` extended for the new default state field.

## 7. Success Criteria

- `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` all pass.
- Existing unit/integration tests still pass.
- New tests cover search, bookmarks, and prompt loading.
- No `console.log` in production code; use existing logger if needed.
- Changes stay within `wt-3` scope: no modifications to other workstreams.
