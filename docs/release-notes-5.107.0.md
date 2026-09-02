# ayontclaudian 5.107.0

**Release Date:** 2026-09-02
**Minimum Obsidian Version:** 1.7.2
**Plugin ID:** `realclaudian`

## Überblick

Stabilitätsrelease über alle Provider: Reasoning darf eine Antwort nie mehr zerreißen, `<think>`-Tags aus OpenAI-kompatiblen Gateways landen im Thinking-Block statt im Text, und der Cline-Binary-Repair greift jetzt auch für die npm-Standardinstallation.

## Antigravity (Gemini): Thinking mitten im Code

**Ursache (live gemessen, agy 1.1.24):** agy liefert zwei Kanäle. `stream-json` streamt die Antwort sofort als `text_delta` — und splittet dabei sogar Fences (` ```powershel` + `l\n…`). Das `thinking` des Modells steht aber nur in der `PLANNER_RESPONSE`-Zeile der `transcript.jsonl`, die ein paar Polls später eintrifft. Der Thinking-Chunk kam so mitten in den laufenden Text und schloss den Textblock — der Fence war in zwei kaputte Blöcke geteilt, der zweite Fence schloss nie und schluckte den Rest der Nachricht.

**Zwei Fixes:**
1. `thinkingSequencer` in der Antigravity-Runtime: Thinking eines Steps, dessen Text gerade streamt, wird gehalten und erst bei `state: DONE` (oder Turn-Ende) ausgegeben. Thinking vor Textbeginn wird sofort ausgegeben.
2. Provider-neutral im `StreamController`: Ein Thinking-Chunk schließt den Textblock nicht mehr, wenn dieser in einem offenen Code-Fence steht (`hasOpenCodeFence`). Gilt für alle 12 Provider.

Live gegen agy verifiziert: Sequenz `["text","thinking"]`, Fence vollständig.

## `<think>`-Tags im Text (Kimi, dsh, Freebuff, vibe, pi)

OpenAI-kompatible Gateways leiten Reasoning gelegentlich als `<think>…</think>` (auch `<thinking>`, `<reasoning>`) im `content` weiter. Als Markdown gerendert erschien der Tag roh oder schluckte als HTML den Rest. Neuer delta-sicherer Scrubber (`inlineThinkScrubber`): gesplittete Tags werden gehalten bis sie sich auflösen, Thinking wird inkrementell in den Thinking-Block gestreamt, Tags in Code-Fences und Inline-Code bleiben literal. Zentral im `StreamController`, damit alle Provider profitieren.

## Cline: SIGKILL beim Start (macOS)

`cline --version` wurde mit Signal 9 beendet: `codesign --verify` meldet „invalid signature (code or signature have been modified)“ für die npm-Kopie. Der bestehende Repair (ad-hoc re-sign + Quarantine löschen) suchte nur `bin/.cline`; bei fehlendem Postinstall-Cache fällt der Wrapper aber auf `node_modules/@cline/cli-darwin-arm64/bin/cline` zurück, das nie repariert wurde. `findClineCompiledBinary` kennt jetzt beide Pfade. Live: nach Repair `cline --version` → `3.0.56`, exit 0.

## Tests

- 7843 Tests grün (+20), 0 Lint-Fehler, Visual 63/63 unverändert.
