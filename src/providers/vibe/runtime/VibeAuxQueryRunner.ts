import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as path from 'node:path';

import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import {
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
} from '../../../utils/windowsCmdShim';
import { resolveVibeModelSelection } from '../modelOptions';
import { isAssistantTextEvent, joinTextParts, parseVibeStream } from '../normalization/streamEvents';
import { getVibeProviderSettings, VIBE_PROVIDER_ID } from '../settings';
import { buildVibeLaunchSpec } from './VibeLaunchSpec';
import { buildVibeRuntimeEnv } from './VibeRuntimeEnvironment';

/**
 * One-shot `vibe --print` runner for auxiliary tasks (title generation,
 * instruction refinement, inline edits).
 *
 * Each call spawns a stateless `vibe --print --output-format stream-json`
 * (no `--session` resume, so the auxiliary turn never pollutes a chat session),
 * forces `--no-thinking` for speed, prepends the task-specific system prompt to
 * the user prompt, and resolves the final assistant text from the stream.
 * Mirrors the `AuxQueryRunner` contract used by `AntigravityAuxQueryRunner`.
 */
export class VibeAuxQueryRunner implements AuxQueryRunner {
  private activeProcess: ChildProcessWithoutNullStreams | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getVibeProviderSettings(settingsBag);
    if (!settings.enabled) {
      throw new Error('Vibe is disabled.');
    }

    const command = this.plugin.getResolvedProviderCliPath(VIBE_PROVIDER_ID);
    if (!command) {
      throw new Error('Could not find the `vibe` binary.');
    }

    if (config.abortController?.signal.aborted) {
      throw new Error('Cancelled');
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const env = buildVibeRuntimeEnv(settingsBag, command);
    const envText = getRuntimeEnvironmentText(settingsBag, VIBE_PROVIDER_ID);
    const model = config.model?.trim()
      || resolveVibeModelSelection(settingsBag, typeof settingsBag.model === 'string' ? settingsBag.model : '')
      || '';
    const fullPrompt = config.systemPrompt.trim()
      ? `${config.systemPrompt.trim()}\n\n${prompt}`
      : prompt;

    if (model) {
      env.VIBE_ACTIVE_MODEL = model;
    }

    const launchSpec = buildVibeLaunchSpec({
      command,
      cwd,
      env,
      envText,
      model,
      permissionMode: 'normal',
      prompt: fullPrompt,
    });

    const resolvedSpawnSpec = resolveWindowsCmdShimSpawnSpec(launchSpec);
    const proc = spawn(resolvedSpawnSpec.command, resolvedSpawnSpec.args, {
      cwd,
      env: {
        ...env,
        PATH: getEnhancedPath(env.PATH, path.isAbsolute(command) ? command : undefined),
      },
      stdio: 'pipe',
      windowsHide: true,
      ...(resolvedSpawnSpec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    this.activeProcess = proc;
    // Close stdin so a non-TTY child process can't block on the open pipe;
    // `vibe` print mode never reads stdin.
    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });

    const abortHandler = (): void => {
      if (proc.exitCode === null) {
        terminateSpawnedProcess(proc, 'SIGTERM', spawn, null);
      }
    };
    config.abortController?.signal.addEventListener('abort', abortHandler, { once: true });

    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        proc.on('error', reject);
        proc.on('close', (exitCode) => resolve(exitCode));
      });

      if (config.abortController?.signal.aborted) {
        throw new Error('Cancelled');
      }

      if (code !== 0 && code !== null) {
        const message = `vibe exited with code ${code}`;
        const tail = stderr.trim().slice(-2000);
        throw new Error(tail ? `${message}\n\n${tail}` : message);
      }

      const text = this.resolveFinalText(stdout);
      config.onTextChunk?.(text);
      return text;
    } finally {
      config.abortController?.signal.removeEventListener('abort', abortHandler);
      if (this.activeProcess === proc) {
        this.activeProcess = null;
      }
    }
  }

  reset(): void {
    const proc = this.activeProcess;
    this.activeProcess = null;
    if (proc && proc.exitCode === null) {
      terminateSpawnedProcess(proc, 'SIGTERM', spawn, null);
    }
  }

  /**
   * Resolves the final visible assistant text from a stream-json buffer.
   *
   * Concatenates the visible `text` parts of the LAST assistant message (the
   * closing message of the run). Falls back to trimmed raw stdout when no
   * structured assistant text is found.
   */
  private resolveFinalText(stdout: string): string {
    const events = parseVibeStream(stdout);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (isAssistantTextEvent(event)) {
        const text = joinTextParts(event.parts).trim();
        if (text) {
          return text;
        }
      }
    }
    return stdout.trim();
  }
}
