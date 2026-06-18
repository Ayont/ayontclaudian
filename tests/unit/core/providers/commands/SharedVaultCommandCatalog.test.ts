import {
  SharedVaultCommandCatalog,
  type VaultCommandEntryStore,
} from '@/core/providers/commands/SharedVaultCommandCatalog';
import type { SlashCommand } from '@/core/types';

function makeStore(initial: SlashCommand[] = []): VaultCommandEntryStore & {
  saved: SlashCommand[];
  deleted: string[];
} {
  return {
    saved: [],
    deleted: [],
    loadAll: jest.fn().mockResolvedValue(initial),
    async save(cmd: SlashCommand) {
      this.saved.push(cmd);
    },
    async delete(id: string) {
      this.deleted.push(id);
    },
  };
}

function cmd(name: string): SlashCommand {
  return { id: `cmd-${name}`, name, content: `do ${name}` };
}

describe('SharedVaultCommandCatalog', () => {
  it('maps commands to "/" entries and skills to "$" entries', async () => {
    const commandStore = makeStore([cmd('review')]);
    const skillStore = makeStore([cmd('pirate')]);
    const catalog = new SharedVaultCommandCatalog('kimi', commandStore, skillStore);

    const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

    expect(entries).toHaveLength(2);
    const command = entries.find((e) => e.name === 'review');
    const skill = entries.find((e) => e.name === 'pirate');
    expect(command).toMatchObject({ kind: 'command', insertPrefix: '/', providerId: 'kimi' });
    expect(skill).toMatchObject({ kind: 'skill', insertPrefix: '$', providerId: 'kimi' });
  });

  it('routes saveVaultEntry to the matching store by kind', async () => {
    const commandStore = makeStore();
    const skillStore = makeStore();
    const catalog = new SharedVaultCommandCatalog('antigravity', commandStore, skillStore);

    await catalog.saveVaultEntry({
      id: 's1', providerId: 'antigravity', kind: 'skill', name: 'pirate', content: 'arr',
      scope: 'vault', source: 'user', isEditable: true, isDeletable: true,
      displayPrefix: '$', insertPrefix: '$',
    });

    expect(skillStore.saved.map((c) => c.name)).toEqual(['pirate']);
    expect(commandStore.saved).toHaveLength(0);
  });

  it('routes deleteVaultEntry to the matching store by kind', async () => {
    const commandStore = makeStore();
    const skillStore = makeStore();
    const catalog = new SharedVaultCommandCatalog('antigravity', commandStore, skillStore);

    await catalog.deleteVaultEntry({
      id: 'c1', providerId: 'antigravity', kind: 'command', name: 'review', content: 'x',
      scope: 'vault', source: 'user', isEditable: true, isDeletable: true,
      displayPrefix: '/', insertPrefix: '/',
    });

    expect(commandStore.deleted).toEqual(['c1']);
    expect(skillStore.deleted).toHaveLength(0);
  });

  it('exposes a dropdown config triggering on / and $', () => {
    const catalog = new SharedVaultCommandCatalog('kimi', makeStore(), makeStore());
    expect(catalog.getDropdownConfig()).toMatchObject({
      providerId: 'kimi',
      triggerChars: ['/', '$'],
      skillPrefix: '$',
      commandPrefix: '/',
    });
  });

  it('can expose skills with a custom insert prefix (e.g. "/" for Kimi)', async () => {
    const commandStore = makeStore([cmd('review')]);
    const skillStore = makeStore([cmd('pirate')]);
    const catalog = new SharedVaultCommandCatalog('kimi', commandStore, skillStore, {
      skillInsertPrefix: '/',
    });

    const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

    const skill = entries.find((e) => e.name === 'pirate');
    expect(skill).toMatchObject({
      kind: 'skill',
      displayPrefix: '/',
      insertPrefix: '/',
      providerId: 'kimi',
    });
    expect(catalog.getDropdownConfig()).toMatchObject({
      skillPrefix: '/',
      triggerChars: ['/', '$'],
    });
  });

  it('merges provider-static entries with vault entries', async () => {
    const catalog = new SharedVaultCommandCatalog('kimi', makeStore(), makeStore(), {
      staticEntries: [
        {
          id: 'kimi:goal',
          providerId: 'kimi',
          kind: 'command',
          name: 'goal',
          description: 'Set a standing goal',
          content: '/goal $ARGUMENTS',
          scope: 'builtin',
          source: 'builtin',
          isEditable: false,
          isDeletable: false,
          displayPrefix: '/',
          insertPrefix: '/',
        },
      ],
    });

    const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
    expect(entries.some((e) => e.name === 'goal' && e.scope === 'builtin')).toBe(true);
  });
});
