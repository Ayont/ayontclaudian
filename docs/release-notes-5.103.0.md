# ayontclaudian 5.103.0

**Release Date:** 2026-09-02
**Minimum Obsidian Version:** 1.7.2
**Plugin ID:** `realclaudian`

## Überblick

Stabilitäts- und Design-Release: der Output-Klassifizierer macht keine ungefragten E-Mails oder Dokumente mehr, die Theme-Tokens sind für alle Flächen korrekt aufgelöst, alle 12 Provider haben vollständige Akzent-Abdeckung, und das Chrome bekommt ein zentrales Liquid-Glass-Material.

## Behoben

### Ungefragte E-Mail-/Dokument-Ausgabe
- Im **Code-Modus** wird nie mehr eine Ausgabefläche aus dem Prompt-Text abgeleitet. `/document`, `/email`, `/image`, `/skill` bleiben als explizite Befehle verfügbar.
- Im **Work-Modus** braucht eine Fläche jetzt Erstellungsabsicht **und** das Deliverable als eigenständiges Wort. Zusammensetzungen wie „E-Mail-Validierung", „Image-Upload", „Logo-Component" oder Substrings wie „brief" in „brief summary" lösen nichts mehr aus.
- „mach"/„make" zählt nur noch als Erstellung mit Objekt („Mach mir ein Angebot"), nicht bei „mach weiter"/„make it work".
- „Dokumentation", „Zusammenfassung", „Notiz", „Antwort" sind in einem Engineering-Chat Antwortformen, keine Word-Dokumente.

### Rendering
- Design-Tokens (`--cl-*`) waren auf `:root` deklariert und haben ihre Theme-Referenzen für alle Flächen außerhalb des Chat-Containers verloren (Modellpicker, Dashboard, Multi-Agent-Modal, Dropdown-Portale). Jetzt auf `body`, wie Obsidian es erwartet.
- Bash-/Tool-Blöcke, Code-Wells, Update-Logs und Master-Prompter-Panels blieben im hellen Theme dunkle Klötze. Alle Füllungen flippen jetzt mit dem Theme.
- Effort-Menü lief in schmalen Sidebars über den Rand.
- Vorschau- und Visual-Test-Harness bilden Obsidian jetzt korrekt ab (Theme-Vars auf `body`, `border-box`).

### Provider
- Hermes, DeepSeek Harness und Freebuff fehlten im Dashboard-Akzent, in der Provider-Leiste und im Modellpicker und fielen auf den generischen Akzent zurück.
- Updater: natives `hermes update`, npm-Pfade für `dsh` und `freebuff`.

## Design

- Liquid-Glass-Material als zentrales Token-Set: Composer, User-Bubbles, alle Popovers (History, Mentions, Slash, Effort, Modell-Dropdown), Modellpicker, Dashboard-Panes, Usage-Center.
- Fallbacks für `prefers-reduced-transparency` und fehlendes `backdrop-filter`: Kontrast hängt nie am Blur.
- `DESIGN.md` beschreibt Material und Token-Scope; `docs/adding-a-provider.md` listet jetzt alle sechs Farb-Stellen plus den Updater-Eintrag.

## Tests

- 7765 Unit-/Integrationstests grün (+17), 0 Lint-Fehler, Visual-Baselines erneuert.
