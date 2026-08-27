import { TFile, TFolder, type Vault } from 'obsidian';

import { ProjectService } from '../../../../../src/core/intelligence/projects/ProjectService';

function createVault(): Vault {
  const files = new Map<string, string>();
  return {
    getAbstractFileByPath: (path: string) => {
      if (files.has(path)) {
        const file = new TFile();
        Object.assign(file, { path });
        return file;
      }
      return null;
    },
    getMarkdownFiles: () => Array.from(files.keys()).map(path => ({
      path,
      basename: path.split('/').pop()?.replace('.md', '') ?? '',
      stat: { mtime: Date.now() },
    })),
    cachedRead: async (file: { path: string }) => files.get(file.path) ?? '',
    create: async (path: string, content: string) => {
      files.set(path, content);
    },
    createFolder: async () => {},
  } as unknown as Vault;
}

describe('ProjectService', () => {
  it('creates and lists projects', async () => {
    const vault = createVault();
    const projects = new ProjectService(vault);

    await projects.createProject({
      name: 'Website Relaunch',
      description: 'New company website',
      instructions: 'Use Next.js and Tailwind.',
      memoryFolder: '.claudian/projects/website-relaunch',
      skills: ['frontend'],
      mcpServers: [],
    });

    const list = await projects.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Website Relaunch');

    const project = await projects.getProject('website-relaunch');
    expect(project).not.toBeNull();
    expect(project?.instructions).toContain('Next.js');
  });

  it('returns null when the project path resolves to a folder', async () => {
    const folder = new TFolder();
    Object.assign(folder, { path: '.claudian/projects/not-a-file.md' });
    const cachedRead = jest.fn().mockResolvedValue('name: should-not-be-read');
    const vault = {
      createFolder: jest.fn().mockResolvedValue(undefined),
      getAbstractFileByPath: jest.fn().mockReturnValue(folder),
      cachedRead,
    } as unknown as Vault;

    await expect(new ProjectService(vault).getProject('not-a-file')).resolves.toBeNull();
    expect(cachedRead).not.toHaveBeenCalled();
  });
});
