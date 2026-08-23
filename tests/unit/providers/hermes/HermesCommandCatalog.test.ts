import { HermesCommandCatalog } from '@/providers/hermes/commands/HermesCommandCatalog';

describe('HermesCommandCatalog', () => {
  it('exposes the ACP-reported commands as read-only runtime entries', async () => {
    const catalog = new HermesCommandCatalog();
    catalog.setRuntimeCommands([
      { content: '', description: 'Compress conversation context', id: 'acp:compress', name: 'compress' },
      { argumentHint: 'model name', content: '', id: 'acp:model', name: '/model' },
    ]);

    const entries = await catalog.listDropdownEntries({ includeBuiltIns: true });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      isDeletable: false,
      isEditable: false,
      kind: 'command',
      name: 'compress',
      providerId: 'hermes',
      scope: 'runtime',
    });
    // A leading slash from the wire is stripped so the dropdown adds its own.
    expect(entries[1].name).toBe('model');
    expect(entries[1].argumentHint).toBe('model name');
  });

  it('drops duplicates case-insensitively and keeps the first entry', async () => {
    const catalog = new HermesCommandCatalog();
    catalog.setRuntimeCommands([
      { content: '', description: 'first', id: 'a', name: 'help' },
      { content: '', description: 'second', id: 'b', name: 'HELP' },
      { content: '', id: 'c', name: '  ' },
    ]);

    const entries = await catalog.listDropdownEntries({ includeBuiltIns: true });

    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe('first');
  });

  it('owns no vault entries and refuses local edits', async () => {
    const catalog = new HermesCommandCatalog();

    await expect(catalog.listVaultEntries()).resolves.toEqual([]);
    await expect(catalog.saveVaultEntry({} as never)).rejects.toThrow(/nicht bearbeitet/);
    await expect(catalog.deleteVaultEntry({} as never)).rejects.toThrow(/nicht gelöscht/);
  });

  it('uses a single slash trigger', () => {
    expect(new HermesCommandCatalog().getDropdownConfig()).toEqual({
      builtInPrefix: '/',
      commandPrefix: '/',
      providerId: 'hermes',
      skillPrefix: '/',
      triggerChars: ['/'],
    });
  });
});
