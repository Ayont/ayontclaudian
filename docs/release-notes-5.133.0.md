# ayontclaudian 5.133.0

**Release Date:** 2026-09-22
**Minimum Obsidian Version:** 1.7.2
**Plugin ID:** `realclaudian`

## Überblick

Grok 4.7 und Grok 4.7 Fast sind im Modellmenü, mit dem 500.000-Token-Fenster der CLI und echter Nutzungsanzeige.

## Grok

- Standardmodell ist `grok-4.7`. Daneben Grok 4.7 Fast (`grok-4.7-build-fast`), dazu weiter Grok 4.6 und Grok 4.5.
- Kontextfenster für alle vier: 500.000 Tokens. Ab 200.000 Prompt-Tokens gilt der Langkontext-Tarif; das Fenster bleibt 500.000.
- Denkaufwand: Niedrig, Mittel, Hoch (Standard), Extra hoch. Grok 4.5 hat kein Extra hoch.
- Die Kontextanzeige nimmt die Token-Abrechnung der CLI. Fehlt sie, bleibt die Schätzung mit Ungefähr-Zeichen.
- Ein Rate-Limit der CLI erscheint als Limit-Karte. Ein volles Kontextfenster wird als Hinweis gezeigt.
- Grok-Bots aus `grok inspect` lassen sich in den Grok-Einstellungen wählen.
