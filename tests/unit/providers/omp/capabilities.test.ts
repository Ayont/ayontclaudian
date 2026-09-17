import { OMP_PROVIDER_CAPABILITIES } from '@/providers/omp/capabilities';

describe('OMP_PROVIDER_CAPABILITIES', () => {
  it('identifies as omp', () => {
    expect(OMP_PROVIDER_CAPABILITIES.providerId).toBe('omp');
  });

  it('declares native-system prompt delivery, matching --append-system-prompt', () => {
    expect(OMP_PROVIDER_CAPABILITIES.promptDelivery).toBe('native-system');
  });

  it('declares the ACP features the agent really advertises', () => {
    expect(OMP_PROVIDER_CAPABILITIES.supportsPersistentRuntime).toBe(true);
    expect(OMP_PROVIDER_CAPABILITIES.supportsNativeHistory).toBe(true);
    expect(OMP_PROVIDER_CAPABILITIES.supportsImageAttachments).toBe(true);
    expect(OMP_PROVIDER_CAPABILITIES.supportsProviderCommands).toBe(true);
  });

  it('declares plan mode and effort, which come from real config options', () => {
    expect(OMP_PROVIDER_CAPABILITIES.supportsPlanMode).toBe(true);
    expect(OMP_PROVIDER_CAPABILITIES.reasoningControl).toBe('effort');
  });

  it('does not claim capabilities the runtime has not wired yet', () => {
    // The agent advertises fork and MCP, but the runtime still sends
    // `mcpServers: []` and has no fork path. Flip these with the wiring.
    expect(OMP_PROVIDER_CAPABILITIES.supportsFork).toBe(false);
    expect(OMP_PROVIDER_CAPABILITIES.supportsMcpTools).toBe(false);
    expect(OMP_PROVIDER_CAPABILITIES.supportsRewind).toBe(false);
  });
});
