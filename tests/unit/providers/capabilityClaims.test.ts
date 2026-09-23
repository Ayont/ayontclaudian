import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from '@/providers/antigravity/capabilities';
import { CLINE_PROVIDER_CAPABILITIES } from '@/providers/cline/capabilities';
import { GROK_PROVIDER_CAPABILITIES } from '@/providers/grok/capabilities';
import { HERMES_PROVIDER_CAPABILITIES } from '@/providers/hermes/capabilities';
import { KIMI_PROVIDER_CAPABILITIES } from '@/providers/kimi/capabilities';
import { OMP_PROVIDER_CAPABILITIES } from '@/providers/omp/capabilities';
import { OPENCODE_PROVIDER_CAPABILITIES } from '@/providers/opencode/capabilities';
import { VIBE_PROVIDER_CAPABILITIES } from '@/providers/vibe/capabilities';
import { ZCODE_PROVIDER_CAPABILITIES } from '@/providers/zcode/capabilities';

// A shown control whose value the runtime ignores is worse than no control.
describe('capabilities that drive visible chat controls', () => {
  // `supportsMcpTools` shows the in-chat MCP selector. These runtimes only copy
  // `enabledMcpServers` into `mcpMentions` and never read it again; the ACP
  // runtimes get Claudian's always-on servers per session, which the per-turn
  // selector cannot change.
  it.each([
    ['cline', CLINE_PROVIDER_CAPABILITIES],
    ['grok', GROK_PROVIDER_CAPABILITIES],
    ['vibe', VIBE_PROVIDER_CAPABILITIES],
    ['zcode', ZCODE_PROVIDER_CAPABILITIES],
    ['kimi', KIMI_PROVIDER_CAPABILITIES],
    ['opencode', OPENCODE_PROVIDER_CAPABILITIES],
    ['omp', OMP_PROVIDER_CAPABILITIES],
    ['hermes', HERMES_PROVIDER_CAPABILITIES],
  ])('%s hides the MCP selector it cannot honor', (_id, capabilities) => {
    expect(capabilities.supportsMcpTools).toBe(false);
  });

  // ZCode talks to the Messages API directly and sends no tools, so a plan
  // posture changes nothing.
  it('zcode hides the plan toggle', () => {
    expect(ZCODE_PROVIDER_CAPABILITIES.supportsPlanMode).toBe(false);
  });

  // agy 1.2.7 changelog: headless `-p` runs "proceed through plan review
  // automatically", so a `--print` turn cannot be held at the plan.
  it('antigravity keeps plan mode off', () => {
    expect(ANTIGRAVITY_PROVIDER_CAPABILITIES.supportsPlanMode).toBe(false);
  });

  // `grok --help`: --permission-mode <default|acceptEdits|auto|dontAsk|bypassPermissions|plan>.
  it('grok keeps plan mode, now backed by --permission-mode plan', () => {
    expect(GROK_PROVIDER_CAPABILITIES.supportsPlanMode).toBe(true);
  });
});
