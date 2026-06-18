import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { SharedVaultCommandCatalog } from '../../../core/providers/commands/SharedVaultCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { SkillStorage } from '../../claude/storage/SkillStorage';
import { SlashCommandStorage } from '../../claude/storage/SlashCommandStorage';
import { KimiCliResolver } from '../runtime/KimiCliResolver';
import { kimiSettingsTabRenderer } from '../ui/KimiSettingsTab';

/**
 * Native Kimi Code slash-commands surfaced in the "/" dropdown. These are not
 * persisted in the vault; they are passed through to the Kimi CLI as-is.
 */
const KIMI_STATIC_COMMANDS: ProviderCommandEntry[] = [
  {
    id: 'kimi:goal',
    providerId: 'kimi',
    kind: 'command',
    name: 'goal',
    description: 'Set a standing goal for this session',
    content: '/goal $ARGUMENTS',
    argumentHint: '[goal text]',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
  {
    id: 'kimi:skill',
    providerId: 'kimi',
    kind: 'command',
    name: 'skill',
    description: 'Invoke a Kimi skill (e.g. frontend-design)',
    content: '/skill:$ARGUMENTS',
    argumentHint: '[skill-name] [args]',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
  {
    id: 'kimi:plan',
    providerId: 'kimi',
    kind: 'command',
    name: 'plan',
    description: 'Enter plan mode',
    content: '/plan',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
  {
    id: 'kimi:swarm',
    providerId: 'kimi',
    kind: 'command',
    name: 'swarm',
    description: 'Start a Kimi agent swarm',
    content: '/swarm $ARGUMENTS',
    argumentHint: '[task]',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
  {
    id: 'kimi:model',
    providerId: 'kimi',
    kind: 'command',
    name: 'model',
    description: 'Switch model in Kimi CLI',
    content: '/model',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
  {
    id: 'kimi:sessions',
    providerId: 'kimi',
    kind: 'command',
    name: 'sessions',
    description: 'List or resume Kimi sessions',
    content: '/sessions',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
  {
    id: 'kimi:tasks',
    providerId: 'kimi',
    kind: 'command',
    name: 'tasks',
    description: 'Show background tasks',
    content: '/tasks',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
  {
    id: 'kimi:usage',
    providerId: 'kimi',
    kind: 'command',
    name: 'usage',
    description: 'Show token/quota usage',
    content: '/usage',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
  {
    id: 'kimi:status',
    providerId: 'kimi',
    kind: 'command',
    name: 'status',
    description: 'Show Kimi runtime status',
    content: '/status',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
  {
    id: 'kimi:compact',
    providerId: 'kimi',
    kind: 'command',
    name: 'compact',
    description: 'Compact the conversation context',
    content: '/compact',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
  {
    id: 'kimi:undo',
    providerId: 'kimi',
    kind: 'command',
    name: 'undo',
    description: 'Undo the last turn',
    content: '/undo',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
];

export type KimiWorkspaceServices = ProviderWorkspaceServices;

export async function createKimiWorkspaceServices(
  adapter: VaultFileAdapter,
): Promise<KimiWorkspaceServices> {
  return {
    cliResolver: new KimiCliResolver(),
    settingsTabRenderer: kimiSettingsTabRenderer,
    // Surfaces the shared vault commands/skills (.claude/commands, .claude/skills)
    // in the dropdown. Kimi users expect to trigger skills with "/" (matching
    // Kimi CLI's "/skill:<name>" convention), so skills use "/" here; the runtime
    // still expands a chosen entry client-side.
    commandCatalog: new SharedVaultCommandCatalog(
      'kimi',
      new SlashCommandStorage(adapter),
      new SkillStorage(adapter),
      { skillInsertPrefix: '/', staticEntries: KIMI_STATIC_COMMANDS },
    ),
  };
}

export const kimiWorkspaceRegistration: ProviderWorkspaceRegistration<KimiWorkspaceServices> = {
  initialize: async ({ vaultAdapter }) => createKimiWorkspaceServices(vaultAdapter),
};

export function maybeGetKimiWorkspaceServices(): KimiWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('kimi') as KimiWorkspaceServices | null;
}
