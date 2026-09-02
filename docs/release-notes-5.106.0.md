# ayontclaudian 5.106.0

**Release Date:** 2026-09-02
**Minimum Obsidian Version:** 1.7.2
**Plugin ID:** `realclaudian`

## Überblick

Wenn ein Provider einen Browser oder den Desktop steuert, sieht man das jetzt: als Live-Chip über dem Composer und als Browser-Karte im Chat, im Liquid-Glass-Design.

## Browser- & Desktop-Visualisierung

- **Ein Vokabular für alle Treiber.** `core/tools/browserActivity.ts` erkennt Hermes (`browser_navigate`, `browser_click`, `browser_type`, `browser_exec`, `computer_use` …), Claude in Chrome (`mcp__claude-in-chrome__*`, inkl. `computer` per `action`), sowie Playwright-, Chrome-DevTools- und Browser-Use-MCP-Server für Codex/OpenCode. Gewöhnliche MCP-Tools und `WebFetch`/`Bash` mit URL werden bewusst nicht erfasst.
- **Browser-Karte statt Schraubenschlüssel.** Tool-Karten werden zu einem Mini-Browserfenster: Ampel + Adress-Pille + Treiber-Badge, Aktionszeile („Klicke #buy-now“, „Tippe „Netherite““), Viewport mit Radar-Puls und Scan während der Ausführung, Screenshot aus dem Ergebnis (Data-URL oder Dateipfad), Ergebnisstreifen für Text. Fehler werden rot markiert.
- **Live-Chip im Statusbalken.** Sobald ein Browser-Tool läuft, erscheint über dem Composer eine Adresszeile mit Treiber, aktueller Seite (bleibt bei Klicks/Tippen auf dieser Seite stehen) und einem Trail der letzten sechs Aktionen als Icons. Phrase wechselt auf „steuert Browser“/„steuert Desktop“.
- **Desktop-Automation** (Hermes cua-driver) ist kühl-blau eingefärbt, damit sie nie wie eine Webseite aussieht.
- **Hermes-Fix:** `browser_navigate` wurde bisher als `WebFetch` und Klicks/Tippen per `execute`-Fallback als Terminal-Karte gerendert. Browser-Tools behalten jetzt ihren Namen.
- Responsive: bei schmalen Panes weichen Treiber-Label und Trail, die URL behält den Platz. `prefers-reduced-motion` schaltet Puls/Scan ab; `prefers-reduced-transparency` greift über die zentralen Glas-Tokens.

## Tests

- 7823 Tests grün (+55: Klassifizierer, Karte, Status-Chip, Hermes-Normalisierung), 0 Lint-Fehler, Visual-Suite 63/63 mit neuer `browser-activity`-Baseline (320/768/1440).
