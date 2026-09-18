# ayontclaudian 5.132.0

**Release Date:** 2026-09-18
**Minimum Obsidian Version:** 1.7.2
**Plugin ID:** `realclaudian`

## Überblick

Visuals kommen jetzt aus der Absicht, nicht aus Slash-Commands. Work- und Code-Modus wählen Live-Dokument, Mermaid, Mail und Netzwerkplan selbst — `/mindmap`, `/angebot` und `/berichtsheft` bleiben optionale Kürzel.

## Agent

- Work-Modus: Entscheidungstabelle im Turn-Contract (Dokument, Mail, Netzplan, Mermaid, Chat). Kein „nur wenn du Dokument sagst“.
- Berichtsheft, Arbeitsblatt, Lernfeld, Ausbildungsnachweis öffnen das Word-artige Live-Dokument aus normaler Sprache.
- Mindmap, Prozess, Ablauf, Architektur bekommen eine Mermaid-Anleitung, ohne `/mindmap`.
- Code-Modus bleibt Coding-Agent; Architekturfragen dürfen ein Mermaid-Diagramm in den Chat legen.
- Work-Starter (Berichtsheft, Angebot, Mindmap) sind kurze natürliche Sätze statt fertiger Prompt-Templates.

## Design & Performance

- Chat-Chrome (Tabs, Chips, Send-Stop, Thinking-Menü, Subagent, Swarm, Commit-Bar): `transition: all` durch konkrete Properties ersetzt — weniger Layout-Arbeit, klareres Press-Feedback.
- Mermaid wird nur noch geframed, wenn wirklich ein Mermaid-Fence da ist.

## Slash-Commands

Unverändert als Power-User-Pfad: `/berichtsheft`, `/angebot`, `/mindmap`, `/diagram` expandieren weiter die ausführlichen Vorlagen.
