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
const MODEL_PATH = `${MODEL_DIR}/ggml-base.bin`;
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

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

export interface SetupResult {
  ffmpegOk: boolean;
  whisperOk: boolean;
  modelOk: boolean;
  /** Human-readable summary of what was done / what failed. */
  message: string;
}

/**
 * Ensures all voice dependencies are available. Runs silently on first use.
 * Returns a result so the caller can show a Notice if something went wrong.
 */
export async function ensureVoiceDependencies(): Promise<SetupResult> {
  const result: SetupResult = { ffmpegOk: false, whisperOk: false, modelOk: false, message: '' };
  const steps: string[] = [];

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

  // ── 3. ggml-base model ────────────────────────────────────────────
  if (await fileExists(MODEL_PATH)) {
    result.modelOk = true;
  } else {
    steps.push('Lade whisper-basismodell herunter (~142 MB)…');
    try {
      await fs.mkdir(MODEL_DIR, { recursive: true });
      const dl = await run('curl', [
        '-sL', '--progress-bar',
        '-o', MODEL_PATH,
        MODEL_URL,
      ], { timeoutMs: 600_000 });
      if (dl.ok && await fileExists(MODEL_PATH)) {
        result.modelOk = true;
        steps.push('Modell heruntergeladen.');
      } else {
        steps.push('Modell-Download fehlgeschlagen.');
      }
    } catch (error) {
      steps.push(`Modell-Download fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  result.message = steps.join(' ');
  return result;
}

/**
 * Quick check — true if everything is ready, false if setup is needed.
 * Used by the UI to decide whether to show a setup spinner.
 */
export async function areVoiceDependenciesReady(): Promise<boolean> {
  const [ffmpegOk, whisperOk, modelOk] = await Promise.all([
    run('which', ['ffmpeg']).then((r) => r.ok && r.stdout.trim().length > 0),
    run('which', ['whisper-cli']).then((r) => r.ok && r.stdout.trim().length > 0),
    fileExists(MODEL_PATH),
  ]);
  return ffmpegOk && whisperOk && modelOk;
}
