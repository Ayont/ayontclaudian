import type { SlashCommand } from '../../types';
import type { ProviderId } from '../types';
import type {
  ProviderCommandCatalog,
  ProviderCommandDropdownConfig,
} from './ProviderCommandCatalog';
import type { ProviderCommandEntry } from './ProviderCommandEntry';

/**
 * Minimal storage surface the shared catalog needs. Satisfied by the Claude
 * vault stores (`SlashCommandStorage` / `SkillStorage`), which read and write
 * `.claude/commands` and `.claude/skills`. Reusing them means a command or
 * skill defined once is available to every provider that mounts this catalog.
 */
export interface VaultCommandEntryStore {
  loadAll(): Promise<SlashCommand[]>;
  save(command: SlashCommand): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * Vault-backed command/skill catalog for print-mode CLIs that cannot expand
 * commands natively (Kimi, Antigravity). Surfaces the shared vault commands and
 * skills in the `/` + `$` dropdown; the runtimes expand a chosen entry
 * client-side via {@link expandProviderCommandInput} before sending the prompt.
 */
export interface SharedVaultCommandCatalogOptions {
  /** Prefix used when inserting a skill (default "$"). Set to "/" for providers like Kimi whose users expect slash-triggered skills. */
  skillInsertPrefix?: string;
  /** Provider-owned commands merged into the dropdown but not persisted in the vault (e.g. Kimi's native slash-commands). */
  staticEntries?: ProviderCommandEntry[];
}

export class SharedVaultCommandCatalog implements ProviderCommandCatalog {
  private readonly skillInsertPrefix: string;
  private readonly staticEntries: ProviderCommandEntry[];

  constructor(
    private readonly providerId: ProviderId,
    private readonly commandStorage: VaultCommandEntryStore,
    private readonly skillStorage: VaultCommandEntryStore,
    options: SharedVaultCommandCatalogOptions = {},
  ) {
    this.skillInsertPrefix = options.skillInsertPrefix ?? '$';
    this.staticEntries = options.staticEntries ?? [];
  }

  private commandToEntry(command: SlashCommand, kind: 'command' | 'skill'): ProviderCommandEntry {
    const prefix = kind === 'skill' ? this.skillInsertPrefix : '/';
    return {
      id: command.id,
      providerId: this.providerId,
      kind,
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
      scope: 'vault',
      source: command.source ?? 'user',
      isEditable: true,
      isDeletable: true,
      displayPrefix: prefix,
      insertPrefix: prefix,
    };
  }

  private entryToCommand(entry: ProviderCommandEntry): SlashCommand {
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      content: entry.content,
      argumentHint: entry.argumentHint,
      allowedTools: entry.allowedTools,
      model: entry.model,
      disableModelInvocation: entry.disableModelInvocation,
      userInvocable: entry.userInvocable,
      context: entry.context,
      agent: entry.agent,
      hooks: entry.hooks,
      source: entry.source,
      kind: entry.kind,
    };
  }

  setRuntimeCommands(_commands: SlashCommand[]): void {
    // No native runtime command stream for these CLIs; entries come from the vault.
  }

  async listDropdownEntries(_context: { includeBuiltIns: boolean }): Promise<ProviderCommandEntry[]> {
    return this.listVaultEntries();
  }

  async listVaultEntries(): Promise<ProviderCommandEntry[]> {
    const [commands, skills] = await Promise.all([
      this.commandStorage.loadAll(),
      this.skillStorage.loadAll(),
    ]);
    return [
      ...this.staticEntries,
      ...commands.map((command) => this.commandToEntry(command, 'command')),
      ...skills.map((skill) => this.commandToEntry(skill, 'skill')),
    ];
  }

  async saveVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    const command = this.entryToCommand(entry);
    if (entry.kind === 'skill') {
      await this.skillStorage.save(command);
    } else {
      await this.commandStorage.save(command);
    }
  }

  async deleteVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    if (entry.kind === 'skill') {
      await this.skillStorage.delete(entry.id);
    } else {
      await this.commandStorage.delete(entry.id);
    }
  }

  getDropdownConfig(): ProviderCommandDropdownConfig {
    return {
      providerId: this.providerId,
      triggerChars: ['/', '$'],
      builtInPrefix: '/',
      skillPrefix: this.skillInsertPrefix,
      commandPrefix: '/',
    };
  }

  async refresh(): Promise<void> {
    // Entries are read fresh from the vault on each list; nothing to invalidate.
  }
}
