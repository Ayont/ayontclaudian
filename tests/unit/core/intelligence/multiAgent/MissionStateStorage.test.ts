import {
  type MissionEvent,
  type MissionState,
  MissionStateStorage,
} from '../../../../../src/core/intelligence/multiAgent/MissionStateStorage';
import type { VaultFileAdapter } from '../../../../../src/core/storage/VaultFileAdapter';

function createMemoryAdapter(): VaultFileAdapter {
  const files = new Map<string, string>();
  const folders = new Set<string>();

  const ensureFolder = async (path: string): Promise<void> => {
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      folders.add(current);
    }
  };

  return {
    exists: async (path: string) => files.has(path) || folders.has(path),
    read: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    write: async (path: string, content: string) => {
      const folder = path.substring(0, path.lastIndexOf('/'));
      if (folder) await ensureFolder(folder);
      files.set(path, content);
    },
    append: async (path: string, content: string) => {
      const folder = path.substring(0, path.lastIndexOf('/'));
      if (folder) await ensureFolder(folder);
      files.set(path, (files.get(path) ?? '') + content);
    },
    delete: async (path: string) => {
      files.delete(path);
    },
    deleteFolder: async () => {},
    listFiles: async (folder: string) =>
      Array.from(files.keys()).filter((p) => p.startsWith(`${folder}/`)),
    listFolders: async () => [],
    listFilesRecursive: async (folder: string) =>
      Array.from(files.keys()).filter((p) => p.startsWith(`${folder}/`)),
    ensureFolder,
    rename: async () => {},
    stat: async () => null,
  } as unknown as VaultFileAdapter;
}

const sampleMission = (): MissionState => ({
  taskId: 'm-1',
  prompt: 'build a feature',
  agentIds: ['a', 'b'],
  status: 'running',
  overall: 50,
  agents: [
    { agentId: 'a', status: 'done', progress: 100, output: 'done-a' },
    { agentId: 'b', status: 'running', progress: 50 },
  ],
  createdAt: 1,
  updatedAt: 2,
});

describe('MissionStateStorage', () => {
  it('rejects a configured storage root outside .claudian/missions', () => {
    const adapter = createMemoryAdapter();

    expect(() => new MissionStateStorage(adapter, '../missions'))
      .toThrow('Ungültiger Missions-Speicherpfad');
    expect(() => new MissionStateStorage(adapter, '.claudian/missions/../outside'))
      .toThrow('Ungültiger Missions-Speicherpfad');
  });

  it('saves and loads a mission', async () => {
    const adapter = createMemoryAdapter();
    const storage = new MissionStateStorage(adapter);
    const mission = sampleMission();

    await storage.saveMission(mission);
    const loaded = await storage.loadMission('m-1');

    expect(loaded).toEqual(mission);
  });

  it('returns null for missing mission', async () => {
    const adapter = createMemoryAdapter();
    const storage = new MissionStateStorage(adapter);

    const loaded = await storage.loadMission('missing');
    expect(loaded).toBeNull();
  });

  it('rejects traversal and path-shaped mission ids before touching the adapter', async () => {
    const adapter = {
      exists: jest.fn(),
      read: jest.fn(),
      write: jest.fn(),
      append: jest.fn(),
      delete: jest.fn(),
    } as unknown as VaultFileAdapter;
    const storage = new MissionStateStorage(adapter);

    await expect(storage.saveMission({ ...sampleMission(), taskId: '../outside' }))
      .rejects.toThrow('Ungültige Missions-ID');
    await expect(storage.loadMission('folder/mission')).rejects.toThrow('Ungültige Missions-ID');
    await expect(storage.appendEvent('..\\outside', {
      ts: 1,
      type: 'started',
      message: 'started',
    })).rejects.toThrow('Ungültige Missions-ID');
    await expect(storage.deleteMission('/absolute')).rejects.toThrow('Ungültige Missions-ID');
    await expect(storage.flushMission('')).rejects.toThrow('Ungültige Missions-ID');

    expect(adapter.exists).not.toHaveBeenCalled();
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.append).not.toHaveBeenCalled();
    expect(adapter.delete).not.toHaveBeenCalled();
  });

  it('lists missions sorted by updatedAt desc', async () => {
    const adapter = createMemoryAdapter();
    const storage = new MissionStateStorage(adapter);

    await storage.saveMission({ ...sampleMission(), taskId: 'm-old', updatedAt: 1 });
    await storage.saveMission({ ...sampleMission(), taskId: 'm-new', updatedAt: 3 });

    const list = await storage.listMissions();
    expect(list.map((m) => m.taskId)).toEqual(['m-new', 'm-old']);
  });

  it('ignores listed files that are not direct mission children', async () => {
    const safeMission = { ...sampleMission(), taskId: 'safe-mission' };
    const adapter = {
      listFiles: jest.fn().mockResolvedValue([
        '.claudian/missions/safe-mission.json',
        '.claudian/missions/../outside.json',
        'other/rogue.json',
      ]),
      exists: jest.fn().mockResolvedValue(true),
      read: jest.fn(async (path: string) => {
        if (path === '.claudian/missions/safe-mission.json') return JSON.stringify(safeMission);
        throw new Error(`unexpected read: ${path}`);
      }),
    } as unknown as VaultFileAdapter;
    const storage = new MissionStateStorage(adapter);

    await expect(storage.listMissions()).resolves.toEqual([safeMission]);
    expect(adapter.read).toHaveBeenCalledTimes(1);
    expect(adapter.read).toHaveBeenCalledWith('.claudian/missions/safe-mission.json');
  });

  it('deletes a mission', async () => {
    const adapter = createMemoryAdapter();
    const storage = new MissionStateStorage(adapter);

    await storage.saveMission(sampleMission());
    await storage.deleteMission('m-1');

    expect(await storage.loadMission('m-1')).toBeNull();
  });

  it('appends and loads events as JSONL', async () => {
    const adapter = createMemoryAdapter();
    const storage = new MissionStateStorage(adapter);

    const event1: MissionEvent = { ts: 1, type: 'started', message: 'Mission started' };
    const event2: MissionEvent = { ts: 2, type: 'agent-done', agentId: 'a', message: 'Agent a done' };

    await storage.appendEvent('m-1', event1);
    await storage.appendEvent('m-1', event2);

    const events = await storage.loadEvents('m-1');
    expect(events).toEqual([event1, event2]);
  });

  it('returns empty events for missing log', async () => {
    const adapter = createMemoryAdapter();
    const storage = new MissionStateStorage(adapter);

    const events = await storage.loadEvents('missing');
    expect(events).toEqual([]);
  });

  it('ignores corrupt event lines', async () => {
    const adapter = createMemoryAdapter();
    const storage = new MissionStateStorage(adapter);

    const event = { ts: 1, type: 'started', message: 'ok' } as MissionEvent;
    await storage.appendEvent('m-1', event);
    await adapter.append(`${storage['basePath']}/m-1.events.jsonl`, 'not-json\n');

    const events = await storage.loadEvents('m-1');
    expect(events).toEqual([event]);
  });

  it('serializes mission writes and coalesces queued snapshots to the newest state', async () => {
    const files = new Map<string, string>();
    const pendingWrites: Array<() => void> = [];
    const writtenStates: MissionState[] = [];
    const adapter = {
      exists: async (path: string) => files.has(path),
      read: async (path: string) => files.get(path) ?? '',
      write: jest.fn(async (path: string, content: string) => {
        writtenStates.push(JSON.parse(content) as MissionState);
        await new Promise<void>((resolve) => pendingWrites.push(() => {
          files.set(path, content);
          resolve();
        }));
      }),
      append: async () => {},
      delete: async () => {},
      listFiles: async () => [],
    } as unknown as VaultFileAdapter;
    const storage = new MissionStateStorage(adapter);

    const firstSave = storage.saveMission(sampleMission());
    await Promise.resolve();
    expect(adapter.write).toHaveBeenCalledTimes(1);

    const intermediateSave = storage.saveMission({
      ...sampleMission(),
      overall: 80,
      updatedAt: 3,
    });
    const completedSave = storage.saveMission({
      ...sampleMission(),
      status: 'completed',
      overall: 100,
      updatedAt: 4,
      completedAt: 4,
    });

    expect(adapter.write).toHaveBeenCalledTimes(1);
    pendingWrites.shift()?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.write).toHaveBeenCalledTimes(2);
    expect(writtenStates.map((state) => state.updatedAt)).toEqual([2, 4]);
    pendingWrites.shift()?.();
    await Promise.all([firstSave, intermediateSave, completedSave]);

    expect(JSON.parse(files.get('.claudian/missions/m-1.json') ?? '{}')).toMatchObject({
      status: 'completed',
      overall: 100,
      updatedAt: 4,
    });
  });

  it('flushMission waits for both the latest state and ordered event writes', async () => {
    const stateGate: { release?: () => void } = {};
    const eventGate: { release?: () => void } = {};
    const adapter = {
      write: async () => new Promise<void>((resolve) => { stateGate.release = resolve; }),
      append: async () => new Promise<void>((resolve) => { eventGate.release = resolve; }),
    } as unknown as VaultFileAdapter;
    const storage = new MissionStateStorage(adapter);

    void storage.saveMission(sampleMission());
    void storage.appendEvent('m-1', { ts: 1, type: 'started', message: 'started' });
    const flush = storage.flushMission('m-1');
    let settled = false;
    void flush.then(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);
    stateGate.release?.();
    await Promise.resolve();
    expect(settled).toBe(false);
    eventGate.release?.();
    await flush;
    expect(settled).toBe(true);
  });

  it('appends events serially so a slower first append cannot reorder the log', async () => {
    const releases: Array<() => void> = [];
    const appended: string[] = [];
    const adapter = {
      append: jest.fn(async (_path: string, content: string) => {
        await new Promise<void>((resolve) => releases.push(resolve));
        appended.push(content);
      }),
    } as unknown as VaultFileAdapter;
    const storage = new MissionStateStorage(adapter);

    const first = storage.appendEvent('m-1', { ts: 1, type: 'started', message: 'first' });
    const second = storage.appendEvent('m-1', { ts: 2, type: 'completed', message: 'second' });
    await Promise.resolve();
    expect(adapter.append).toHaveBeenCalledTimes(1);

    releases.shift()?.();
    await first;
    await Promise.resolve();
    expect(adapter.append).toHaveBeenCalledTimes(2);
    releases.shift()?.();
    await second;

    expect(appended.map((line) => JSON.parse(line).message)).toEqual(['first', 'second']);
  });

  it('surfaces a missing event write at flush while keeping event reads tolerant', async () => {
    const writeError = new Error('Event-Log nicht schreibbar');
    const adapter = {
      append: jest.fn().mockRejectedValue(writeError),
      exists: jest.fn().mockRejectedValue(new Error('Lesefehler')),
      read: jest.fn(),
    } as unknown as VaultFileAdapter;
    const storage = new MissionStateStorage(adapter);

    await expect(storage.appendEvent('m-1', {
      ts: 1,
      type: 'started',
      message: 'started',
    })).resolves.toBeUndefined();

    await expect(storage.flushMission('m-1')).rejects.toThrow('Event-Log nicht schreibbar');
    await expect(storage.loadEvents('m-1')).resolves.toEqual([]);
  });
});
