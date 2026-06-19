# ayontclaudian 3.0.5 — Multi-Agent Missions, die wirklich funktionieren & ein Live-Dashboard

Dieser Release macht das Multi-Agent-System und das Claudian-OS-Dashboard **wirklich funktionsfähig** und voll visualisiert — mit echtem Orchestrierungs-Backend.

## ✨ Highlights

### 🤖 Multi-Agent Mission Console (neu gedacht)
- **Du beschreibst die Mission** in einem Eingabefeld (kein hardcodierter Prompt mehr) und startest das Team mit ⌘/Ctrl+Enter oder „Mission starten".
- **Echte Orchestrierung mit Synthese:** Die Spezialisten (Coder, Writer, Researcher) laufen parallel — danach fasst ein **Lead-Coordinator** alle Beiträge zu *einer* kohärenten, deduplizierten Antwort zusammen.
- **Live-Visualisierung pro Agent:** Streaming-Output, **Token-Zähler** und **tickende Laufzeit**, animierter Status (Bereit → Arbeitet → Fertig/Fehler).
- **Synthese-Panel** zeigt das kombinierte Endergebnis live, und alles wird als Markdown-Notiz unter `.claudian/` gespeichert.

### 📊 Live-Dashboard (Claudian OS)
- Neuer **Live-Aktivitäts-Feed**: Missionen, Memory-Updates, Workflows und Projektwechsel erscheinen in Echtzeit (via EventBus), mit relativen Zeitstempeln.
- **Live-Missions-Indikator** im Header pulsiert, solange Agenten arbeiten.
- **Auto-Refresh** der Statistik-Karten (5 s) + manueller **Refresh**-Button; saubere Subscription-/Timer-Aufräumung beim Schließen.

### 🔌 Echtes Backend
- `MultiAgentService.runMission()`: parallele Spezialisten + Synthese, mit Fortschritt (Spezialisten 80 % / Synthese 20 %), Token-Schätzung und Laufzeit pro Agent.
- Neue **Mission-Events** (`mission:started` / `mission:progress` / `mission:completed`) auf dem globalen EventBus — so reagiert das Dashboard live.
- **Bugfix:** Agenten nutzen jetzt den echten Modell-*Wert* (nicht das Anzeige-Label) → korrektes Routing. Runtime-Logik in `runRawPrompt` zusammengeführt (DRY).

### 📸 Visual-Regression erweitert
Das Playwright-Harness deckt jetzt auch **Mission-Card, Synthese-Panel und Aktivitäts-Feed** ab — **21 Baselines** (7 Komponenten × 320/768/1440).

## 🔧 Technisch
- Neue reine, getestete Helper/Methoden: `runMission`, `estimateTokens` (Mission-Backend voll unit-getestet inkl. Synthese-, Metrik- und Fehlerpfaden).
- **6164 Unit-Tests grün** · typecheck & lint sauber · **21 Playwright-Baselines** grün.

## 📦 Installation
Über **BRAT**: `Ayont/ayontclaudian` — oder `main.js`, `manifest.json`, `styles.css` manuell nach `…/.obsidian/plugins/realclaudian/` kopieren und das Plugin neu laden.
