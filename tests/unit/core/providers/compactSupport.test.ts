import { resolveCompactCommand } from '@/core/providers/compactSupport';
import type { ProviderCapabilities } from '@/core/providers/types';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from '@/providers/antigravity/capabilities';
import { CLAUDE_PROVIDER_CAPABILITIES } from '@/providers/claude/capabilities';
import { CLINE_PROVIDER_CAPABILITIES } from '@/providers/cline/capabilities';
import { CODEX_PROVIDER_CAPABILITIES } from '@/providers/codex/capabilities';
import { desktopCapabilities } from '@/providers/desktopBridge/capabilities';
import { DSH_PROVIDER_CAPABILITIES } from '@/providers/dsh/capabilities';
import { GROK_PROVIDER_CAPABILITIES } from '@/providers/grok/capabilities';
import { HERMES_PROVIDER_CAPABILITIES } from '@/providers/hermes/capabilities';
import { KIMI_PROVIDER_CAPABILITIES } from '@/providers/kimi/capabilities';
import { OMP_PROVIDER_CAPABILITIES } from '@/providers/omp/capabilities';
import { OPENCODE_PROVIDER_CAPABILITIES } from '@/providers/opencode/capabilities';
import { PI_PROVIDER_CAPABILITIES } from '@/providers/pi/capabilities';
import { VIBE_PROVIDER_CAPABILITIES } from '@/providers/vibe/capabilities';
import { ZCODE_PROVIDER_CAPABILITIES } from '@/providers/zcode/capabilities';

describe('resolveCompactCommand', () => {
  it('returns null when the provider declares no compact support', () => {
    expect(resolveCompactCommand(undefined, [{ name: 'compact' }])).toBeNull();
  });

  it('returns a builtin command without consulting advertised commands', () => {
    expect(resolveCompactCommand({ command: '/compact', availability: 'builtin' }, null)).toBe('/compact');
  });

  it('offers an advertised command only while the agent advertises it', () => {
    const support = { command: '/compress', availability: 'advertised' } as const;
    expect(resolveCompactCommand(support, null)).toBeNull();
    expect(resolveCompactCommand(support, [])).toBeNull();
    expect(resolveCompactCommand(support, [{ name: 'model' }, { name: 'help' }])).toBeNull();
    expect(resolveCompactCommand(support, [{ name: 'model' }, { name: 'compress' }])).toBe('/compress');
  });

  it('matches advertised names regardless of a leading slash or case', () => {
    const support = { command: '/compact', availability: 'advertised' } as const;
    expect(resolveCompactCommand(support, [{ name: '/Compact' }])).toBe('/compact');
  });
});

describe('provider compact capabilities', () => {
  it.each<[string, Readonly<ProviderCapabilities>, string]>([
    ['claude', CLAUDE_PROVIDER_CAPABILITIES, '/compact'],
    ['codex', CODEX_PROVIDER_CAPABILITIES, '/compact'],
    ['pi', PI_PROVIDER_CAPABILITIES, '/compact'],
    ['opencode', OPENCODE_PROVIDER_CAPABILITIES, '/compact'],
  ])('%s compacts through a verified builtin command', (_id, capabilities, command) => {
    expect(capabilities.compact).toEqual({ command, availability: 'builtin' });
    expect(Object.isFrozen(capabilities.compact)).toBe(true);
  });

  it.each<[string, Readonly<ProviderCapabilities>, string]>([
    ['hermes', HERMES_PROVIDER_CAPABILITIES, '/compress'],
    ['omp', OMP_PROVIDER_CAPABILITIES, '/compact'],
  ])('%s compacts only through its advertised ACP command', (_id, capabilities, command) => {
    expect(capabilities.compact).toEqual({ command, availability: 'advertised' });
  });

  it.each<[string, Readonly<ProviderCapabilities>]>([
    ['kimi', KIMI_PROVIDER_CAPABILITIES],
    ['cline', CLINE_PROVIDER_CAPABILITIES],
    ['dsh', DSH_PROVIDER_CAPABILITIES],
    ['grok', GROK_PROVIDER_CAPABILITIES],
    ['vibe', VIBE_PROVIDER_CAPABILITIES],
    ['zcode', ZCODE_PROVIDER_CAPABILITIES],
    ['antigravity', ANTIGRAVITY_PROVIDER_CAPABILITIES],
    ['grok-bot', desktopCapabilities('grok-bot')],
    ['perplexity-chat', desktopCapabilities('perplexity-chat')],
  ])('%s offers no manual compact command', (_id, capabilities) => {
    expect(capabilities.compact).toBeUndefined();
  });
});
