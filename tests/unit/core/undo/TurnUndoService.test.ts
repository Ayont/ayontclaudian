import { TurnUndoService } from '@/core/undo/TurnUndoService';

describe('TurnUndoService', () => {
  it('persists only changed files and reverts the latest turn', async () => {
    const data = new Map<string, string>([['note.md', 'before']]);
    const dirs = new Set<string>();
    const files: any[] = [{ path: 'note.md', extension: 'md', stat: { size: 6 } }];
    const adapter = {
      exists: jest.fn(async (path: string) => data.has(path) || dirs.has(path)),
      mkdir: jest.fn(async (path: string) => { dirs.add(path); }),
      write: jest.fn(async (path: string, value: string) => { data.set(path, value); }),
      read: jest.fn(async (path: string) => {
        const value = data.get(path);
        if (value === undefined) throw new Error('missing');
        return value;
      }),
      remove: jest.fn(async (path: string) => {
        data.delete(path);
        const index = files.findIndex((file) => file.path === path);
        if (index >= 0) files.splice(index, 1);
      }),
      rmdir: jest.fn(async () => undefined),
      list: jest.fn(async (path: string) => {
        if (path === '.claudian/undo') {
          return { files: [], folders: [...dirs].filter((dir) => /^\.claudian\/undo\/[^/]+$/.test(dir)) };
        }
        return {
          files: [...data.keys()].filter((file) => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes('/')),
          folders: [...dirs].filter((dir) => dir.startsWith(`${path}/`) && !dir.slice(path.length + 1).includes('/')),
        };
      }),
    };
    const vault = {
      adapter,
      getFiles: () => files,
      cachedRead: async (file: any) => data.get(file.path) ?? '',
    } as any;
    const service = new TurnUndoService(vault);

    const id = await service.begin('conv', 'change files');
    data.set('note.md', 'after');
    data.set('new.md', 'created');
    files.push({ path: 'new.md', extension: 'md', stat: { size: 7 } });
    const manifest = await service.finish(id);

    expect(manifest?.changes.map((change) => change.kind).sort()).toEqual(['created', 'modified']);
    const reverted = await service.revertLatest('conv');
    expect(reverted?.id).toBe(id);
    expect(data.get('note.md')).toBe('before');
    expect(data.has('new.md')).toBe(false);
  });
});
