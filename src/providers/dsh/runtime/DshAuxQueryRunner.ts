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
import { DSH_PROVIDER_ID,getDshProviderSettings } from '../settings';
import { buildDshLaunchSpec } from './DshLaunchSpec';
import { buildDshRuntimeEnv } from './DshRuntimeEnvironment';

/**
 * One-shot `dsh --profile headless` runner for auxiliary tasks (title
 * generation, instruction refinement, inline edits). Every call is stateless,
 * so an auxiliary turn never pollutes a chat's history replay. Mirrors the
 * `AuxQueryRunner` contract used by `GrokAuxQueryRunner`.
 */
export class DshAuxQueryRunner implements AuxQueryRunner {
  private activeProcess: ChildProcessWithoutNullStreams | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getDshProviderSettings(settingsBag);
    if (!settings.enabled) {
      throw new Error('DeepSeek Harness ist deaktiviert.');
    }

    const command = this.plugin.getResolvedProviderCliPath(DSH_PROVIDER_ID);
    if (!command) {
      throw new Error('Konnte das `dsh`-Binary nicht finden.');
    }

    if (config.abortController?.signal.aborted) {
      throw new Error('Cancelled');
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const env = buildDshRuntimeEnv(settingsBag, command);
    const envText = getRuntimeEnvironmentText(settingsBag, DSH_PROVIDER_ID);
    const fullPrompt = config.systemPrompt.trim()
      ? `${config.systemPrompt.trim()}\n\n${prompt}`
      : prompt;

    const launchSpec = buildDshLaunchSpec({ command, cwd, env, envText, prompt: fullPrompt });

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
        const message = `dsh exited with code ${code}`;
        const tail = stderr.trim().slice(-2000);
        throw new Error(tail ? `${message}\n\n${tail}` : message);
      }

      const text = stdout.trim();
      if (!text) {
        throw new Error('dsh lieferte keine Antwort.');
      }
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
}
