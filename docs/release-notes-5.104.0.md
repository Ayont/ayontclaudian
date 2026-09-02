# ayontclaudian 5.104.0

**Release Date:** 2026-09-02
**Minimum Obsidian Version:** 1.7.2
**Plugin ID:** `realclaudian`

## Überblick

Claude-Modellkatalog auf fünf feste Modelle reduziert: **Fable 5.1**, **Fable 5**, **Opus 5**, **Opus 4.8**, **Sonnet 5**. Keine schwebenden Aliase mehr, kein Haiku. Ein einziger 1M-Schalter steuert Fable 5.1 und Opus 5.

Alle IDs, Kontextfenster und Fähigkeiten stammen aus der Modelltabelle der installierten Claude-Code-Binary (2.1.258), nicht aus Annahmen.

## Modelle

| Modell | ID | Kontext | Effort | Fast |
|---|---|---|---|---|
| Fable 5.1 | `claude-fable-5-1` (+ `[1m]`) | 1M nativ | bis `max`, `xhigh`, Ultracode | nein |
| Fable 5 | `claude-fable-5` | 1M nativ | bis `max`, `xhigh`, Ultracode | nein |
| Opus 5 | `claude-opus-5` (+ `[1m]`) | 1M nativ | bis `max`, `xhigh`, Ultracode | ja |
| Opus 4.8 | `claude-opus-4-8` | 1M nativ | bis `max`, `xhigh`, Ultracode | ja |
| Sonnet 5 | `claude-sonnet-5` | 1M nativ | bis `max`, `xhigh` | nein |

- **1M-Schalter:** „1M-Kontext für Fable 5.1 und Opus 5" wechselt beide auf die `[1m]`-Schreibweise. Der Sonnet-1M-Schalter ist entfallen (Sonnet 5 ist nativ 1M).
- **Kontextfenster korrigiert:** Opus 5 ist nativ 1M (5.102 nahm 200K an). Das Nutzungs-Badge stimmt jetzt ab dem ersten Render.
- **Fast-Modus:** laut CLI-Fähigkeitstabelle nur Opus 5 und Opus 4.8. Fable und Sonnet nicht.
- **Standardmodell:** Sonnet 5 (vorher Haiku). Fable 5.1 steht im Picker oben, wird aber nie automatisch gewählt.

## Migration bestehender Einstellungen

Gespeicherte Aliase werden beim Laden auf die feste ID abgebildet, damit niemand still auf Fable 5.1 landet oder den Titel-Generator verliert:

- `opus`, `opus[1m]` → Opus 5
- `fable`, `fable[1m]` → Fable 5.1
- `sonnet`, `sonnet[1m]` → Sonnet 5
- `haiku` → Sonnet 5

Gilt für aktives Modell, `lastModel`, Titel-Generierungsmodell, gespeicherte Provider-Zustände und Tab-Entwürfe. Der Kontextfenster-Abgleich mit dem SDK erkennt die alten Aliase in laufenden Sessions weiterhin.

## Tests

- 7762 Tests grün, 0 Lint-Fehler, Visual-Baselines unverändert.
