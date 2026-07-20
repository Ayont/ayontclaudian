/**
 * Auto-setup for voice transcription dependencies.
 * On first use, checks for whisper-cli, ggml-base model, and ffmpeg —
 * downloads or installs them silently so the end user doesn't have to.
 * macOS only (Electron/Obsidian context).
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';

import { getEnhancedPath } from '../../utils/env';

const MODEL_DIR = `${homedir()}/.cache/whisper-cpp`;
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin';

const MODEL_SIZES: Record<string, string> = {
  tiny: '~75 MB',
  base: '~142 MB',
  small: '~466 MB',
  medium: '~1.5 GB',
  large: '~3 GB',
};

const env = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: getEnhancedPath(process.env.PATH),
  HOME: homedir(),
});

function run(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let proc;
    try {
      proc = spawn(cmd, args, {
        env: env(),
        windowsHide: true,
        timeout: opts?.timeoutMs,
      });
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error) });
      return;
    }
    proc.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });
    proc.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });
    proc.on('error', () => resolve({ ok: false, stdout, stderr }));
    proc.on('close', (code) => resolve({ ok: code === 0, stdout, stderr }));
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dedicated venv for mlx-whisper. Homebrew Python is PEP 668
 * externally-managed — a plain `pip install mlx-whisper` fails there, which
 * was the "Spracheingabe kann nicht installiert werden" report. The venv
 * avoids that and pins a native arm64 interpreter on Apple Silicon.
 */
const VOICE_VENV_DIR = `${homedir()}/.cache/claudian/voice-venv`;
const VOICE_VENV_WHISPER = `${VOICE_VENV_DIR}/bin/mlx_whisper`;
const VOICE_VENV_PIP = `${VOICE_VENV_DIR}/bin/pip`;

/**
 * mlx-whisper ≥ 0.4 dropped `python -m mlx_whisper` (no `__main__`) — the CLI
 * is the `mlx_whisper` console script now. Accept any working invocation.
 */
async function mlxWhisperAvailable(): Promise<boolean> {
  if (await fileExists(VOICE_VENV_WHISPER)) {
    const venv = await run(VOICE_VENV_WHISPER, ['--help'], { timeoutMs: 10_000 });
    if (venv.ok) return true;
  }
  const script = await run('mlx_whisper', ['--help'], { timeoutMs: 10_000 });
  if (script.ok) return true;
  const legacy = await run('python3', ['-m', 'mlx_whisper', '--help'], { timeoutMs: 10_000 });
  return legacy.ok;
}

const NATIVE_BREW_PATH = '/opt/homebrew/bin/brew';

/**
 * True on an Apple Silicon Mac. On these machines `/usr/local/bin` is the
 * Intel/Rosetta Homebrew prefix — a CLI installed there runs translated, with
 * generic SSE SIMD only (no Apple Accelerate/Metal), which is dramatically
 * slower for CPU-bound tools like whisper.cpp. `/opt/homebrew/bin` is the
 * native ARM64 prefix and must be preferred for every install/lookup here.
 */
function isAppleSilicon(): boolean {
  return process.platform === 'darwin' && process.arch === 'arm64';
}

/**
 * Resolves the Homebrew binary to use for installs. On Apple Silicon, always
 * prefer the native `/opt/homebrew/bin/brew` when present — this guarantees
 * `brew install` writes native ARM64 binaries even if a stray Intel `brew`
 * happens to resolve first on PATH.
 */
async function resolveBrewCommand(): Promise<string> {
  if (isAppleSilicon() && (await fileExists(NATIVE_BREW_PATH))) {
    return NATIVE_BREW_PATH;
  }
  return 'brew';
}

/**
 * On Apple Silicon, checks whether the binary `which` resolved is actually a
 * native arm64 build rather than an x86_64 one running translated under
 * Rosetta. Non-Apple-Silicon platforms always report "native" (no check
 * applies there).
 */
async function isNativeBinary(resolvedPath: string): Promise<boolean> {
  if (!isAppleSilicon()) return true;
  const check = await run('file', ['-b', resolvedPath], { timeoutMs: 5_000 });
  if (!check.ok) return true; // Best-effort: don't block setup if `file` is missing.
  return !/x86_64/.test(check.stdout) || /arm64/.test(check.stdout);
}

/**
 * Checks a CLI both for presence AND correct architecture (Apple Silicon
 * only). Returns false for a Rosetta-translated binary even if `which` finds
 * it, so the caller reinstalls it natively via `/opt/homebrew`.
 */
async function checkNativeCli(bin: string): Promise<boolean> {
  const found = await run('which', [bin]);
  const resolvedPath = found.stdout.trim();
  if (!found.ok || !resolvedPath) return false;
  return isNativeBinary(resolvedPath);
}

export interface SetupResult {
  ffmpegOk: boolean;
  whisperOk: boolean;
  modelOk: boolean;
  /** True if mlx_whisper is available on macOS. */
  mlxOk: boolean;
  /** Human-readable summary of what was done / what failed. */
  message: string;
}

/**
 * Ensures all voice dependencies are available. Runs silently on first use.
 * Returns a result so the caller can show a Notice if something went wrong.
 * @param model Whisper model name (tiny/base/small/medium/large). Downloads that specific model.
 */
export async function ensureVoiceDependencies(model = 'base'): Promise<SetupResult> {
  const result: SetupResult = { ffmpegOk: false, whisperOk: false, modelOk: false, mlxOk: false, message: '' };
  const steps: string[] = [];
  const modelPath = `${MODEL_DIR}/ggml-${model}.bin`;
  const modelUrl = MODEL_URL.replace('{model}', model);
  const modelSize = MODEL_SIZES[model] ?? '~142 MB';

  const brew = await resolveBrewCommand();

  // ── 1. ffmpeg ──────────────────────────────────────────────────────
  if (await checkNativeCli('ffmpeg')) {
    result.ffmpegOk = true;
  } else {
    steps.push(
      isAppleSilicon()
        ? 'Installiere natives (Apple-Silicon) ffmpeg via Homebrew…'
        : 'Installiere ffmpeg via Homebrew…',
    );
    const install = await run(brew, ['install', 'ffmpeg'], { timeoutMs: 300_000 });
    if (install.ok) {
      result.ffmpegOk = true;
      steps.push('ffmpeg installiert.');
    } else {
      steps.push(`ffmpeg-Installation fehlgeschlagen: ${install.stderr.slice(0, 200)}`);
    }
  }

  // ── 2. whisper-cli ─────────────────────────────────────────────────
  if (await checkNativeCli('whisper-cli')) {
    result.whisperOk = true;
  } else if (isAppleSilicon() && !(await fileExists(NATIVE_BREW_PATH))) {
    // No NATIVE Homebrew on this machine — only the Intel one at /usr/local.
    // Reinstalling whisper-cpp through it would just produce another Rosetta
    // binary (and the next check would fail again → endless setup loop, the
    // "installiert nicht" bug). A Rosetta whisper-cli still WORKS, just
    // slower — accept it and say so plainly. The fast paths (whisper-server
    // is Rosetta-free to run, mlx-whisper native via venv, or the cloud
    // backend) don't depend on this binary's architecture.
    const anyWhisper = await run('which', ['whisper-cli']);
    if (anyWhisper.ok && anyWhisper.stdout.trim()) {
      result.whisperOk = true;
      steps.push('Hinweis: whisper-cli läuft unter Rosetta (kein natives Homebrew gefunden) — funktioniert, aber langsamer. Für natives whisper-cpp: Homebrew unter /opt/homebrew installieren.');
    } else {
      steps.push('whisper-cli fehlt und es gibt kein natives Homebrew (/opt/homebrew) zum Installieren — bitte Homebrew nativ installieren oder das Cloud-Backend nutzen.');
    }
  } else {
    steps.push(
      isAppleSilicon()
        // A Rosetta-translated whisper-cli (found via `which` but wrong arch)
        // is many times slower — no Apple Accelerate, no Metal, generic SSE
        // only. Reinstalling natively via /opt/homebrew fixes this silently.
        ? 'Installiere natives (Apple-Silicon) whisper-cpp via Homebrew…'
        : 'Installiere whisper-cpp via Homebrew…',
    );
    const install = await run(brew, ['install', 'whisper-cpp'], { timeoutMs: 600_000 });
    if (install.ok) {
      result.whisperOk = true;
      steps.push('whisper-cpp installiert (nativ, mit Metal/Accelerate-Beschleunigung).');
    } else {
      steps.push(`whisper-cpp-Installation fehlgeschlagen: ${install.stderr.slice(0, 200)}`);
    }
  }

  // ── 3. whisper model ──────────────────────────────────────────────
  if (await fileExists(modelPath)) {
    result.modelOk = true;
  } else {
    steps.push(`Lade whisper-${model}-Modell herunter (${modelSize})…`);
    try {
      await fs.mkdir(MODEL_DIR, { recursive: true });
      const dl = await run('curl', [
        '-sL', '--progress-bar',
        '-o', modelPath,
        modelUrl,
      ], { timeoutMs: 600_000 });
      if (dl.ok && await fileExists(modelPath)) {
        result.modelOk = true;
        steps.push('Modell heruntergeladen.');
      } else {
        steps.push('Modell-Download fehlgeschlagen.');
      }
    } catch (error) {
      steps.push(`Modell-Download fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── 4. mlx-whisper (macOS fast backend) ────────────────────────────
  if (process.platform === 'darwin') {
    if (await mlxWhisperAvailable()) {
      result.mlxOk = true;
    } else {
      steps.push('Installiere mlx-whisper für schnelle native Transkription (eigene Umgebung)…');
      // Homebrew Python is PEP 668 externally-managed — `pip install` into it
      // fails. A dedicated venv at ~/.cache/claudian/voice-venv is immune to
      // that and keeps every dependency out of the system Python.
      const venvReady = await fileExists(VOICE_VENV_PIP)
        || (await run('python3', ['-m', 'venv', VOICE_VENV_DIR], { timeoutMs: 120_000 })).ok;
      if (!venvReady) {
        steps.push('mlx-whisper-Installation fehlgeschlagen: Python-Umgebung (venv) konnte nicht erstellt werden.');
      } else {
        const install = await run(VOICE_VENV_PIP, ['install', 'mlx-whisper'], { timeoutMs: 600_000 });
        if (install.ok && (await mlxWhisperAvailable())) {
          result.mlxOk = true;
          steps.push('mlx-whisper installiert (nativ, Metal-beschleunigt).');
        } else {
          steps.push(`mlx-whisper-Installation fehlgeschlagen: ${install.stderr.slice(0, 200)}`);
        }
      }
    }
  }

  result.message = steps.join(' ');
  return result;
}

/**
 * Cloud users need exactly ONE local dependency: ffmpeg for the webm→wav
 * conversion before upload. No whisper binaries, no models, no venv.
 */
export async function ensureFfmpegOnly(): Promise<{ ok: boolean; message: string }> {
  if (await checkNativeCli('ffmpeg')) {
    return { ok: true, message: '' };
  }
  // Any ffmpeg works for a plain format conversion — architecture is
  // irrelevant here, so accept a Rosetta build without complaint.
  const anyFfmpeg = await run('which', ['ffmpeg']);
  if (anyFfmpeg.ok && anyFfmpeg.stdout.trim()) {
    return { ok: true, message: '' };
  }
  const brew = await resolveBrewCommand();
  const install = await run(brew, ['install', 'ffmpeg'], { timeoutMs: 300_000 });
  return install.ok
    ? { ok: true, message: 'ffmpeg installiert.' }
    : { ok: false, message: `ffmpeg-Installation fehlgeschlagen: ${install.stderr.slice(0, 200)}` };
}

/**
 * Quick check — true if everything is ready, false if setup is needed.
 * Used by the UI to decide whether to show a setup spinner.
 * @param model Whisper model name to check for.
 * @param preferFastBackend If true on macOS, also require mlx_whisper to be available.
 */
export async function areVoiceDependenciesReady(model = 'base', preferFastBackend = false): Promise<boolean> {
  const modelPath = `${MODEL_DIR}/ggml-${model}.bin`;
  // Mirror the setup's Rosetta acceptance: without a native Homebrew an
  // x86_64 whisper-cli is the best available option — don't report "missing"
  // forever when nothing better can be installed anyway.
  const rosettaAccepted = isAppleSilicon()
    && !(await fileExists(NATIVE_BREW_PATH))
    && (await run('which', ['whisper-cli'])).ok;
  const [ffmpegOk, whisperOk, modelOk, mlxOk] = await Promise.all([
    checkNativeCli('ffmpeg'),
    rosettaAccepted ? Promise.resolve(true) : checkNativeCli('whisper-cli'),
    fileExists(modelPath),
    preferFastBackend && process.platform === 'darwin' ? mlxWhisperAvailable() : Promise.resolve(true),
  ]);
  return ffmpegOk && whisperOk && modelOk && mlxOk;
}

/**
 * Diagnoses why voice input is slow/unavailable — surfaces the Apple Silicon
 * architecture mismatch specifically, since it produces no error (the tool
 * "works", just several times slower) and is otherwise invisible to the user.
 */
export interface VoiceDiagnostics {
  appleSilicon: boolean;
  whisperCliNative: boolean;
  ffmpegNative: boolean;
}

export async function diagnoseVoiceSetup(): Promise<VoiceDiagnostics> {
  if (!isAppleSilicon()) {
    return { appleSilicon: false, whisperCliNative: true, ffmpegNative: true };
  }
  const [whisperCliNative, ffmpegNative] = await Promise.all([
    checkNativeCli('whisper-cli'),
    checkNativeCli('ffmpeg'),
  ]);
  return { appleSilicon: true, whisperCliNative, ffmpegNative };
}
