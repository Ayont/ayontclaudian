import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type ClaudianPlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import {
  terminateSpawnedProcess,
  type WindowsCmdShimSpawnSpec,
} from '../../../utils/windowsCmdShim';
import { resolveClineModelSelection } from '../modelOptions';
import { extractClineJsonText } from '../normalization/jsonEvents';
import { CLINE_PROVIDER_ID,getClineProviderSettings } from '../settings';
import { buildClineLaunchSpec } from './ClineLaunchSpec';
import { spawnClineProcess } from './ClineProcess';
import { buildClineRuntimeEnv } from './ClineRuntimeEnvironment';

export class ClineAuxQueryRunner implements AuxQueryRunner {
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private activeSpawnSpec: WindowsCmdShimSpawnSpec | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getClineProviderSettings(settingsBag);
    if (!settings.enabled) {
      throw new Error('Cline ist deaktiviert.');
    }

    const command = this.plugin.getResolvedProviderCliPath(CLINE_PROVIDER_ID);
    if (!command) {
      throw new Error('Die `cline`-Binary wurde nicht gefunden.');
    }

    if (config.abortController?.signal.aborted) {
      throw new Error('Cancelled');
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const env = buildClineRuntimeEnv(settingsBag, command);
    const envText = getRuntimeEnvironmentText(settingsBag, CLINE_PROVIDER_ID);
    const model = config.model?.trim()
      || resolveClineModelSelection(settingsBag, typeof settingsBag.model === 'string' ? settingsBag.model : '')
      || '';
    const fullPrompt = config.systemPrompt.trim()
      ? `${config.systemPrompt.trim()}\n\n${prompt}`
      : prompt;

    const launchSpec = buildClineLaunchSpec({
      apiProvider: settings.apiProvider,
      command,
      compaction: 'off',
      cwd,
      env,
      envText,
      mode: 'print',
      model,
      permissionMode: 'yolo',
      prompt: fullPrompt,
      retries: 1,
      thinking: 'none',
    });

    const spawned = spawnClineProcess({
      args: launchSpec.args,
      command: launchSpec.command,
      cwd,
      env,
    });
    const proc = spawned.proc;
    this.activeProcess = proc;
    this.activeSpawnSpec = spawned.spawnSpec;

    return new Promise<string>((resolve, reject) => {
      let output = '';
      const onAbort = (): void => {
        terminateSpawnedProcess(proc, 'SIGTERM', spawn, spawned.spawnSpec);
        reject(new Error('Cancelled'));
      };
      config.abortController?.signal.addEventListener('abort', onAbort);

      proc.stdout.on('data', (chunk: Buffer | string) => {
        output += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      });
      proc.stderr.on('data', (chunk: Buffer | string) => {
        output += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      });
      proc.on('error', (error) => {
        config.abortController?.signal.removeEventListener('abort', onAbort);
        this.activeProcess = null;
        this.activeSpawnSpec = null;
        reject(error);
      });
      proc.on('close', () => {
        config.abortController?.signal.removeEventListener('abort', onAbort);
        this.activeProcess = null;
        this.activeSpawnSpec = null;
        const text = extractClineJsonText(output).trim();
        if (text) {
          resolve(text);
          return;
        }
        reject(new Error('Cline hat keine Antwort geliefert.'));
      });
    });
  }

  reset(): void {
    if (this.activeProcess) {
      terminateSpawnedProcess(this.activeProcess, 'SIGTERM', spawn, this.activeSpawnSpec);
      this.activeProcess = null;
      this.activeSpawnSpec = null;
    }
  }
}
