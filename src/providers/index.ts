import { ProviderRegistry } from '../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../core/providers/ProviderWorkspaceRegistry';
import { antigravityWorkspaceRegistration } from './antigravity/app/AntigravityWorkspaceServices';
import { antigravityProviderRegistration } from './antigravity/registration';
import { claudeWorkspaceRegistration } from './claude/app/ClaudeWorkspaceServices';
import { claudeProviderRegistration } from './claude/registration';
import { codexWorkspaceRegistration } from './codex/app/CodexWorkspaceServices';
import { codexProviderRegistration } from './codex/registration';
import { kimiWorkspaceRegistration } from './kimi/app/KimiWorkspaceServices';
import { kimiProviderRegistration } from './kimi/registration';
import { opencodeWorkspaceRegistration } from './opencode/app/OpencodeWorkspaceServices';
import { opencodeProviderRegistration } from './opencode/registration';
import { piWorkspaceRegistration } from './pi/app/PiWorkspaceServices';
import { piProviderRegistration } from './pi/registration';
import { vibeWorkspaceRegistration } from './vibe/app/VibeWorkspaceServices';
import { vibeProviderRegistration } from './vibe/registration';

let builtInProvidersRegistered = false;

export function registerBuiltInProviders(): void {
  if (builtInProvidersRegistered) {
    return;
  }

  ProviderRegistry.register('claude', claudeProviderRegistration);
  ProviderRegistry.register('codex', codexProviderRegistration);
  ProviderRegistry.register('opencode', opencodeProviderRegistration);
  ProviderRegistry.register('pi', piProviderRegistration);
  ProviderRegistry.register('antigravity', antigravityProviderRegistration);
  ProviderRegistry.register('kimi', kimiProviderRegistration);
  ProviderRegistry.register('vibe', vibeProviderRegistration);
  ProviderWorkspaceRegistry.register('claude', claudeWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('codex', codexWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('opencode', opencodeWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('pi', piWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('antigravity', antigravityWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('kimi', kimiWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('vibe', vibeWorkspaceRegistration);
  builtInProvidersRegistered = true;
}

registerBuiltInProviders();
