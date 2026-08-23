import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import {
  AcpClientConnection,
  AcpJsonRpcTransport,
  type AcpPermissionOption,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
  extractAcpSessionModelState,
} from '../../acp';
import { decodeHermesModelId, isHermesModelSelectionId } from '../models';
import { HERMES_DEFAULT_MODE_ID } from '../modes';
import { HERMES_PROVIDER_ID } from '../settings';
import { buildHermesRuntimeEnv } from './HermesRuntimeEnvironment';

interface HermesAuxQueryRunnerOptions {
  allowReadTextFile?: boolean;
}

/**
 * Auxiliary Hermes turns (title generation, instruction refinement, inline
 * edits) run in their own short-lived `hermes acp` process so they can never
 * disturb the chat session's model, mode or history.
 *
 * Hermes has no ACP channel for a per-session system prompt, so the caller's
 * system prompt is prepended to the request text — the same shape the other
 * print-mode providers use. Every permission request is denied: an auxiliary
 * turn must not perform side effects.
 */
export class HermesAuxQueryRunner implements AuxQueryRunner {
  private availableModelIds = new Set<string>();
  private connection: AcpClientConnection | null = null;
  private currentLaunchKey: string | null = null;
  private currentModelId: string | null = null;
  private process: AcpSubprocess | null = null;
  private sessionCwd: string | null = null;
  private sessionId: string | null = null;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private transport: AcpJsonRpcTransport | null = null;

  constructor(
    private readonly plugin: ClaudianPlugin,
    private readonly options: HermesAuxQueryRunnerOptions = {},
  ) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    await this.ensureReady(cwd);

    if (!this.connection) {
      throw new Error('Die Hermes-Runtime ist nicht bereit.');
    }

    if (!this.sessionId && !(await this.createSession(cwd))) {
      throw new Error('Es konnte keine Hermes-Sitzung erstellt werden.');
    }

    const sessionId = this.sessionId!;
    await this.applyModel(sessionId, config.model);

    this.sessionUpdateNormalizer.reset();
    let accumulatedText = '';
    const removeListener = this.connection.onSessionNotification((notification) => {
      if (notification.sessionId !== sessionId) {
        return;
      }

      const normalized = this.sessionUpdateNormalizer.normalize(notification.update);
      if (normalized.type !== 'message_chunk' || normalized.role !== 'assistant') {
        return;
      }

      for (const chunk of normalized.streamChunks) {
        if (chunk.type !== 'text') {
          continue;
        }
        accumulatedText += chunk.content;
        config.onTextChunk?.(accumulatedText);
      }
    });

    const abortHandler = () => {
      if (this.connection && this.sessionId) {
        this.connection.cancel({ sessionId: this.sessionId });
      }
    };
    config.abortController?.signal.addEventListener('abort', abortHandler, { once: true });

    try {
      if (config.abortController?.signal.aborted) {
        throw new Error('Cancelled');
      }

      const systemPrompt = config.systemPrompt.trim();
      await this.connection.prompt({
        prompt: [{ type: 'text', text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }],
        sessionId,
      });

      if (config.abortController?.signal.aborted) {
        throw new Error('Cancelled');
      }

      return accumulatedText;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Hermes-Anfrage fehlgeschlagen';
      const stderr = this.process?.getStderrSnapshot();
      throw new Error(
        stderr ? `${message}\n\n${stderr}` : message,
        error instanceof Error ? { cause: error } : undefined,
      );
    } finally {
      config.abortController?.signal.removeEventListener('abort', abortHandler);
      removeListener();
    }
  }

  reset(): void {
    this.availableModelIds.clear();
    this.currentLaunchKey = null;
    this.currentModelId = null;
    this.sessionCwd = null;
    this.sessionId = null;
    this.connection?.dispose();
    this.connection = null;
    this.transport?.dispose();
    this.transport = null;
    if (this.process) {
      void this.process.shutdown().catch(() => {});
    }
    this.process = null;
    this.sessionUpdateNormalizer.reset();
  }

  private async ensureReady(cwd: string): Promise<void> {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const command = this.plugin.getResolvedProviderCliPath(HERMES_PROVIDER_ID) ?? 'hermes';
    const runtimeEnv = buildHermesRuntimeEnv(settingsBag, command);
    const nextLaunchKey = JSON.stringify({
      command,
      cwd,
      envText: getRuntimeEnvironmentText(settingsBag, HERMES_PROVIDER_ID),
    });

    const shouldRestart = !this.process
      || !this.transport
      || !this.connection
      || !this.process.isAlive()
      || this.transport.isClosed
      || this.currentLaunchKey !== nextLaunchKey;

    if (!shouldRestart) {
      return;
    }

    this.reset();
    await this.startProcess({ command, cwd, runtimeEnv });
    this.currentLaunchKey = nextLaunchKey;
  }

  private async startProcess(params: {
    command: string;
    cwd: string;
    runtimeEnv: NodeJS.ProcessEnv;
  }): Promise<void> {
    this.process = new AcpSubprocess({
      args: ['acp'],
      command: params.command,
      cwd: params.cwd,
      env: {
        ...params.runtimeEnv,
        PATH: getEnhancedPath(
          params.runtimeEnv.PATH,
          path.isAbsolute(params.command) ? params.command : undefined,
        ),
      },
    });
    this.process.start();

    this.transport = new AcpJsonRpcTransport({
      input: this.process.stdout,
      onClose: (listener) => this.process!.onClose(listener),
      output: this.process.stdin,
    });

    this.connection = new AcpClientConnection({
      clientInfo: {
        name: 'claudian-aux',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        fileSystem: this.options.allowReadTextFile
          ? { readTextFile: (request) => this.readTextFile(request) }
          : undefined,
        requestPermission: (request) => this.handlePermissionRequest(request),
      },
      transport: this.transport,
    });

    this.transport.start();
    await this.connection.initialize();
  }

  private async createSession(cwd: string): Promise<string | null> {
    if (!this.connection) {
      return null;
    }

    try {
      const response = await this.connection.newSession({ cwd, mcpServers: [] });
      const state = extractAcpSessionModelState({ models: response.models ?? null });
      this.currentModelId = state.currentModelId;
      this.availableModelIds = new Set(state.availableModels.map((model) => model.id));
      // Keep the strictest edit policy so an auxiliary turn always asks — and
      // therefore is always denied — before touching a file.
      await this.connection.setMode({ modeId: HERMES_DEFAULT_MODE_ID, sessionId: response.sessionId });
      this.sessionId = response.sessionId;
      this.sessionCwd = cwd;
      return response.sessionId;
    } catch {
      return null;
    }
  }

  private async applyModel(sessionId: string, explicitModel?: string): Promise<void> {
    const selected = this.resolveSelectedRawModel(explicitModel);
    if (!this.connection || !selected || selected === this.currentModelId) {
      return;
    }
    if (this.availableModelIds.size > 0 && !this.availableModelIds.has(selected)) {
      return;
    }

    await this.connection.setModel({ modelId: selected, sessionId });
    this.currentModelId = selected;
  }

  private resolveSelectedRawModel(explicitModel?: string): string | null {
    if (explicitModel?.trim()) {
      const trimmed = explicitModel.trim();
      return isHermesModelSelectionId(trimmed) ? decodeHermesModelId(trimmed) : trimmed;
    }

    const projectedSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      HERMES_PROVIDER_ID,
    );
    const selectedModel = typeof projectedSettings.model === 'string' ? projectedSettings.model : '';
    return isHermesModelSelectionId(selectedModel) ? decodeHermesModelId(selectedModel) : null;
  }

  private async readTextFile(request: AcpReadTextFileRequest): Promise<{ content: string }> {
    const cwd = this.sessionCwd ?? getVaultPath(this.plugin.app) ?? process.cwd();
    const resolvedPath = path.isAbsolute(request.path)
      ? path.resolve(request.path)
      : path.resolve(cwd, request.path);
    const relative = path.relative(cwd, resolvedPath);
    if (relative !== '' && (relative.startsWith('..') || path.isAbsolute(relative))) {
      throw new Error('Hermes-Hilfsanfragen dürfen nur im aktuellen Workspace lesen.');
    }

    return { content: await fs.readFile(resolvedPath, 'utf-8') };
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    return selectPermissionOption(request.options, ['reject_once', 'reject_always']);
  }
}

function selectPermissionOption(
  options: readonly AcpPermissionOption[],
  preferredKinds: readonly AcpPermissionOption['kind'][],
): AcpRequestPermissionResponse {
  for (const kind of preferredKinds) {
    const option = options.find((entry) => entry.kind === kind);
    if (option) {
      return { outcome: { optionId: option.optionId, outcome: 'selected' } };
    }
  }

  return { outcome: { outcome: 'cancelled' } };
}
