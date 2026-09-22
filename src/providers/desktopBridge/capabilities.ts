import type { ProviderCapabilities } from '../../core/providers/types';
import type { DesktopBridgeProviderId } from './DesktopBridgeTransport';
export function desktopCapabilities(providerId: DesktopBridgeProviderId): ProviderCapabilities {
  return { providerId, promptDelivery: 'stateless-turn', supportsPersistentRuntime: false, supportsNativeHistory: false, supportsPlanMode: false, supportsRewind: false, supportsFork: false, supportsProviderCommands: false, supportsImageAttachments: false, supportsInstructionMode: false, supportsMcpTools: false, supportsMultiAgent: false, supportsTurnSteer: false, reasoningControl: 'none' };
}
