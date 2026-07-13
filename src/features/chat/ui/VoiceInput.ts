import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

import { homedir } from 'node:os';

import { Notice, setIcon } from 'obsidian';

import { transcribeAudioFile } from '../../../core/audio/transcription';
import { ensureVoiceDependencies } from '../../../core/audio/voiceSetup';
import { getEnhancedPath } from '../../../utils/env';

export interface VoiceInputCallbacks {
  /** Inserts the transcribed text into the composer. */
  onInsert: (text: string) => void;
  /** Optional language hint for whisper ('auto' by default). */
  getLanguage?: () => string;
  /** Returns the whisper model name (e.g. 'base', 'small') for the model path. */
  getModel?: () => string;
  /** Returns the selected microphone device ID (empty = system default). */
  getMicrophoneId?: () => string;
}

type VoiceState = 'idle' | 'recording' | 'processing';

/**
 * Push-to-talk voice input. Records mic audio in the renderer, converts it to
 * 16 kHz mono wav with ffmpeg, and transcribes locally with whisper-cli — the
 * same fully-local toolchain the video analyzer uses. One mic button in the
 * composer toolbar toggles recording; the transcript lands in the input.
 *
 * On first use, automatically installs whisper-cpp, the ggml-base model, and
 * ffmpeg via Homebrew if they are missing — no manual setup required.
 */
export class VoiceInput {
  private button: HTMLButtonElement | null = null;
  private state: VoiceState = 'idle';
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private setupDone = false;

  constructor(private readonly callbacks: VoiceInputCallbacks) {}

  /** Creates the mic toggle button inside the given toolbar element. */
  render(parent: HTMLElement): HTMLButtonElement {
    const button = parent.createEl('button', {
      cls: 'claudian-voice-btn',
      attr: { type: 'button', 'aria-label': 'Spracheingabe (Push-to-talk)', title: 'Spracheingabe' },
    });
    setIcon(button, 'mic');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.toggle();
    });
    this.button = button;
    return button;
  }

  private setState(state: VoiceState): void {
    this.state = state;
    if (!this.button) return;
    this.button.toggleClass('is-recording', state === 'recording');
    this.button.toggleClass('is-processing', state === 'processing');
    this.button.empty();
    setIcon(this.button, state === 'recording' ? 'square' : state === 'processing' ? 'loader-2' : 'mic');
    const label = state === 'recording'
      ? 'Aufnahme stoppen'
      : state === 'processing'
        ? 'Transkribiere…'
        : 'Spracheingabe';
    this.button.setAttribute('aria-label', label);
    this.button.setAttribute('title', label);
    if (state === 'processing') {
      this.button.setAttribute('disabled', '');
    } else {
      this.button.removeAttribute('disabled');
    }
  }

  private async toggle(): Promise<void> {
    if (this.state === 'recording') {
      this.stopRecording();
      return;
    }
    if (this.state === 'processing') return;
    await this.startRecording();
  }

  private async ensureSetup(): Promise<boolean> {
    if (this.setupDone) return true;
    const model = this.callbacks.getModel?.() ?? 'base';
    new Notice('Spracheingabe wird eingerichtet — erste Einrichtung kann 1–3 Minuten dauern…');
    this.setState('processing');
    try {
      const result = await ensureVoiceDependencies(model);
      if (result.ffmpegOk && result.whisperOk && result.modelOk) {
        this.setupDone = true;
        new Notice('Spracheingabe bereit!');
        return true;
      }
      // Partial success — tell user what's missing
      const missing: string[] = [];
      if (!result.ffmpegOk) missing.push('ffmpeg');
      if (!result.whisperOk) missing.push('whisper-cpp');
      if (!result.modelOk) missing.push(`whisper-${model}-Modell`);
      new Notice(
        `Spracheingabe nicht vollständig eingerichtet. Fehlend: ${missing.join(', ')}. ` +
        `Bitte manuell installieren:\n• brew install ffmpeg whisper-cpp\n• curl -sL -o ~/.cache/whisper-cpp/ggml-${model}.bin ` +
        `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`,
        10_000,
      );
      return false;
    } catch (error) {
      new Notice(
        `Einrichtung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}. ` +
        `Bitte manuell installieren: brew install ffmpeg whisper-cpp`,
        10_000,
      );
      return false;
    } finally {
      this.setState('idle');
    }
  }

  private async startRecording(): Promise<void> {
    // Auto-setup on first use
    if (!this.setupDone) {
      const ready = await this.ensureSetup();
      if (!ready) return;
    }

    const media = navigator?.mediaDevices;
    if (!media?.getUserMedia || typeof MediaRecorder === 'undefined') {
      new Notice('Mikrofon-Aufnahme wird in dieser Umgebung nicht unterstützt.');
      return;
    }

    // Build constraints — use selected microphone if specified
    const micId = this.callbacks.getMicrophoneId?.() ?? '';
    const constraints: MediaStreamConstraints = micId
      ? { audio: { deviceId: { exact: micId } } }
      : { audio: true };

    try {
      this.stream = await media.getUserMedia(constraints);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('OverconstrainedError') || msg.includes('Requested device not found')) {
        new Notice('Ausgewähltes Mikrofon nicht gefunden — bitte in den Einstellungen prüfen.');
      } else {
        new Notice('Mikrofon-Zugriff verweigert. Bitte in den Systemeinstellungen erlauben.');
      }
      return;
    }

    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    this.mediaRecorder.addEventListener('stop', () => {
      void this.finishRecording();
    });
    this.mediaRecorder.start();
    this.setState('recording');
  }

  private stopRecording(): void {
    try {
      this.mediaRecorder?.stop();
    } catch {
      // Already stopped.
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.setState('processing');
  }

  private async finishRecording(): Promise<void> {
    const blob = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
    this.mediaRecorder = null;
    if (blob.size < 100) {
      new Notice('Keine Audioaufnahme erkannt — bitte erneut drücken und halten.');
      this.setState('idle');
      return;
    }

    const stamp = `${tmpdir()}/claudian-voice-${this.uniqueSuffix()}`;
    const rawPath = `${stamp}.webm`;
    const wavPath = `${stamp}.wav`;
    try {
      const buffer = Buffer.from(await blob.arrayBuffer());
      await fs.writeFile(rawPath, buffer);
      await this.convertToWav(rawPath, wavPath);

      const model = this.callbacks.getModel?.() ?? 'base';
      const modelPath = `${homedir()}/.cache/whisper-cpp/ggml-${model}.bin`;
      const result = await transcribeAudioFile(wavPath, {
        language: this.callbacks.getLanguage?.() ?? 'auto',
        modelPath,
      });
      if (result.ok && result.text) {
        this.callbacks.onInsert(result.text);
      } else if (result.ok) {
        new Notice('Keine Sprache erkannt — bitte deutlicher sprechen.');
      } else {
        new Notice(`Transkription fehlgeschlagen: ${result.error ?? 'unbekannt'}`);
      }
    } catch (error) {
      new Notice(`Sprachaufnahme fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await fs.rm(rawPath, { force: true }).catch(() => {});
      await fs.rm(wavPath, { force: true }).catch(() => {});
      this.setState('idle');
    }
  }

  /** Converts the recorded blob to 16 kHz mono wav (whisper's preferred input). */
  private convertToWav(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let proc;
      try {
        proc = spawn('ffmpeg', ['-v', 'error', '-i', input, '-ac', '1', '-ar', '16000', output, '-y'], {
          env: { ...process.env, PATH: getEnhancedPath(process.env.PATH) },
          windowsHide: true,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('ffmpeg konnte nicht gestartet werden'));
        return;
      }
      proc.on('error', (error: Error) => reject(
        /ENOENT/.test(error.message)
          ? new Error('ffmpeg nicht gefunden — installiere es mit „brew install ffmpeg".')
          : error,
      ));
      proc.on('close', (code: number | null) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg endete mit Code ${code ?? -1}`));
      });
    });
  }

  private uniqueSuffix(): string {
    // Renderer has crypto.randomUUID; fall back to a perf-timestamp otherwise.
    const uuid = (globalThis.crypto as Crypto | undefined)?.randomUUID?.();
    return uuid ?? `${Math.floor(performance.now())}-${this.chunks.length}`;
  }

  destroy(): void {
    this.stopRecording();
    this.button?.remove();
    this.button = null;
  }
}
