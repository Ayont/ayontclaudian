import type { TFile, Vault } from 'obsidian';

import { ProjectService } from '../../../../../src/core/intelligence/projects/ProjectService';

function createVault(): Vault {
  const files = new Map<string, string>();
  return {
    getAbstractFileByPath: (path: string) => {
      if (files.has(path)) {
        return { path } as TFile;
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
});
