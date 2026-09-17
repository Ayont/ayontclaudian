import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import {
  OMP_AGENT_PATH,
  OMP_AGENTS_PATH,
  OmpAgentStorage,
} from '@/providers/omp/storage/OmpAgentStorage';
import type { OmpAgentDefinition } from '@/providers/omp/types/agent';

/**
 * Oh My Pi discovers project task agents in `./.omp/agents` — verified against
 * the shipped binary: `omp agents --help` (v18.2.3) prints
 * `--project  Write to ./.omp/agents`. The singular `.omp/agent` is OMP's state
 * directory (agent.db, config.yml, sessions/), so an agent written there is
 * invisible to the `task` tool even though Claudian's own list still shows it.
 */
describe('OmpAgentStorage', () => {
  function createAdapter() {
    const files: Record<string, string> = {};
    const adapter = {
      exists: jest.fn(async (p: string) => p in files),
      read: jest.fn(async (p: string) => files[p] ?? ''),
      write: jest.fn(async (p: string, content: string) => { files[p] = content; }),
      delete: jest.fn(async (p: string) => { delete files[p]; }),
      listFilesRecursive: jest.fn(async () => Object.keys(files)),
      ensureFolder: jest.fn(async () => {}),
    } as unknown as jest.Mocked<Pick<VaultFileAdapter,
      'exists' | 'read' | 'write' | 'delete' | 'listFilesRecursive' | 'ensureFolder'>>;
    return { adapter, files };
  }

  const agent = (name: string): OmpAgentDefinition => ({
    name,
    description: 'Scouts the codebase',
    prompt: 'You are a scout.',
  } as OmpAgentDefinition);

  it('saves a new agent where omp actually looks for project agents', async () => {
    const { adapter } = createAdapter();
    const storage = new OmpAgentStorage(adapter);

    await storage.save(agent('scout'));

    expect(adapter.write).toHaveBeenCalledWith(
      `${OMP_AGENTS_PATH}/scout.md`,
      expect.any(String),
    );
  });

  it('never writes into .omp/agent, which is omp state, not agent definitions', async () => {
    const { adapter } = createAdapter();
    const storage = new OmpAgentStorage(adapter);

    await storage.save(agent('scout'));

    const written = adapter.write.mock.calls.map((call) => call[0]);
    expect(written.some((p) => p.startsWith(`${OMP_AGENT_PATH}/`))).toBe(false);
  });

  it('renaming an agent keeps it inside the discoverable directory', async () => {
    const { adapter, files } = createAdapter();
    files[`${OMP_AGENTS_PATH}/scout.md`] = '---\nname: scout\n---\nYou are a scout.';
    const storage = new OmpAgentStorage(adapter);

    await storage.save(agent('ranger'), agent('scout'));

    expect(adapter.write).toHaveBeenCalledWith(
      `${OMP_AGENTS_PATH}/ranger.md`,
      expect.any(String),
    );
    const written = adapter.write.mock.calls.map((call) => call[0]);
    expect(written.some((p) => p.startsWith(`${OMP_AGENT_PATH}/`))).toBe(false);
  });
});
