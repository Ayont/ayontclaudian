# Voice Cancel + Fast Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Spracheingabe wird abbrechbar (Cancel-Button + Timeout) und nutzt auf macOS Apple Silicon `mlx_whisper` als schnelles Backend, während `whisper-cli` als universeller Fallback bleibt.

**Architecture:** Ein gemeinsames `VoiceTranscriber`-Interface abstrahiert whisper-cli und mlx-whisper. Ein `VoiceBackendResolver` wählt das beste verfügbare Backend. `VoiceInput` führt einen `AbortController`, der sowohl ffmpeg als auch das gewählte Transkriptions-Backend bei Abbruch killt. Ein globales Timeout von 20 Sekunden sichert den Abbruch ab.

**Tech Stack:** TypeScript, Obsidian API, Node.js `child_process`, `AbortController`/`AbortSignal`.

---

## File Overview

| File | Responsibility |
|---|---|
| `src/core/audio/VoiceTranscriber.ts` (new) | Interface + gemeinsame Typen für alle Transkriptions-Backends |
| `src/core/audio/WhisperCliTranscriber.ts` (new) | Implementation für `whisper-cli` |
| `src/core/audio/MlxWhisperTranscriber.ts` (new) | Implementation für `python3 -m mlx_whisper` |
| `src/core/audio/VoiceBackendResolver.ts` (new) | Wählt das beste Backend basierend auf Plattform und Verfügbarkeit |
| `src/core/audio/transcription.ts` (modify) | Public API bleibt erhalten, intern delegiert an `VoiceBackendResolver` |
| `src/core/audio/voiceSetup.ts` (modify) | Prüft/Installiert `mlx_whisper` auf macOS |
| `src/core/types/settings.ts` (modify) | `preferFastBackend` zu `voiceSettings` hinzufügen |
| `src/app/settings/defaultSettings.ts` (modify) | Default für `preferFastBackend` |
| `src/features/chat/ui/VoiceInput.ts` (modify) | Cancel-Button + AbortController + Timeout |
| `src/features/settings/ui/VoiceSettingsSection.ts` (modify) | Backend-Status + Einstellung |
| `tests/unit/core/audio/*.test.ts` (new/modify) | Unit-Tests für Resolver, Transcriber, Cancel |

---

### Task 1: VoiceTranscriber interface + types

**Files:**
- Create: `src/core/audio/VoiceTranscriber.ts`

- [ ] **Step 1: Create interface and types**

```typescript
export interface TranscriptionResult {
  ok: boolean;
  text: string;
  error?: string;
}

export interface TranscriberOptions {
  /** BCP-47-ish language hint, or 'auto'. */
  language: string;
  /** Whisper model size selected by the user (tiny/base/small/medium/large). */
  model: string;
  /** Optional explicit path to a ggml model (whisper-cli only). */
  modelPath?: string;
}

export interface VoiceTranscriber {
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

- [ ] **Step 2: Commit**

```bash
git add src/core/audio/VoiceTranscriber.ts
git commit -m "feat(voice): add VoiceTranscriber interface and types"
```

---

### Task 2: WhisperCliTranscriber

**Files:**
- Create: `src/core/audio/WhisperCliTranscriber.ts`
- Modify: `src/core/audio/transcription.ts`

- [ ] **Step 1: Create WhisperCliTranscriber**

Extract the existing logic from `transcription.ts` into a class.

```typescript
import { spawn } from 'node:child_process';
import { getEnhancedPath } from '../../utils/env';
import type { TranscriberOptions, TranscriptionResult, VoiceTranscriber } from './VoiceTranscriber';

export type SpawnLike = typeof spawn;

const DEFAULT_MODEL_PATH = '~/.cache/whisper-cpp/ggml-base.bin';

function expandHome(p: string): string {
  if (p.startsWith('~')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return home + p.slice(1);
  }
  return p;
}

export function parseWhisperOutput(stdout: string): string {
  return stdout
    .split('\n')
    .map((line) => line.replace(/^\s*\[[^\]]*\]\s*/, '').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class WhisperCliTranscriber implements VoiceTranscriber {
  readonly id = 'whisper-cli';
  readonly displayName = 'whisper-cli (kompatibel)';

  constructor(private readonly spawnImpl: SpawnLike = spawn) {}

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = this.spawnImpl('which', ['whisper-cli'], { env: process.env });
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
  }

  transcribe(
    wavPath: string,
    options: TranscriberOptions,
    abortSignal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    const modelPath = expandHome(options.modelPath ?? DEFAULT_MODEL_PATH);
    const language = options.language || 'auto';

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let proc;

      const cleanup = () => {
        try {
          proc?.kill('SIGTERM');
        } catch {
          // ignore
        }
      };

      abortSignal?.addEventListener('abort', cleanup, { once: true });

      try {
        proc = this.spawnImpl(
          'whisper-cli',
          ['-m', modelPath, '-l', language, '-nt', '-mc', '0', '-sns', wavPath],
          {
            env: { ...process.env, PATH: getEnhancedPath(process.env.PATH) },
            windowsHide: true,
          },
        );
      } catch (error) {
        resolve({
          ok: false,
          text: '',
          error: error instanceof Error ? error.message : 'whisper-cli konnte nicht gestartet werden',
        });
        return;
      }

      proc.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      });
      proc.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      });
      proc.on('error', (error: Error) => {
        resolve({
          ok: false,
          text: '',
          error: /ENOENT/.test(error.message)
            ? 'whisper-cli nicht gefunden — installiere es mit „brew install whisper-cpp".'
            : error.message,
        });
      });
      proc.on('close', (code: number | null) => {
        abortSignal?.removeEventListener('abort', cleanup);
        const text = parseWhisperOutput(stdout);
        if (code === 0 && text) {
          resolve({ ok: true, text });
        } else if (code === 0) {
          resolve({ ok: true, text: '' });
        } else {
          resolve({
            ok: false,
            text: '',
            error: stderr.trim() || `whisper-cli endete mit Code ${code ?? -1}`,
          });
        }
      });
    });
  }
}
```

- [ ] **Step 2: Update transcription.ts to delegate**

Replace the contents of `src/core/audio/transcription.ts` with:

```typescript
import { WhisperCliTranscriber } from './WhisperCliTranscriber';
import { VoiceBackendResolver } from './VoiceBackendResolver';
import type { TranscriberOptions, TranscriptionResult, VoiceTranscriber } from './VoiceTranscriber';

export type { TranscriberOptions, TranscriptionResult, VoiceTranscriber };
export { WhisperCliTranscriber, parseWhisperOutput } from './WhisperCliTranscriber';

export interface TranscribeOptions extends TranscriberOptions {
  /** If true, prefer the fast backend (mlx_whisper on macOS). */
  preferFastBackend?: boolean;
  /** Injectable spawn for tests. */
  spawnImpl?: import('./WhisperCliTranscriber').SpawnLike;
}

/**
 * Transcribes a wav file using the best available backend.
 */
export async function transcribeAudioFile(
  wavPath: string,
  options: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const resolver = new VoiceBackendResolver(options.preferFastBackend ?? true);
  const backend = await resolver.resolve();
  if (!backend) {
    return {
      ok: false,
      text: '',
      error: 'Kein Transkriptions-Backend verfügbar. Bitte Spracheingabe-Einrichtung ausführen.',
    };
  }
  return backend.transcribe(wavPath, options);
}
```

- [ ] **Step 3: Update existing tests**

In `tests/unit/core/audio/transcription.test.ts`, update imports to use `WhisperCliTranscriber` directly for the existing tests and keep `parseWhisperOutput` tests.

- [ ] **Step 4: Commit**

```bash
git add src/core/audio/WhisperCliTranscriber.ts src/core/audio/transcription.ts tests/unit/core/audio/transcription.test.ts
git commit -m "feat(voice): extract WhisperCliTranscriber and delegate via resolver"
```

---

### Task 3: MlxWhisperTranscriber

**Files:**
- Create: `src/core/audio/MlxWhisperTranscriber.ts`

- [ ] **Step 1: Create MlxWhisperTranscriber**

```typescript
import { spawn } from 'node:child_process';
import { getEnhancedPath } from '../../utils/env';
import type { TranscriberOptions, TranscriptionResult, VoiceTranscriber } from './VoiceTranscriber';

const MLX_MODEL_MAP: Record<string, string> = {
  tiny: 'mlx-community/whisper-tiny-mlx',
  base: 'mlx-community/whisper-base-mlx',
  small: 'mlx-community/whisper-small-mlx',
  medium: 'mlx-community/whisper-medium-mlx',
  large: 'mlx-community/whisper-large-v3-mlx',
};

export class MlxWhisperTranscriber implements VoiceTranscriber {
  readonly id = 'mlx-whisper';
  readonly displayName = 'mlx-whisper (schnell, macOS)';

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('python3', ['-m', 'mlx_whisper', '--help'], {
        env: process.env,
        windowsHide: true,
      });
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
  }

  transcribe(
    wavPath: string,
    options: TranscriberOptions,
    abortSignal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    const model = MLX_MODEL_MAP[options.model] ?? MLX_MODEL_MAP.base;
    const language = options.language || 'auto';

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let proc;

      const cleanup = () => {
        try {
          proc?.kill('SIGTERM');
        } catch {
          // ignore
        }
      };

      abortSignal?.addEventListener('abort', cleanup, { once: true });

      try {
        proc = spawn(
          'python3',
          ['-m', 'mlx_whisper', wavPath, '--model', model, '--language', language],
          {
            env: { ...process.env, PATH: getEnhancedPath(process.env.PATH) },
            windowsHide: true,
          },
        );
      } catch (error) {
        resolve({
          ok: false,
          text: '',
          error: error instanceof Error ? error.message : 'mlx_whisper konnte nicht gestartet werden',
        });
        return;
      }

      proc.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      });
      proc.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      });
      proc.on('error', (error: Error) => {
        resolve({
          ok: false,
          text: '',
          error: /ENOENT/.test(error.message)
            ? 'mlx_whisper nicht gefunden.'
            : error.message,
        });
      });
      proc.on('close', (code: number | null) => {
        abortSignal?.removeEventListener('abort', cleanup);
        const text = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (code === 0) {
          resolve({ ok: true, text });
        } else {
          resolve({
            ok: false,
            text: '',
            error: stderr.trim() || `mlx_whisper endete mit Code ${code ?? -1}`,
          });
        }
      });
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/audio/MlxWhisperTranscriber.ts
git commit -m "feat(voice): add MlxWhisperTranscriber for macOS Apple Silicon"
```

---

### Task 4: VoiceBackendResolver

**Files:**
- Create: `src/core/audio/VoiceBackendResolver.ts`
- Modify: `src/core/audio/transcription.ts`

- [ ] **Step 1: Create VoiceBackendResolver**

```typescript
import { MlxWhisperTranscriber } from './MlxWhisperTranscriber';
import { WhisperCliTranscriber } from './WhisperCliTranscriber';
import type { VoiceTranscriber } from './VoiceTranscriber';

export class VoiceBackendResolver {
  constructor(
    private readonly preferFastBackend: boolean,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async resolve(): Promise<VoiceTranscriber | null> {
    const candidates: VoiceTranscriber[] = [];

    if (this.preferFastBackend && this.platform === 'darwin') {
      candidates.push(new MlxWhisperTranscriber());
    }

    candidates.push(new WhisperCliTranscriber());

    for (const candidate of candidates) {
      if (await candidate.isAvailable()) {
        return candidate;
      }
    }

    return null;
  }
}
```

- [ ] **Step 2: Update transcription.ts to use resolver**

Already done in Task 2, but verify that `VoiceBackendResolver` is imported and instantiated correctly.

- [ ] **Step 3: Commit**

```bash
git add src/core/audio/VoiceBackendResolver.ts src/core/audio/transcription.ts
git commit -m "feat(voice): add VoiceBackendResolver with mlx-whisper preference on macOS"
```

---

### Task 5: voiceSetup backend checks + install

**Files:**
- Modify: `src/core/audio/voiceSetup.ts`

- [ ] **Step 1: Add mlx_whisper check and install**

Add a helper function and extend `ensureVoiceDependencies`:

```typescript
async function mlxWhisperAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-m', 'mlx_whisper', '--help'], { env: env(), windowsHide: true });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}
```

In `ensureVoiceDependencies`, after the whisper-cli check, add:

```typescript
  // ── 4. mlx-whisper (macOS fast backend) ───────────────────────────
  let mlxOk = false;
  if (process.platform === 'darwin') {
    if (await mlxWhisperAvailable()) {
      mlxOk = true;
    } else {
      steps.push('Installiere mlx-whisper für schnelle Transkription…');
      const install = await run('python3', ['-m', 'pip', 'install', 'mlx-whisper'], { timeoutMs: 300_000 });
      if (install.ok && (await mlxWhisperAvailable())) {
        mlxOk = true;
        steps.push('mlx-whisper installiert.');
      } else {
        steps.push(`mlx-whisper-Installation fehlgeschlagen: ${install.stderr.slice(0, 200)}`);
      }
    }
  }
```

Update `SetupResult` to include `mlxOk?: boolean` and return it.

Update `areVoiceDependenciesReady` to also check `mlxOk` on macOS when fast backend is preferred. For now, keep it simple: `areVoiceDependenciesReady` returns true if at least whisper-cli is ready (so the existing UI doesn't break). Add a separate `areFastVoiceDependenciesReady` if needed later.

- [ ] **Step 2: Commit**

```bash
git add src/core/audio/voiceSetup.ts
git commit -m "feat(voice): auto-install mlx-whisper on macOS during setup"
```

---

### Task 6: Settings types + defaults

**Files:**
- Modify: `src/core/types/settings.ts`
- Modify: `src/app/settings/defaultSettings.ts`

- [ ] **Step 1: Add preferFastBackend to settings type**

In `src/core/types/settings.ts`, update `voiceSettings`:

```typescript
  voiceSettings?: {
    enabled: boolean;
    language: string;
    model: string;
    autoSetup: boolean;
    microphoneId: string;
    /** Prefer a fast backend (mlx_whisper on macOS) when available. */
    preferFastBackend: boolean;
  };
```

- [ ] **Step 2: Add default**

In `src/app/settings/defaultSettings.ts`:

```typescript
  voiceSettings: {
    enabled: true,
    language: 'auto',
    model: 'base',
    autoSetup: true,
    microphoneId: '',
    preferFastBackend: true,
  },
```

- [ ] **Step 3: Commit**

```bash
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts
git commit -m "feat(voice): add preferFastBackend setting"
```

---

### Task 7: VoiceInput cancel flow

**Files:**
- Modify: `src/features/chat/ui/VoiceInput.ts`

- [ ] **Step 1: Add AbortController and timeout**

Add to the class:

```typescript
  private abortController: AbortController | null = null;
  private processingTimeout: number | null = null;
  private static readonly TRANSCRIPTION_TIMEOUT_MS = 20_000;
```

Update `setState` to show cancel icon during processing:

```typescript
    setIcon(this.button, state === 'recording' ? 'square' : state === 'processing' ? 'x' : 'mic');
```

Update `toggle`:

```typescript
  private async toggle(): Promise<void> {
    if (this.state === 'recording') {
      this.stopRecording();
      return;
    }
    if (this.state === 'processing') {
      this.cancelProcessing();
      return;
    }
    await this.startRecording();
  }
```

Add `cancelProcessing`:

```typescript
  private cancelProcessing(): void {
    if (this.processingTimeout) {
      window.clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
    this.abortController?.abort();
    this.abortController = null;
    this.setState('idle');
    new Notice('Transkription abgebrochen.');
  }
```

Update `finishRecording`:

```typescript
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

    this.abortController = new AbortController();
    this.processingTimeout = window.setTimeout(() => {
      this.abortController?.abort();
      new Notice('Transkription dauerte zu lange — bitte erneut versuchen.');
    }, VoiceInput.TRANSCRIPTION_TIMEOUT_MS);

    try {
      const buffer = Buffer.from(await blob.arrayBuffer());
      await fs.writeFile(rawPath, buffer);
      await this.convertToWav(rawPath, wavPath);

      const model = this.callbacks.getModel?.() ?? 'base';
      const preferFastBackend = this.callbacks.getPreferFastBackend?.() ?? true;
      const result = await transcribeAudioFile(wavPath, {
        language: this.callbacks.getLanguage?.() ?? 'auto',
        model,
        modelPath: `${homedir()}/.cache/whisper-cpp/ggml-${model}.bin`,
        preferFastBackend,
        spawnImpl: spawn,
      });
      if (this.abortController.signal.aborted) return;
      if (result.ok && result.text) {
        this.callbacks.onInsert(result.text);
      } else if (result.ok) {
        new Notice('Keine Sprache erkannt — bitte deutlicher sprechen.');
      } else {
        new Notice(`Transkription fehlgeschlagen: ${result.error ?? 'unbekannt'}`);
      }
    } catch (error) {
      if (this.abortController.signal.aborted) return;
      new Notice(`Sprachaufnahme fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (this.processingTimeout) {
        window.clearTimeout(this.processingTimeout);
        this.processingTimeout = null;
      }
      this.abortController = null;
      await fs.rm(rawPath, { force: true }).catch(() => {});
      await fs.rm(wavPath, { force: true }).catch(() => {});
      this.setState('idle');
    }
  }
```

Note: `convertToWav` currently doesn't accept an abort signal. Update it to accept one and wire it through:

```typescript
  private convertToWav(input: string, output: string, abortSignal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let proc;
      const onAbort = () => {
        try { proc?.kill('SIGTERM'); } catch {}
        reject(new Error('Abgebrochen'));
      };
      abortSignal?.addEventListener('abort', onAbort, { once: true });
      // ... existing spawn logic ...
      proc.on('close', (code: number | null) => {
        abortSignal?.removeEventListener('abort', onAbort);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg endete mit Code ${code ?? -1}`));
      });
    });
  }
```

Add `getPreferFastBackend` to `VoiceInputCallbacks`:

```typescript
  /** Whether to prefer the fast transcription backend. */
  getPreferFastBackend?: () => boolean;
```

- [ ] **Step 2: Commit**

```bash
git add src/features/chat/ui/VoiceInput.ts
git commit -m "feat(voice): add cancel button and transcription timeout"
```

---

### Task 8: VoiceSettingsSection backend UI

**Files:**
- Modify: `src/features/settings/ui/VoiceSettingsSection.ts`

- [ ] **Step 1: Add backend status display and preferFastBackend toggle**

Add after the model picker:

```typescript
  // ── Fast Backend Toggle ───────────────────────────────────────────
  if (process.platform === 'darwin') {
    new Setting(section)
      .setName('Schnelles Backend bevorzugen')
      .setDesc('mlx-whisper auf Apple Silicon nutzen (deutlich schneller als whisper-cli)')
      .addToggle((toggle) =>
        toggle
          .setValue(vs.preferFastBackend)
          .onChange(async (value) => {
            vs.preferFastBackend = value;
            await plugin.saveSettings();
          }),
      );
  }

  // ── Active Backend ────────────────────────────────────────────────
  const backendStatusEl = section.createEl('p', {
    cls: 'claudian-voice-model-info',
    text: 'Prüfe aktives Backend…',
  });

  void (async () => {
    const { VoiceBackendResolver } = await import('../../../core/audio/VoiceBackendResolver');
    const resolver = new VoiceBackendResolver(vs.preferFastBackend);
    const backend = await resolver.resolve();
    backendStatusEl.textContent = backend
      ? `Aktives Backend: ${backend.displayName}`
      : 'Aktives Backend: nicht verfügbar';
  })();
```

- [ ] **Step 2: Wire getPreferFastBackend in Tab.ts**

In `src/features/chat/tabs/Tab.ts`, update the VoiceInput callbacks:

```typescript
    getPreferFastBackend: () => plugin.settings.voiceSettings?.preferFastBackend ?? true,
```

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/ui/VoiceSettingsSection.ts src/features/chat/tabs/Tab.ts
git commit -m "feat(voice): show active backend and fast-backend toggle in settings"
```

---

### Task 9: Unit tests

**Files:**
- Create: `tests/unit/core/audio/WhisperCliTranscriber.test.ts`
- Create: `tests/unit/core/audio/MlxWhisperTranscriber.test.ts`
- Create: `tests/unit/core/audio/VoiceBackendResolver.test.ts`
- Modify: `tests/unit/core/audio/transcription.test.ts`

- [ ] **Step 1: Test WhisperCliTranscriber**

```typescript
import type { ChildProcess } from 'node:child_process';
import { WhisperCliTranscriber } from '@/core/audio/WhisperCliTranscriber';
import type { SpawnLike } from '@/core/audio/WhisperCliTranscriber';

function createFakeSpawn(stdout: string, code: number): SpawnLike {
  // similar to existing transcription.test.ts helper
}

describe('WhisperCliTranscriber', () => {
  it('isAvailable returns true when whisper-cli is found', async () => {
    const t = new WhisperCliTranscriber(createFakeSpawn('/opt/homebrew/bin/whisper-cli\n', 0));
    expect(await t.isAvailable()).toBe(true);
  });

  it('transcribe passes correct args and returns text', async () => {
    const spawn = createFakeSpawn('Hallo Welt', 0);
    const t = new WhisperCliTranscriber(spawn);
    const result = await t.transcribe('/tmp/test.wav', { language: 'de', model: 'base' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Hallo Welt');
  });

  it('transcribe aborts when signal is triggered', async () => {
    const spawn = createFakeSpawn('Hallo', 0);
    const t = new WhisperCliTranscriber(spawn);
    const controller = new AbortController();
    const promise = t.transcribe('/tmp/test.wav', { language: 'de', model: 'base' }, controller.signal);
    controller.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Test MlxWhisperTranscriber**

Similar structure, verifying model mapping and availability check.

- [ ] **Step 3: Test VoiceBackendResolver**

```typescript
import { VoiceBackendResolver } from '@/core/audio/VoiceBackendResolver';

describe('VoiceBackendResolver', () => {
  it('prefers mlx-whisper on darwin when preferFastBackend is true', async () => {
    const resolver = new VoiceBackendResolver(true, 'darwin');
    const backend = await resolver.resolve();
    expect(backend?.id).toBe('mlx-whisper');
  });

  it('falls back to whisper-cli on non-darwin', async () => {
    const resolver = new VoiceBackendResolver(true, 'win32');
    const backend = await resolver.resolve();
    expect(backend?.id).toBe('whisper-cli');
  });
});
```

Note: These tests rely on actual system availability. For deterministic tests, inject transcriber factories into the resolver or mock `isAvailable`.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/core/audio/
git commit -m "test(voice): add unit tests for transcribers and backend resolver"
```

---

### Task 10: Typecheck, build, deploy, commit

- [ ] **Step 1: Run typecheck**

```bash
cd /Users/ayont/Developer/claudian-dev
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run tests**

```bash
cd /Users/ayont/Developer/claudian-dev
npm test
```

Expected: all pass.

- [ ] **Step 3: Build and deploy**

```bash
cd /Users/ayont/Developer/claudian-dev
npm run build
SRC=/Users/ayont/Developer/claudian-dev
DST="/Users/ayont/Documents/Obsidian Vault/.obsidian/plugins/realclaudian"
cp "$SRC/main.js" "$DST/main.js"
cp "$SRC/styles.css" "$DST/styles.css"
cp "$SRC/manifest.json" "$DST/manifest.json"
```

- [ ] **Step 4: Commit and push**

```bash
cd /Users/ayont/Developer/claudian-dev
git add -A
git commit -m "5.43.1: voice cancel + fast mlx-whisper backend on macOS"
git push
```

- [ ] **Step 5: Update project note**

Update `02-Projekte/ayontclaudian/ayontclaudian.md` success box to mention cancel + fast backend.
