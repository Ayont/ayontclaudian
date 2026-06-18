import type { TFile, Vault } from 'obsidian';

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
}

import { globalEventBus } from '../../events/EventBus';

export interface ClaudianProject {
  id: string;
  name: string;
  description: string;
  instructions: string;
  memoryFolder: string;
  skills: string[];
  mcpServers: string[];
  createdAt: number;
  updatedAt: number;
}

const PROJECTS_FOLDER = '.claudian/projects';

export class ProjectService {
  constructor(private readonly vault: Vault) {}

  async ensureProjectsFolder(): Promise<void> {
    const folder = normalizePath(PROJECTS_FOLDER);
    if (!this.vault.getAbstractFileByPath(folder)) {
      await this.vault.createFolder(folder).catch(() => {
        // May already exist.
      });
    }
  }

  async createProject(project: Omit<ClaudianProject, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    await this.ensureProjectsFolder();
    const id = project.name.toLowerCase().replace(/[^\w]+/g, '-');
    const now = Date.now();
    const full: ClaudianProject = { ...project, id, createdAt: now, updatedAt: now };
    const path = normalizePath(`${PROJECTS_FOLDER}/${id}.md`);

    const projectFolder = normalizePath(full.memoryFolder);
    if (!this.vault.getAbstractFileByPath(projectFolder)) {
      await this.vault.createFolder(projectFolder).catch(() => {
        // May already exist.
      });
    }

    await this.vault.create(path, this.serializeProject(full));
    globalEventBus.emit('project:switched', { projectId: id });
    return id;
  }

  async listProjects(): Promise<ClaudianProject[]> {
    await this.ensureProjectsFolder();
    const folder = normalizePath(PROJECTS_FOLDER);
    const files = this.vault.getMarkdownFiles().filter(file => file.path.startsWith(`${folder}/`));
    const projects: ClaudianProject[] = [];

    for (const file of files) {
      const raw = await this.vault.cachedRead(file).catch(() => '');
      projects.push(this.parseProject(file.basename, raw));
    }

    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getProject(id: string): Promise<ClaudianProject | null> {
    const path = normalizePath(`${PROJECTS_FOLDER}/${id}.md`);
    const file = this.vault.getAbstractFileByPath(path);
    if (!file) return null;
    const raw = await this.vault.cachedRead(file as TFile).catch(() => '');
    return this.parseProject(id, raw);
  }

  private serializeProject(project: ClaudianProject): string {
    return [
      '---',
      `name: ${project.name}`,
      `description: ${project.description}`,
      `memoryFolder: ${project.memoryFolder}`,
      `skills: ${project.skills.join(', ')}`,
      `mcpServers: ${project.mcpServers.join(', ')}`,
      `createdAt: ${project.createdAt}`,
      `updatedAt: ${project.updatedAt}`,
      '---',
      '',
      project.instructions,
    ].join('\n');
  }

  private parseProject(id: string, raw: string): ClaudianProject {
    const lines = raw.split('\n');
    let name = id;
    let description = '';
    const instructions = '';
    let memoryFolder = `${PROJECTS_FOLDER}/${id}`;
    let skills: string[] = [];
    let mcpServers: string[] = [];
    let createdAt = 0;
    let updatedAt = 0;
    let contentStart = 0;

    if (lines[0]?.trim() === '---') {
      const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
      if (end > 0) {
        for (let i = 1; i < end; i++) {
          const line = lines[i];
          const [key, value] = line.split(':').map(s => s.trim());
          switch (key) {
            case 'name': name = value; break;
            case 'description': description = value; break;
            case 'memoryFolder': memoryFolder = value; break;
            case 'skills': skills = value.split(',').map(s => s.trim()).filter(Boolean); break;
            case 'mcpServers': mcpServers = value.split(',').map(s => s.trim()).filter(Boolean); break;
            case 'createdAt': createdAt = parseInt(value, 10); break;
            case 'updatedAt': updatedAt = parseInt(value, 10); break;
          }
        }
        contentStart = end + 1;
      }
    }

    return {
      id,
      name,
      description,
      instructions: lines.slice(contentStart).join('\n').trim() || instructions,
      memoryFolder,
      skills,
      mcpServers,
      createdAt,
      updatedAt,
    };
  }
}
