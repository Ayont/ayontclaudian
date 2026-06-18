# ayontclaudian 2.6.0 — Auto-Mode-Komfort, Modell-Vergleich, Diagnose & Visual-Regression

Ein großer Politur- und Feature-Release: zehn gezielte Verbesserungen, alle voll getestet.

## ✨ Highlights

### 🎯 Goal: `/goal done`, `/goal clear` & Inline-Bearbeiten
- `/goal done`, `/goal clear`, `/goal fertig`, `/goal erledigt` (u.a.) löschen das Ziel explizit.
- **Klick aufs Goal-Banner** befüllt das Eingabefeld mit `/goal <aktuelles Ziel>` zum schnellen Bearbeiten.
- Goal-Blöcke werden beim History-Rebuild **dedupliziert** (kein Token-Aufstau in langen Goal-Sessions).

### 🤖 Auto-Mode: konfigurierbar, transparenter, sicherer
- Loop-Schutz-Schwelle ist jetzt einstellbar (`autoModePauseAfter`, Default 25).
- **Plan-Approvals zählen mit** in den Loop-Schutz und zeigen „⚡ Auto-Mode: Plan automatisch bestätigt".
- Neuer Command **„Toggle auto mode (double YOLO)"** + dauerhaftes **AUTO-Badge in der Statusleiste**, damit der globale Modus nie still aktiv bleibt.

### 🔁 Session-Recovery jetzt zweisprachig
Die „Sitzung abgelaufen — neu gestartet"-Notice (Vibe/Grok/Antigravity) ist jetzt locale-aware (de/en), passend zum Rest der Fehler-Klassifizierung.

### ⇄ Modell-Vergleich (Split-Run)
Neuer Command **„Compare models (current input)"**: schickt deinen aktuellen Prompt parallel an das aktive Modell **und** ein zweites, das du wählst, und schreibt die Antworten **nebeneinander in eine Notiz** (`Claudian Comparisons/`) — inkl. Dauer pro Modell.

### 🩺 Diagnose & Health-Check
- **„Check provider health"**: ruft tatsächlich `cli --version` pro Provider auf und zeigt eine Erreichbarkeits-Tabelle (nicht nur „Pfad löst auf").
- **„Copy diagnostics"** enthält jetzt eine **Fehler-Historie** (letzte 20 Provider-Fehler mit Zeit/Provider/Text) — ideal fürs schnelle Debugging ohne Logfile.

### 🔒 Voll provider-isolierter Session-State
Bestätigt & abgesichert: nicht nur die Session-ID, sondern der **komplette `providerState`** (Subagent-Daten, Fork-Metadaten) wird pro Provider isoliert weggestasht/wiederhergestellt — Hin-und-Zurück-Wechsel verlieren keinen Provider-State mehr.

### 📸 Echte Visual-Regression (Playwright)
Neues Screenshot-Harness (`npm run test:visual`) für Goal-Banner, Permission-Toggle (Safe/YOLO/AUTO), Statusleiste und Modell-wechseln-Button an **320 / 768 / 1440** — 12 Baselines, fängt CSS-Regressionen über Breakpoints ab.

## 🔧 Technisch
- Neue reine, voll getestete Helper: `staleSessionRetryNotice`, `stripGoalBlocks`, `recordProviderError`/`getErrorHistory`, `formatHealthReportMarkdown`/`firstOutputLine`, `runModelComparison`/`formatComparisonMarkdown`.
- **6102 Unit-Tests grün** · typecheck & lint sauber · **12 Playwright-Baselines** grün.

## 📦 Installation
Über **BRAT**: `Ayont/ayontclaudian` — oder `main.js`, `manifest.json`, `styles.css` manuell nach `…/.obsidian/plugins/realclaudian/` kopieren und das Plugin neu laden.
