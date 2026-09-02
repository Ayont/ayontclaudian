# ayontclaudian 5.105.0

**Release Date:** 2026-09-02
**Minimum Obsidian Version:** 1.7.2
**Plugin ID:** `realclaudian`

## Überblick

Antigravity-Modellliste auf `agy models` (agy 1.1.24) gebracht: **Gemini 3.8 Flash** in allen drei Reasoning-Stufen neu, Gemini 3.5 Flash entfernt und für bestehende Einstellungen migriert.

## Antigravity

- **Neu:** Gemini 3.8 Flash (Low / Medium / High), per Name oder Slug (`gemini-3.8-flash-*`) wählbar. Live verifiziert: beide Schreibweisen antworten mit `SUCCESS`.
- **Entfernt:** Gemini 3.5 Flash. agy 1.1.24 lehnt das Modell mit `status: ERROR` („not recognized as a known model") ab.
- **Stabilisiert:** Ein aus einer älteren Version gespeichertes 3.5-Flash-Modell wird beim Laden auf Gemini 3.8 Flash **derselben Stufe** migriert (Name bleibt Name, Slug bleibt Slug). Vorher wäre der Turn mit einem CLI-Fehler gescheitert oder still auf „Default" zurückgefallen.
- Die Antigravity-Settings-Reconciliation normalisiert das Modell jetzt tatsächlich beim Start, statt inert zu sein.
- Modellliste entspricht exakt der Ausgabe von `agy models`: Gemini 3.8/3.7/3.6 Flash, Gemini 3.1 Pro, Claude Sonnet 4.6 (Thinking), Claude Opus 4.6 (Thinking), GPT-OSS 120B (Medium).

## Tests

- 7768 Tests grün (+6), 0 Lint-Fehler, Visual-Baselines unverändert.
