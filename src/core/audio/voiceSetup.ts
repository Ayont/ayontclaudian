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

async function mlxWhisperAvailable(): Promise<boolean> {
  const r = await run('python3', ['-m', 'mlx_whisper', '--help'], { timeoutMs: 10_000 });
  return r.ok;
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

  // ── 1. ffmpeg ──────────────────────────────────────────────────────
  const ffmpegCheck = await run('which', ['ffmpeg']);
  if (ffmpegCheck.ok && ffmpegCheck.stdout.trim()) {
    result.ffmpegOk = true;
  } else {
    steps.push('Installiere ffmpeg via Homebrew…');
    const install = await run('brew', ['install', 'ffmpeg'], { timeoutMs: 300_000 });
    if (install.ok) {
      result.ffmpegOk = true;
      steps.push('ffmpeg installiert.');
    } else {
      steps.push(`ffmpeg-Installation fehlgeschlagen: ${install.stderr.slice(0, 200)}`);
    }
  }

  // ── 2. whisper-cli ─────────────────────────────────────────────────
  const whisperCheck = await run('which', ['whisper-cli']);
  if (whisperCheck.ok && whisperCheck.stdout.trim()) {
    result.whisperOk = true;
  } else {
    steps.push('Installiere whisper-cpp via Homebrew…');
    const install = await run('brew', ['install', 'whisper-cpp'], { timeoutMs: 600_000 });
    if (install.ok) {
      result.whisperOk = true;
      steps.push('whisper-cpp installiert.');
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
      steps.push('Installiere mlx-whisper für schnelle Transkription…');
      const install = await run('python3', ['-m', 'pip', 'install', 'mlx-whisper'], { timeoutMs: 300_000 });
      if (install.ok && (await mlxWhisperAvailable())) {
        result.mlxOk = true;
        steps.push('mlx-whisper installiert.');
      } else {
        steps.push(`mlx-whisper-Installation fehlgeschlagen: ${install.stderr.slice(0, 200)}`);
      }
    }
  }

  result.message = steps.join(' ');
  return result;
}

/**
 * Quick check — true if everything is ready, false if setup is needed.
 * Used by the UI to decide whether to show a setup spinner.
 * @param model Whisper model name to check for.
 * @param preferFastBackend If true on macOS, also require mlx_whisper to be available.
 */
export async function areVoiceDependenciesReady(model = 'base', preferFastBackend = false): Promise<boolean> {
  const modelPath = `${MODEL_DIR}/ggml-${model}.bin`;
  const [ffmpegOk, whisperOk, modelOk, mlxOk] = await Promise.all([
    run('which', ['ffmpeg']).then((r) => r.ok && r.stdout.trim().length > 0),
    run('which', ['whisper-cli']).then((r) => r.ok && r.stdout.trim().length > 0),
    fileExists(modelPath),
    preferFastBackend && process.platform === 'darwin' ? mlxWhisperAvailable() : Promise.resolve(true),
  ]);
  return ffmpegOk && whisperOk && modelOk && mlxOk;
}
