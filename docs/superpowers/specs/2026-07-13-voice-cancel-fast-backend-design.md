# Voice Input: Cancel + Fast Backend

## Ziel
Die Spracheingabe in ayontclaudian soll abbrechbar sein, wenn die Transkription zu lange dauert, und auf macOS Apple Silicon deutlich schneller laufen, indem `mlx_whisper` als bevorzugtes Backend genutzt wird. Auf Windows und älteren Macs bleibt `whisper-cli` als Fallback erhalten.

## Kontext
- Aktuell verwendet `src/core/audio/transcription.ts` hart `whisper-cli`.
- `src/features/chat/ui/VoiceInput.ts` hat keine Möglichkeit, eine laufende Transkription abzubrechen.
- Es gibt kein Timeout; lange Audios oder langsame CPUs können hängen.
- Auf macOS Apple Silicon ist `mlx_whisper` über `pip install mlx-whisper` verfügbar und nutzt GPU/ANE.

## Design

### 1. Cancel-Flow
- Während des `processing`-Zustands zeigt der Mic-Button ein **X**-Icon statt `loader-2`.
- Ein Klick auf den Button im `processing`-Zustand bricht die Transkription ab.
- Der Abbruch sendet ein `AbortSignal` an die Transkriptions-Pipeline.
- Sowohl `ffmpeg` (Konvertierung) als auch das gewählte Transkriptions-Backend werden bei Abbruch gekillt.
- Temporäre Dateien (`rawPath`, `wavPath`) werden trotz Abbruch aufgeräumt.
- Der State springt zurück zu `idle`.

### 2. Backend-Abstraktion
Neues Interface `VoiceTranscriber`:

```ts
interface VoiceTranscriber {
  readonly id: string;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  transcribe(
    wavPath: string,
    options: TranscriberOptions,
    abortSignal?: AbortSignal,
  ): Promise<TranscriptionResult>;
}
```

Optionen:

```ts
interface TranscriberOptions {
  language: string;
  model: string;
  modelPath?: string;
}
```

Implementierungen:

#### `WhisperCliTranscriber`
- Bisherige Logik aus `transcription.ts`.
- Unterstützt `--no-timestamps` (`-nt`), `-mc 0`, `-sns`.
- Sprach-Hint über `-l <lang>`.
- Reagiert auf `AbortSignal` durch Kill des `whisper-cli`-Prozesses.

#### `MlxWhisperTranscriber` (nur macOS)
- Verwendet `python3 -m mlx_whisper <wavPath> --language <lang> --model <mlx-model>`.
- Mapping der User-Modellauswahl (tiny/base/small/medium/large) zu MLX-HuggingFace-IDs:
  - `tiny` → `mlx-community/whisper-tiny-mlx`
  - `base` → `mlx-community/whisper-base-mlx`
  - `small` → `mlx-community/whisper-small-mlx`
  - `medium` → `mlx-community/whisper-medium-mlx`
  - `large` → `mlx-community/whisper-large-v3-mlx`
- Modelle werden bei erstem Gebrauch automatisch von Hugging Face heruntergeladen.
- Fallback auf `whisper-cli`, falls `mlx_whisper` nicht installiert ist.

### 3. Backend-Auswahl
`VoiceBackendResolver` wählt das beste verfügbare Backend:

1. Auf macOS: Prüfe `mlx_whisper`.
2. Falls nicht verfügbar oder nicht macOS: `whisper-cli`.

Settings zeigen das aktive Backend an:
- „Aktives Backend: mlx-whisper (schnell)“
- „Aktives Backend: whisper-cli (kompatibel)“

Neue Setting: `preferFastBackend` (default `true` auf macOS, `false` sonst).
Wenn `false`, wird immer `whisper-cli` verwendet.

### 4. Timeout
- Globales Timeout von **20 Sekunden** für die komplette Transkriptions-Pipeline.
- Wird das Timeout erreicht, wird automatisch abgebrochen.
- Nutzer sieht Notice: „Transkription dauerte zu lange — bitte erneut versuchen."

### 5. Auto-Setup erweitern
`ensureVoiceDependencies` prüft und installiert:
- ffmpeg
- whisper-cli
- Auf macOS zusätzlich: `python3 -m pip install mlx-whisper` (sofern Python verfügbar)

Falls `mlx_whisper` nicht installiert werden kann, wird `whisper-cli` verwendet.

### 6. UI/UX
- Mic-Button zeigt während Aufnahme: `square` (Stop).
- Mic-Button zeigt während Transkription: `x` (Cancel).
- Settings-Sektion zeigt aktives Backend und einen „Backend-Status prüfen"-Button.

## Dateien
- `src/core/audio/transcription.ts` → Interface + Implementierungen extrahieren/refactoren.
- `src/core/audio/voiceSetup.ts` → Backend-Verfügbarkeit + Setup erweitern.
- `src/core/audio/VoiceBackendResolver.ts` (neu) → Backend-Auswahl.
- `src/core/audio/VoiceTranscriber.ts` (neu) → Interface und gemeinsame Typen.
- `src/features/chat/ui/VoiceInput.ts` → Cancel-Button + AbortController.
- `src/features/settings/ui/VoiceSettingsSection.ts` → Backend-Anzeige + Einstellungen.
- `src/core/types/settings.ts` → `preferFastBackend` zu `voiceSettings` hinzufügen.
- `src/app/settings/defaultSettings.ts` → Default `preferFastBackend` setzen.
- `tests/unit/core/audio/*` → Tests für Resolver, Transcriber, Cancel.

## Tests
- `VoiceBackendResolver` wählt `mlx_whisper` auf macOS, wenn verfügbar.
- `VoiceBackendResolver` fällt auf `whisper-cli` zurück.
- `WhisperCliTranscriber` übergibt korrekte Argumente.
- `WhisperCliTranscriber` killt Prozess bei AbortSignal.
- `VoiceInput` zeigt Cancel-Icon im `processing`-Zustand.
- Timeout löst Abbruch aus.

## Abgrenzung (nicht im Scope)
- Keine Windows-GPU-Unterstützung in diesem Zug (`faster-whisper` bleibt manuell).
- Keine Streaming-Transkription während der Aufnahme.
- Keine Cloud-APIs (OpenAI Whisper API) als Backend.

## Erfolgskriterien
- User kann laufende Transkription per Klick abbrechen.
- Transkription bricht nach 20 Sekunden automatisch ab.
- Auf macOS Apple Silicon wird `mlx_whisper` verwendet, wenn verfügbar.
- Typecheck, Lint und Tests bleiben grün.
