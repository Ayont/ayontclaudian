# 4.1.0 — Auto-Mode Model Router, Image Staging, Web-Search Visualization & File-Type Chips

## Auto-Mode (Model Router)
- **Automatically selects the best model** for your prompt on every send
- Keyword-based routing: code prompts → coding model, writing → writing model, vision → vision model, planning → reasoning model
- Enabled by default, toggleable in settings (`modelRouterAutoMode`)
- Works silently — no popups unless you manually trigger the router command

## Image Attachment Staging
- **Images survive Obsidian restarts** — pasted/dropped images are persisted to `.claudian/staging/images/`
- 7-day TTL with automatic cleanup on startup
- **Images stay attached when you cancel a message** — no more losing your screenshots
- Manifest-based: `manifest.json` tracks all staged images
- Works with paste, drag-and-drop, and file picker

## Web Search Visualization
- **Spinning globe badge** appears when the agent searches the web
- "Searching the web…" while running, "Web search complete" when done
- Card-style result links with hover states
- Summary section with scrollable content

## File-Type Chips
- Color-coded file attachment chips by format:
  - **PDF** — red
  - **Word (doc/docx)** — blue
  - **Excel (xls/xlsx/csv)** — green
  - **Code (ts/js/py/rs/go...)** — purple
  - **Image** — orange
  - **Archive (zip/tar/gz)** — yellow
  - **Markdown** — indigo
- Matching Lucide icon per type (file-text, table, file-code, image, file-archive)
- Subtle colored left-border tint per type

## Technical
- `resolveModelRouteForInput()` extracted as silent public method
- `ImageStagingService` — new vault-backed persistence layer
- `FileChipsView.getFileTypeMeta()` — extension-to-icon/color mapping
- Auto-router hook in `InputController.sendMessage()` before token-budget check

## Quality
- 6219 tests green
- Typecheck: 0 errors
- Lint: 0 errors
