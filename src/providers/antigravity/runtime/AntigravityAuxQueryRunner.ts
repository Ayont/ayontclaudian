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
import {
  deleteAntigravityConversationDir,
  discoverNewestConversationId,
  readAntigravityTranscript,
  snapshotBrainConversationIds,
} from '../history/AntigravityBrainStore';
import { isAssistantTextEvent, parseTranscript, stripAgyTrailingRecap } from '../normalization/transcript';
import { ANTIGRAVITY_PROVIDER_ID, getAntigravityProviderSettings } from '../settings';
import { buildAntigravityLaunchSpec } from './AntigravityLaunchSpec';
import { buildAntigravityRuntimeEnv } from './AntigravityRuntimeEnvironment';

/**
 * One-shot `agy --print` runner for auxiliary tasks (title generation,
 * instruction refinement, inline edits).
 *
 * Each call spawns a stateless `agy --print` (no `--conversation` resume, so
 * the auxiliary turn never pollutes a chat conversation), prepends the
 * task-specific system prompt to the user prompt (agy has no system-prompt
 * flag), and resolves the final assistant text from stdout. Mirrors the
 * `AuxQueryRunner` contract used by `OpencodeAuxQueryRunner` / `PiAuxQueryRunner`.
 */

/** Settle delay so `agy` finishes flushing transcript.jsonl after process exit. */
const ANTIGRAVITY_AUX_SETTLE_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class AntigravityAuxQueryRunner implements AuxQueryRunner {
  private activeProcess: ChildProcessWithoutNullStreams | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getAntigravityProviderSettings(settingsBag);
    if (!settings.enabled) {
      throw new Error('Antigravity is disabled.');
    }

    const command = this.plugin.getResolvedProviderCliPath(ANTIGRAVITY_PROVIDER_ID);
    if (!command) {
      throw new Error('Could not find the `agy` binary.');
    }

    if (config.abortController?.signal.aborted) {
      throw new Error('Cancelled');
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const env = buildAntigravityRuntimeEnv(settingsBag, command);
    const envText = getRuntimeEnvironmentText(settingsBag, ANTIGRAVITY_PROVIDER_ID);
    const fullPrompt = config.systemPrompt.trim()
      ? `${config.systemPrompt.trim()}\n\n${prompt}`
      : prompt;
    const launchSpec = buildAntigravityLaunchSpec({
      command,
      conversationId: null,
      cwd,
      env,
      envText,
      prompt: fullPrompt,
    });

    // Snapshot existing conversations so we can identify the fresh one this aux
    // run creates — its transcript is the only output source under non-TTY.
    const previousBrainIds = snapshotBrainConversationIds();

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
    // `agy` blocks reading an open non-TTY stdin until EOF; close it so the
    // one-shot aux run completes (and writes its transcript) instead of hanging.
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
        proc.on('exit', (exitCode) => resolve(exitCode));
      });

      if (config.abortController?.signal.aborted) {
        throw new Error('Cancelled');
      }

      if (code !== 0 && code !== null) {
        const message = `agy exited with code ${code}`;
        const tail = stderr.trim().slice(-2000);
        throw new Error(tail ? `${message}\n\n${tail}` : message);
      }

      // `agy` print mode writes nothing to stdout under a non-TTY child process
      // (it only renders to a real terminal), so recover the final assistant
      // text from the fresh conversation's transcript, falling back to stdout
      // for the rare TTY case.
      await sleep(ANTIGRAVITY_AUX_SETTLE_MS);
      const text = stdout.trim() || this.recoverFinalTextFromTranscript(previousBrainIds);
      config.onTextChunk?.(text);
      return text;
    } finally {
      config.abortController?.signal.removeEventListener('abort', abortHandler);
      if (this.activeProcess === proc) {
        this.activeProcess = null;
      }
    }
  }

  /**
   * Recovers the final assistant text for a one-shot aux run from the freshly
   * created conversation's transcript. Only a conversation created by this run
   * (absent from `previousBrainIds`) is read or deleted — never a pre-existing
   * chat conversation. Returns `''` when no fresh conversation was produced.
   */
  private recoverFinalTextFromTranscript(previousBrainIds: ReadonlySet<string>): string {
    const conversationId = discoverNewestConversationId(previousBrainIds);
    if (!conversationId || previousBrainIds.has(conversationId)) {
      return '';
    }
    const buffer = readAntigravityTranscript(conversationId);
    let finalText = '';
    if (buffer) {
      for (const event of parseTranscript(buffer)) {
        if (isAssistantTextEvent(event) && event.content) {
          // Strip agy's `***`/recap so generated titles/refinements stay clean,
          // matching the chat-facing paths in transcriptMapping.
          finalText = stripAgyTrailingRecap(event.content).trim();
        }
      }
    }
    deleteAntigravityConversationDir(conversationId);
    return finalText;
  }

  reset(): void {
    const proc = this.activeProcess;
    this.activeProcess = null;
    if (proc && proc.exitCode === null) {
      terminateSpawnedProcess(proc, 'SIGTERM', spawn, null);
    }
  }
}
