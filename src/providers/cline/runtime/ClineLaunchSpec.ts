import type { ClinePermissionMode } from '../settings';
import { isClineNativeSessionId } from '../types';
import {
  type ClineApiProviderId,
  type ClineThinkingLevel,
  isClineThinkingLevel,
  resolveClineApiProvider,
} from '../types/models';

export type ClineLaunchMode = 'acp' | 'print';

export interface BuildClineLaunchSpecParams {
  apiProvider?: ClineApiProviderId;
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  envText?: string;
  mode: ClineLaunchMode;
  model: string;
  permissionMode: ClinePermissionMode;
  prompt?: string;
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
  return isClineThinkingLevel(value) ? value : 'high';
}

export function buildClineLaunchSpec(params: BuildClineLaunchSpecParams): ClineLaunchSpec {
  const model = params.model.trim();
  const apiProvider = resolveClineApiProvider(model, params.apiProvider ?? 'cline-pass');
  const thinking = normalizeClineThinking(params.thinking);
  const args: string[] = [];

  if (params.mode === 'acp') {
    args.push('--acp');
  } else {
    args.push('--yolo', '--json');
  }

  if (apiProvider) {
    args.push('-P', apiProvider);
  }
  if (model) {
    args.push('-m', model);
  }
  args.push('--thinking', thinking, '-c', params.cwd);

  if (params.mode === 'acp') {
    args.push('--auto-approve', params.permissionMode === 'normal' ? 'false' : 'true');
  }
  if (params.permissionMode === 'plan') {
    args.push('--plan');
  }
  if (isClineNativeSessionId(params.sessionId)) {
    args.push('--id', params.sessionId.trim());
  }
  if (params.mode === 'print' && params.prompt !== undefined) {
    args.push(params.prompt);
  }

  return {
    args,
    command: params.command,
    cwd: params.cwd,
    env: params.env,
    launchKey: JSON.stringify({
      apiProvider,
      command: params.command,
      cwd: params.cwd,
      envText: params.envText ?? '',
      mode: params.mode,
      model,
      permissionMode: params.permissionMode,
      sessionId: params.sessionId?.trim() ?? null,
      thinking,
    }),
  };
}
