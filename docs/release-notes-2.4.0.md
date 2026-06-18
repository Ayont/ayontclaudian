# ayontclaudian 2.4.0 — Provider-Switch ohne Session-Error & Auto-Mode

Diese Version macht das Arbeiten über **alle** Modelle hinweg verlässlich: ein Modellwechsel mitten im Chat überträgt jetzt sauber den Kontext, ohne dir einen Session-Error zu droppen. Dazu kommt der neue **Auto-Mode** („Doppel-YOLO") und ein deutlich aufgewerteter Goal-/Resume-Look.

## ✨ Highlights

### 🔁 Kein „Session not found" mehr beim Modellwechsel
Beim Wechsel zwischen Providern (Claude, Codex, **Vibe/Mistral**, **Grok**, **Kimi**, **Antigravity** …) wird die native Session jetzt **pro Provider isoliert**:

- Jeder Provider behält **seine eigene** CLI-Session unter eigenem Schlüssel.
- Die geteilte `conversation.sessionId` wird beim Switch nie mehr mit einer fremden ID weitergereicht — kein Provider versucht mehr, die Session eines anderen zu „resumen" (genau das löste den `session not found` / `no rollout`-Fehler aus).
- Der eingewechselte Provider startet entweder **frisch** (mit gebündeltem Kontext-Bootstrap der letzten Turns) oder **resumed exakt seine eigene** vorherige Session, wenn du zu ihm zurückwechselst.

Ergebnis: Du kannst frei zwischen allen Modellen hin- und herspringen, der Kontext kommt direkt mit, und es gibt keinen Session-Error.

### 🤖 Auto-Mode — „Doppel-YOLO"
Neue dritte Stufe des Permission-Toggles: **Safe → YOLO → AUTO**.

- **AUTO** = YOLO-Rechte **plus** keine Rückfragen mehr: `AskUserQuestion` wählt automatisch die empfohlene (erste) Option, `ExitPlanMode` wird automatisch bestätigt.
- Lange, unbeaufsichtigte Goals laufen damit durch, ohne dass dich eine Rückfrage blockiert.
- Erkennbar am eigenen, akzent-leuchtenden **AUTO**-Label im Toolbar-Toggle.

### 🎯 Goal- & Resume-Banner runderneuert
- Das **Goal-Banner** (gesetzt via `/goal`) hat jetzt ein vollwertiges Design: akzentgetönte Fläche mit Tiefe, linker Akzent-Schiene, pulsierendem Ziel-Icon (signalisiert „läuft"), klarer Hierarchie aus Label · Provider-Chip · Zieltext und designtem Clear-Button. Tönt sich automatisch in der Akzentfarbe des aktiven Providers.
- Das **Resume-Dropdown** nutzt jetzt das Design-Token-System: weichere Tiefe, Akzent auf dem aktuellen/aktiven Eintrag, sanfte Einblend-Animation.
- Beide respektieren `prefers-reduced-motion`.

## 🔧 Technisch
- Neuer reiner Helper `computeProviderSessionHandoff` (voll unit-getestet) + persistiertes `providerSessions`-Feld pro Conversation.
- Neuer reiner Helper `resolveAutoQuestionAnswers` (voll unit-getestet) für die Auto-Antworten.
- Globales `autoMode`-Setting (Default: aus).
- 6044 Unit-Tests grün · typecheck & lint sauber.

## 📦 Installation
Über **BRAT**: `Ayont/ayontclaudian` — oder die drei Assets `main.js`, `manifest.json`, `styles.css` manuell nach `…/.obsidian/plugins/realclaudian/` kopieren und das Plugin neu laden.
