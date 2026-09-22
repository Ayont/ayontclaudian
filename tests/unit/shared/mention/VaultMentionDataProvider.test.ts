import { TFile, TFolder } from 'obsidian';

import { VaultMentionDataProvider } from '@/shared/mention/VaultMentionDataProvider';

function createFile(path: string): TFile {
  const file = new (TFile as any)(path) as TFile;
  (file as any).stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };
  return file;
}

function createFolder(path: string): TFolder {
  return new (TFolder as any)(path) as TFolder;
}

describe('VaultMentionDataProvider', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns cached vault files and folders without reloading until dirty', () => {
    const files = [createFile('notes/a.md')];
    const folders = [createFolder('notes')];
    const app = {
      vault: {
        getFiles: jest.fn(() => files),
        getAllLoadedFiles: jest.fn(() => folders),
      },
    } as any;
    const provider = new VaultMentionDataProvider(app);

    expect(provider.getCachedVaultFiles()).toEqual(files);
    expect(provider.getCachedVaultFiles()).toEqual(files);
    expect(provider.getCachedVaultFolders()).toEqual([{ name: 'notes', path: 'notes' }]);
    expect(provider.getCachedVaultFolders()).toEqual([{ name: 'notes', path: 'notes' }]);

    expect(app.vault.getFiles).toHaveBeenCalledTimes(1);
    expect(app.vault.getAllLoadedFiles).toHaveBeenCalledTimes(1);

    provider.markFilesDirty();
    provider.markFoldersDirty();
    provider.getCachedVaultFiles();
    provider.getCachedVaultFolders();

    expect(app.vault.getFiles).toHaveBeenCalledTimes(2);
    expect(app.vault.getAllLoadedFiles).toHaveBeenCalledTimes(2);
  });

  it('initializes file and folder caches in background', () => {
    jest.useFakeTimers();
    const app = {
      vault: {
        getFiles: jest.fn(() => [createFile('notes/a.md')]),
        getAllLoadedFiles: jest.fn(() => [createFolder('notes')]),
      },
    } as any;
    const provider = new VaultMentionDataProvider(app);

    provider.initializeInBackground();

    expect(app.vault.getFiles).not.toHaveBeenCalled();
    expect(app.vault.getAllLoadedFiles).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();

    expect(app.vault.getFiles).toHaveBeenCalledTimes(1);
    expect(app.vault.getAllLoadedFiles).toHaveBeenCalledTimes(1);
  });

  it('does not rescan a cache read before its background warmup runs', () => {
    jest.useFakeTimers();
    const files = [createFile('notes/a.md')];
    const app = {
      vault: {
        getFiles: jest.fn(() => files),
        getAllLoadedFiles: jest.fn(() => [createFolder('notes')]),
      },
    } as any;
    const provider = new VaultMentionDataProvider(app);

    provider.initializeInBackground();
    expect(provider.getCachedVaultFiles()).toEqual(files);
    expect(provider.getCachedVaultFolders()).toEqual([{ name: 'notes', path: 'notes' }]);
    jest.runOnlyPendingTimers();

    expect(app.vault.getFiles).toHaveBeenCalledTimes(1);
    expect(app.vault.getAllLoadedFiles).toHaveBeenCalledTimes(1);
  });

  it('shares a successful scan across repeated background warmup requests', () => {
    jest.useFakeTimers();
    const app = {
      vault: {
        getFiles: jest.fn(() => []),
        getAllLoadedFiles: jest.fn(() => []),
      },
    } as any;
    const provider = new VaultMentionDataProvider(app);

    for (let i = 0; i < 10; i++) provider.initializeInBackground();
    jest.runOnlyPendingTimers();

    expect(app.vault.getFiles).toHaveBeenCalledTimes(1);
    expect(app.vault.getAllLoadedFiles).toHaveBeenCalledTimes(1);
  });

  it('refreshes invalidations between a foreground read and the queued warmup', () => {
    jest.useFakeTimers();
    const nextFile = createFile('new/b.md');
    const app = {
      vault: {
        getFiles: jest.fn().mockReturnValueOnce([]).mockReturnValue([nextFile]),
        getAllLoadedFiles: jest.fn().mockReturnValueOnce([]).mockReturnValue([createFolder('new')]),
      },
    } as any;
    const provider = new VaultMentionDataProvider(app);

    provider.initializeInBackground();
    expect(provider.getCachedVaultFiles()).toEqual([]);
    expect(provider.getCachedVaultFolders()).toEqual([]);
    provider.markFilesDirty();
    provider.markFoldersDirty();
    jest.runOnlyPendingTimers();

    expect(provider.getCachedVaultFiles()).toEqual([nextFile]);
    expect(provider.getCachedVaultFolders()).toEqual([{ name: 'new', path: 'new' }]);
    expect(app.vault.getFiles).toHaveBeenCalledTimes(2);
    expect(app.vault.getAllLoadedFiles).toHaveBeenCalledTimes(2);
  });

  it('retries failed foreground loads during the queued warmup', () => {
    jest.useFakeTimers();
    const file = createFile('notes/a.md');
    const fail = () => { throw new Error('Vault unavailable'); };
    const app = {
      vault: {
        getFiles: jest.fn().mockImplementationOnce(fail).mockReturnValue([file]),
        getAllLoadedFiles: jest.fn().mockImplementationOnce(fail).mockReturnValue([createFolder('notes')]),
      },
    } as any;
    const provider = new VaultMentionDataProvider(app);

    provider.initializeInBackground();
    expect(provider.getCachedVaultFiles()).toEqual([]);
    expect(provider.getCachedVaultFolders()).toEqual([]);
    jest.runOnlyPendingTimers();

    expect(provider.getCachedVaultFiles()).toEqual([file]);
    expect(provider.getCachedVaultFolders()).toEqual([{ name: 'notes', path: 'notes' }]);
    expect(app.vault.getFiles).toHaveBeenCalledTimes(2);
    expect(app.vault.getAllLoadedFiles).toHaveBeenCalledTimes(2);
  });

  it('reports file load errors only once while continuing to return an empty result', () => {
    const onFileLoadError = jest.fn();
    const app = {
      vault: {
        getFiles: jest.fn(() => {
          throw new Error('Vault unavailable');
        }),
        getAllLoadedFiles: jest.fn(() => []),
      },
    } as any;
    const provider = new VaultMentionDataProvider(app, { onFileLoadError });

    expect(provider.getCachedVaultFiles()).toEqual([]);
    expect(provider.getCachedVaultFiles()).toEqual([]);

    expect(app.vault.getFiles).toHaveBeenCalledTimes(2);
    expect(onFileLoadError).toHaveBeenCalledTimes(1);
  });
});
