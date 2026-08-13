import type { ClinePermissionMode } from '../settings';
import { isClineNativeSessionId } from '../types';
import {
  type ClineApiProviderId,
  type ClineCompactionMode,
  type ClineThinkingLevel,
  isClineCompactionMode,
  isClineThinkingLevel,
  normalizeClineModelId,
  resolveClineApiProvider,
} from '../types/models';

export type ClineLaunchMode = 'print';

export interface BuildClineLaunchSpecParams {
  apiProvider?: ClineApiProviderId;
  command: string;
  compaction?: ClineCompactionMode | string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  envText?: string;
  mode: ClineLaunchMode;
  model: string;
  permissionMode: ClinePermissionMode;
  prompt?: string;
  retries?: number;
  sessionId?: string | null;
  thinking: ClineThinkingLevel | string;
}

export interface ClineLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  launchKey: string;
}

export function normalizeClineThinking(value: string): ClineThinkingLevel {
  return isClineThinkingLevel(value) ? value : 'medium';
}

export function normalizeClineRetries(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 3;
  }
  return Math.min(10, Math.max(1, Math.round(value)));
}

/**
 * Cline 3.0.31+ rejects one-shot prompts unless the first positional looks
 * quoted. Shells strip quotes, so the CLI only treats an argv token as quoted
 * when it still contains whitespace. `hi` therefore dies with
 * "Unknown command or unquoted prompt" and can leave the process alive.
 */
export function formatClinePromptArg(prompt: string): string {
  return /\s/.test(prompt) ? prompt : `${prompt} `;
}

export function buildClineLaunchSpec(params: BuildClineLaunchSpecParams): ClineLaunchSpec {
  const model = normalizeClineModelId(params.model, params.apiProvider ?? 'cline-pass');
  const apiProvider = resolveClineApiProvider(model, params.apiProvider ?? 'cline-pass');
  const thinking = normalizeClineThinking(params.thinking);
  const compaction = isClineCompactionMode(params.compaction) ? params.compaction : undefined;
  const retries = normalizeClineRetries(params.retries);
  const args: string[] = ['--yolo', '--json'];

  if (apiProvider) {
    args.push('-P', apiProvider);
  }
  if (model) {
    args.push('-m', model);
  }
  if (thinking !== 'none') {
    args.push('--thinking', thinking);
  }
  if (compaction && compaction !== 'agentic') {
    args.push('--compaction', compaction);
  }
  if (retries !== 3) {
    args.push('--retries', String(retries));
  }
  args.push('-c', params.cwd);

  if (params.permissionMode === 'plan') {
    args.push('--plan');
  }
  if (isClineNativeSessionId(params.sessionId)) {
    args.push('--id', params.sessionId.trim());
  }
  if (params.prompt !== undefined) {
    args.push(formatClinePromptArg(params.prompt));
  }

  return {
    args,
    command: params.command,
    cwd: params.cwd,
    env: params.env,
    launchKey: JSON.stringify({
      apiProvider,
      compaction: compaction ?? 'agentic',
      command: params.command,
      cwd: params.cwd,
      envText: params.envText ?? '',
      mode: params.mode,
      model,
      permissionMode: params.permissionMode,
      retries,
      sessionId: params.sessionId?.trim() ?? null,
      thinking,
    }),
  };
}
