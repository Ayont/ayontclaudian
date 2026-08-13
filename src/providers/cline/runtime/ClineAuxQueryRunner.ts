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
import { resolveClineModelSelection } from '../modelOptions';
import { extractClineJsonText } from '../normalization/jsonEvents';
import { CLINE_PROVIDER_ID,getClineProviderSettings } from '../settings';
import { buildClineLaunchSpec } from './ClineLaunchSpec';
import { buildClineRuntimeEnv } from './ClineRuntimeEnvironment';

export class ClineAuxQueryRunner implements AuxQueryRunner {
  private activeProcess: ChildProcessWithoutNullStreams | null = null;

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
      cwd,
      env,
      envText,
      mode: 'print',
      model,
      permissionMode: 'yolo',
      prompt: fullPrompt,
      thinking: 'none',
    });

    const resolvedSpawnSpec = resolveWindowsCmdShimSpawnSpec(launchSpec);
    const proc = spawn(resolvedSpawnSpec.command, resolvedSpawnSpec.args, {
      cwd,
      env: {
        ...env,
        PATH: getEnhancedPath(env.PATH, path.isAbsolute(command) ? command : undefined),
      },
      stdio: 'pipe',
    });
    this.activeProcess = proc;

    return new Promise<string>((resolve, reject) => {
      let output = '';
      const onAbort = (): void => {
        terminateSpawnedProcess(proc, 'SIGTERM', spawn, null);
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
        reject(error);
      });
      proc.on('close', () => {
        config.abortController?.signal.removeEventListener('abort', onAbort);
        this.activeProcess = null;
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
      terminateSpawnedProcess(this.activeProcess, 'SIGTERM', spawn, null);
      this.activeProcess = null;
    }
  }
}
