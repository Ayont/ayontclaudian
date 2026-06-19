import type { ProviderConfigMap } from '../core/types/settings';
import { DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS } from './antigravity/settings';
import { DEFAULT_CLAUDE_PROVIDER_SETTINGS } from './claude/settings';
import { DEFAULT_CODEX_PROVIDER_SETTINGS } from './codex/settings';
import { DEFAULT_GROK_PROVIDER_SETTINGS } from './grok/settings';
import { DEFAULT_KIMI_PROVIDER_SETTINGS } from './kimi/settings';
import { DEFAULT_OPENCODE_PROVIDER_SETTINGS } from './opencode/settings';
import { DEFAULT_PI_PROVIDER_SETTINGS } from './pi/settings';
import { DEFAULT_VIBE_PROVIDER_SETTINGS } from './vibe/settings';

export function getBuiltInProviderDefaultConfigs(): ProviderConfigMap {
  return {
    claude: { ...DEFAULT_CLAUDE_PROVIDER_SETTINGS },
    codex: { ...DEFAULT_CODEX_PROVIDER_SETTINGS },
    opencode: { ...DEFAULT_OPENCODE_PROVIDER_SETTINGS },
    pi: { ...DEFAULT_PI_PROVIDER_SETTINGS },
    antigravity: { ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS },
    kimi: { ...DEFAULT_KIMI_PROVIDER_SETTINGS },
    vibe: { ...DEFAULT_VIBE_PROVIDER_SETTINGS },
    grok: { ...DEFAULT_GROK_PROVIDER_SETTINGS },
  };
}
