# ayontclaudian 2.5.0 — Robustere Sessions, Auto-Mode-Sicherheit & provider-übergreifende Goals

Aufbauend auf 2.4.0: der letzte verbleibende Session-Error-Pfad ist geschlossen, Auto-Mode wird nachvollziehbar und sicher, und das Goal-System läuft jetzt provider-übergreifend mit sichtbarem Banner.

## ✨ Highlights

### 🔁 Eigene abgelaufene Session → automatische Wiederherstellung
Print-Mode-Provider (**Vibe**, **Grok**, **Antigravity**) warfen bei abgelaufener *eigener* Session bisher eine rohe `exited with code N`-Fehlerkarte. Jetzt erkennen sie das, **löschen die tote Session und starten den Turn automatisch frisch neu** — mit kurzer Notiz statt Fehler. Damit ist der letzte echte Session-Error-Pfad geschlossen.

### 🤖 Auto-Mode: nachvollziehbar & mit Loop-Schutz
- **Transparenz:** Jede automatische Antwort erscheint als Inline-Notiz „⚡ Auto-Mode: *Frage → Auswahl*".
- **Loop-Schutz:** Nach 25 automatischen Antworten in Folge pausiert Auto-Mode einmal und holt eine menschliche Bestätigung ein — Schutz gegen Endlosschleifen bei unbeaufsichtigten Goals.

### 🎯 Provider-übergreifendes Goal-System
- `/goal <text>` setzt jetzt ein **persistentes Ziel pro Conversation** (leeres `/goal` löscht es) — für **jeden** Provider, nicht mehr nur Kimi.
- Das Ziel wird in jeden Turn eingespeist (gerahmt als `<standing_goal>`) und überlebt sogar Provider-Wechsel.
- Das **Goal-Banner** wird jetzt tatsächlich angezeigt (war bisher nie verdrahtet) und tönt sich in der Provider-Akzentfarbe.

### ⇄ „Mit anderem Modell weiter" direkt an der Nachricht
Fertige Assistant-Antworten bekommen beim Hovern einen **„Modell wechseln"-Button**, der den Modell-Picker öffnet und den Provider in-place wechselt — der Kontext der letzten Turns wird via Bootstrap mitgenommen.

### 📐 Adaptiver Kontext-Transfer
Der Bootstrap-Cap skaliert jetzt mit dem **Ziel-Kontextfenster**: Wechsel zu einem Modell mit großem Fenster (200k+) trägt proportional mehr vorherigen Kontext mit (gedeckelt bei ~24k Zeichen), kleine Modelle behalten den schlanken 6k-Floor.

### 🩺 „Copy diagnostics"-Befehl
Neuer Befehl, der einen Markdown-Snapshot kopiert: Version, Permission-/Auto-Mode, Provider-Verfügbarkeit (enabled + CLI) und die **Session-Map pro Provider** der aktiven Conversation — verkürzt Log-basiertes Debugging.

## 🔧 Technisch
- Neue, voll unit-getestete reine Helper: `isStaleResumeFailure`, `resolveAutoQuestionAnswers`/`summarizeAutoAnswers`, `computeBootstrapCharCap`, `parseGoalArgs`/`applyGoalPrefix`, `buildDiagnosticsMarkdown`.
- Goal & Session-Map werden pro Conversation persistiert.
- DRY: doppelter Bootstrap-Aufbau im `InputController` entfernt (Snapshot wird vom Switch wiederverwendet).
- **6086 Unit-Tests grün** · typecheck & lint sauber · neue Component-DOM-Tests für das Goal-Banner.

## 📦 Installation
Über **BRAT**: `Ayont/ayontclaudian` — oder die drei Assets `main.js`, `manifest.json`, `styles.css` manuell nach `…/.obsidian/plugins/realclaudian/` kopieren und das Plugin neu laden.
