import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import { GROK_PROVIDER_ID } from '../settings';
import type { GrokAgentCatalog } from './GrokAgentCatalog';

/** Never let an explicit bot selection degrade into the CLI's default agent. */
export async function resolveGrokBotName(botName: string): Promise<string | null> {
  const wanted = botName.trim();
  if (!wanted) return null;

  // Avoid importing the workspace module: it pulls the settings UI into runtime.
  const services = ProviderWorkspaceRegistry.getServices(GROK_PROVIDER_ID) as
    | { agentCatalog?: GrokAgentCatalog }
    | null;
  const catalog = services?.agentCatalog;
  if (!catalog) {
    throw new Error('Der Grok-Bot-Katalog ist noch nicht bereit. Bitte erneut versuchen.');
  }

  await catalog.refresh();
  if (!catalog.isLoaded() || catalog.getLastError()) {
    throw new Error(catalog.getLastError() || 'Die Grok-Bot-Liste konnte nicht geladen werden.');
  }
  const resolved = catalog.resolveAgentName(wanted);
  if (!resolved) {
    throw new Error('Der ausgewählte Grok-Bot wurde nicht gefunden. Bitte die Bot-Auswahl aktualisieren.');
  }
  return resolved;
}
