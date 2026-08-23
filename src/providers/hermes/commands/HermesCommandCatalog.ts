import type {
  ProviderCommandCatalog,
  ProviderCommandDropdownConfig,
} from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { SlashCommand } from '../../../core/types';
import { HERMES_PROVIDER_ID } from '../settings';

/**
 * Hermes owns its slash commands: they arrive over ACP as
 * `available_commands_update` and are executed inside the agent, so Claudian
 * only mirrors them into the dropdown.
 */
export class HermesCommandCatalog implements ProviderCommandCatalog {
  private runtimeCommands: SlashCommand[] = [];

  setRuntimeCommands(commands: SlashCommand[]): void {
    this.runtimeCommands = dedupeRuntimeCommands(commands);
  }

  async listDropdownEntries(_context: { includeBuiltIns: boolean }): Promise<ProviderCommandEntry[]> {
    return this.runtimeCommands.map(slashCommandToEntry);
  }

  async listVaultEntries(): Promise<ProviderCommandEntry[]> {
    return [];
  }

  async saveVaultEntry(_entry: ProviderCommandEntry): Promise<void> {
    throw new Error('Hermes-Laufzeitbefehle können in Claudian nicht bearbeitet werden.');
  }

  async deleteVaultEntry(_entry: ProviderCommandEntry): Promise<void> {
    throw new Error('Hermes-Laufzeitbefehle können in Claudian nicht gelöscht werden.');
  }

  getDropdownConfig(): ProviderCommandDropdownConfig {
    return {
      providerId: HERMES_PROVIDER_ID,
      triggerChars: ['/'],
      builtInPrefix: '/',
      skillPrefix: '/',
      commandPrefix: '/',
    };
  }

  async refresh(): Promise<void> {}
}

function slashCommandToEntry(command: SlashCommand): ProviderCommandEntry {
  return {
    id: command.id,
    providerId: HERMES_PROVIDER_ID,
    kind: 'command',
    name: command.name,
    description: command.description,
    content: command.content,
    argumentHint: command.argumentHint,
    allowedTools: command.allowedTools,
    model: command.model,
    disableModelInvocation: command.disableModelInvocation,
    userInvocable: command.userInvocable,
    context: command.context,
    agent: command.agent,
    hooks: command.hooks,
    scope: 'runtime',
    source: command.source ?? 'sdk',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  };
}

function dedupeRuntimeCommands(commands: SlashCommand[]): SlashCommand[] {
  const deduped: SlashCommand[] = [];
  const seen = new Set<string>();

  for (const command of commands) {
    const normalizedName = command.name.trim().replace(/^\/+/, '');
    if (!normalizedName) {
      continue;
    }

    const key = normalizedName.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({ ...command, name: normalizedName });
  }

  return deduped;
}
