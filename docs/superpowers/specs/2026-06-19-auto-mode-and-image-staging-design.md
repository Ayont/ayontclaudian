# Design: Auto-Mode Model Router & Image Attachment Staging

## Zusammenfassung

Dieses Dokument beschreibt zwei neue Features für das Obsidian-Plugin **Claudian**:

1. **Auto-Mode für fragepassende Modellauswahl** — Beim Absenden einer Nachricht wird automatisch das passende Modell anhand der Prompt-Inhalte gewählt.
2. **Image Attachment Staging** — Eingefügte/gedroppte Bilder werden im Vault zwischengespeichert, überleben Obsidian-Neustarts und bleiben beim Abbrechen einer Nachricht erhalten.

## Annahmen

- Der Auto-Mode ist **standardmäßig aktiviert**, kann aber in den Settings deaktiviert werden.
- Auto-Routing greift **bei jedem User-Senden**, solange der Nutzer nicht explizit ein Modell vorausgewählt hat.
- Bilder werden **7 Tage** im Staging-Bereich aufbewahrt.
- Bilder werden **pro Plugin-Instanz global** gestagt und beim Start in den aktiven Input wiederhergestellt.
- Beim Abbrechen einer Nachricht bleiben Bilder im Eingabefeld erhalten.

## Hintergrund

- Der ModelRouter existiert bereits (`src/core/routing/modelRouterRules.ts`) und wird über das Kommando `apply-model-router` manuell ausgelöst.
- `modelRouterEnabled` existiert als Setting, wird aber aktuell nicht automatisch verwendet.
- Bilder werden aktuell nur in einer `Map<string, ImageAttachment>` im `ImageContextManager` gehalten und gehen beim Neustart verloren.

## Feature 1: Auto-Mode Model Router

### Ziel

Der Nutzer muss nicht mehr manuell das passende Modell wählen. Claudian erkennt anhand des Prompts (Code, Planung, Vision, Writing, Cheap) das passende Modell und wechselt vor dem Senden automatisch.

### Architektur

1. **Settings**
   - `modelRouterEnabled` bleibt erhalten, Default wird auf `true` geändert.
   - `modelRouterAutoMode?: boolean` (Default `true`) ermöglicht es, den Auto-Mode unabhängig vom manuellen Command zu deaktivieren.
   - `modelRouterRules` bleibt optional. Falls leer, werden Regeln automatisch aus den verfügbaren Modellnamen generiert (`defaultRouterRulesFromModels`).

2. **Refactoring `applyModelRouterToCurrentInput()`**
   - Eine neue interne Methode `resolveModelRouteForInput(prompt, tab): ModelRouteDecision | null` kapselt die Routing-Logik ohne UI-Seiteneffekte.
   - Der öffentliche Command `applyModelRouterToCurrentInput()` ruft diese Methode auf und zeigt Notices an.

3. **Hook in `InputController.sendMessage()`**
   - Vor dem Streaming-Check wird geprüft:
     ```ts
     if (plugin.settings.modelRouterEnabled !== false && plugin.settings.modelRouterAutoMode !== false) {
       const decision = plugin.resolveModelRouteForInput(content, tab);
       if (decision && decision.model !== currentModel) {
         await tab.ui.modelSelector?.selectModel(decision.model);
       }
     }
     ```
   - Keine Notice im Auto-Mode, um den Fluss nicht zu stören.
   - Wenn kein passendes Modell gefunden wird, bleibt das aktuelle Modell erhalten.

4. **Manueller Modell-Override**
   - Wenn der Nutzer ein Modell aus der Dropdown-Liste wählt, wird das gewählte Modell respektiert.
   - Um zu erkennen, ob ein Modell manuell gewählt wurde, wird das `draftModel` des Tabs verwendet: Ist `draftModel` gesetzt, gilt es als manuelle Vorauswahl und der Auto-Mode überspringt das Routing.

### Fehlerbehandlung

- Routing schlägt still fehl → aktuelles Modell bleibt.
- Gewähltes Modell nicht verfügbar → Fallback auf aktuelles Modell.
- `modelSelector` nicht initialisiert → Routing wird übersprungen.

### Tests

- Unit-Test für `resolveModelRouteForInput()` mit verschiedenen Prompts.
- Unit-Test für `chooseModelRoute()` mit Auto-Mode-Flag.
- Integrations-Test: Auto-Mode aktiviert → Prompt “fix this bug” → Modell wechselt zu Coding-Modell.

## Feature 2: Image Attachment Staging

### Ziel

Bilder, die in das Eingabefeld eingefügt oder gedroppt werden, sollen über Obsidian-Neustarts hinweg erhalten bleiben und nach einem Abbruch direkt wieder verfügbar sein.

### Architektur

1. **Neuer Service `ImageStagingService`**
   - Speicherort: `<vault>/.claudian/staging/images/`
   - Manifest: `<vault>/.claudian/staging/images/manifest.json`
   - Manifest-Schema:
     ```ts
     interface StagedImageEntry {
       id: string;
       filename: string;
       name: string;
       mediaType: ImageMediaType;
       size: number;
       source: 'paste' | 'drop';
       createdAt: number;
     }
     ```

2. **Integration in `ImageContextManager`**
   - `addImageFromFile()`:
     1. Bild wie bisher in Base64 konvertieren.
     2. `ImageStagingService.saveImage(attachment)` aufrufen.
     3. Attachment in `attachedImages` speichern.
   - `removeImage(id)`:
     1. Eintrag aus `attachedImages` entfernen.
     2. `ImageStagingService.deleteImage(id)` aufrufen.
   - `clearImages()`:
     1. Alle Einträge aus `attachedImages` entfernen.
     2. Optional: alle gestagten Bilder löschen (wenn Nutzer explizit leert).
   - `restoreFromStaging()`:
     1. Liest das Manifest.
     2. Lädt alle nicht abgelaufenen Bilder in `attachedImages`.
     3. Aktualisiert die Preview.

3. **Aufräumen**
   - `ImageStagingService.cleanup(maxAgeDays = 7)` wird beim Plugin-Start aufgerufen.
   - Löscht Dateien und Manifest-Einträge, deren `createdAt` älter als 7 Tage ist.
   - Entfernt Einträge, deren Datei nicht mehr existiert.

4. **Cancel-Verhalten in `InputController`**
   - Beim Abbrechen einer laufenden Nachricht (z.B. über Stop-Button) werden die Bilder **nicht** aus dem Input entfernt.
   - Bilder werden erst bei erfolgreichem Senden geleert.

### Fehlerbehandlung

- Schreiben/Lesen der Staging-Datei schlägt fehl → Notice an Nutzer, Bild bleibt im Speicher verfügbar.
- Manifest ist korrupt → wird neu initialisiert, vorhandene Dateien werden bei Cleanup entfernt.
- Staging-Datei fehlt → Eintrag wird aus dem Manifest entfernt.

### Tests

- Unit-Test für `ImageStagingService.saveImage()` / `deleteImage()` / `cleanup()`.
- Integrations-Test: Bild einfügen → Plugin neu starten → Bild ist wiederhergestellt.
- Integrations-Test: Bild einfügen → Nachricht abbrechen → Bild bleibt im Input.

## Abhängigkeiten & Risiken

- **Vault-Zugriff:** `ImageStagingService` benötigt Schreib-/Lesezugriff auf den Vault. Fehlende Berechtigungen müssen abgefangen werden.
- **Dateigröße:** Große Bilder können den Staging-Ordner füllen. Das 7-Tage-Limit und die 5-MB-Bildbegrenzung im `ImageContextManager` begrenzen das Risiko.
- **Auto-Mode Überraschung:** Nutzer könnten verwirrt sein, wenn sich das Modell automatisch ändert. Eine kurze Notice oder ein Indikator im UI kann helfen (out of scope für diesen PR).

## Nicht im Scope

- UI-Setting für Staging-Aufbewahrungsdauer (fest auf 7 Tage).
- Pro-Conversation-Bildtrennung (globaler Staging-Pool).
- Verschlüsselung der gestagten Bilder.

## Entscheidungen

- **Auto-Mode bei Follow-ups:** Der Auto-Mode greift nur bei echten User-Senden (manuelle Eingabe). Automatische Follow-ups oder Tool-Responses lösen kein erneutes Routing aus.
- **Bilder nach erfolgreichem Senden:** Bilder werden aus dem Input entfernt, aber **nicht** aus dem Staging gelöscht. Sie bleiben 7 Tage verfügbar und können jederzeit wieder angehängt oder kopiert werden. Erst manuelles Entfernen oder Cleanup löscht sie.
