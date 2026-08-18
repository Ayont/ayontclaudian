import type { ProviderCapabilities } from '../../core/providers/types';
import { CLINE_PROVIDER_ID } from './settings';

export const CLINE_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: CLINE_PROVIDER_ID,
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: true,
  supportsMultiAgent: true,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});
