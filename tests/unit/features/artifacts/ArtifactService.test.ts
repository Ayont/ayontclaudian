import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import { ArtifactService } from '@/features/artifacts/ArtifactService';

function artifactFile(path: string, stat: { ctime: number; mtime: number } = { ctime: 10, mtime: 20 }): TFile {
  const file = new TFile();
  const name = path.split('/').pop() ?? '';
  Object.assign(file, {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    extension: name.split('.').pop() ?? '',
    stat: { ...stat, size: 0 },
  });
  return file;
}

function artifactFolder(path: string): TFolder {
  const folder = new TFolder();
  Object.assign(folder, { path, name: path.split('/').pop() ?? '', children: [] });
  return folder;
}

describe('ArtifactService', () => {
  it('marks generated artifact documents as German', () => {
    const service = new ArtifactService({} as App);

    expect(service.wrapHtml('<p>Inhalt</p>', 'Status', '📊')).toContain('<html lang="de">');
  });

  describe('createArtifact', () => {
    it('embeds the incremented version when an artifact is republished', async () => {
      const file = artifactFile('.claudian/artifacts/release-notes.html');
      const folder = artifactFolder('.claudian/artifacts');
      const modify = jest.fn().mockResolvedValue(undefined);
      const app = {
        vault: {
          getAbstractFileByPath: jest.fn((path: string) => (
            path === folder.path ? folder : path === file.path ? file : null
          )),
          read: jest.fn().mockResolvedValue('<body data-version="4"></body>'),
          modify,
          create: jest.fn(),
          createFolder: jest.fn(),
        },
      } as unknown as App;

      const artifact = await new ArtifactService(app).createArtifact({
        title: 'Release Notes',
        kind: 'dashboard',
        html: '<p>Aktuell</p>',
      });

      expect(artifact.version).toBe(5);
      expect(modify).toHaveBeenCalledWith(
        file,
        expect.stringContaining('data-version="5"'),
      );
      expect(modify.mock.calls[0][1]).toContain('<span class="artifact-version">v5</span>');
    });

    it('does not overwrite an existing artifact when its version cannot be read', async () => {
      const file = artifactFile('.claudian/artifacts/release-notes.html');
      const folder = artifactFolder('.claudian/artifacts');
      const modify = jest.fn();
      const app = {
        vault: {
          getAbstractFileByPath: jest.fn((path: string) => (
            path === folder.path ? folder : path === file.path ? file : null
          )),
          read: jest.fn().mockRejectedValue(new Error('Lesefehler')),
          modify,
          create: jest.fn(),
          createFolder: jest.fn(),
        },
      } as unknown as App;

      await expect(new ArtifactService(app).createArtifact({
        title: 'Release Notes',
        html: '<p>Neu</p>',
      })).rejects.toThrow('Bestehendes Artifact konnte nicht gelesen werden');
      expect(modify).not.toHaveBeenCalled();
    });
  });

  describe('persisted metadata', () => {
    it('restores the artifact kind when the gallery is reloaded', async () => {
      const folder = artifactFolder('.claudian/artifacts');
      const files = new Map<string, TFile | TFolder>([[folder.path, folder]]);
      const content = new Map<string, string>();
      const app = {
        vault: {
          getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
          read: jest.fn(async (file: TFile) => content.get(file.path) ?? ''),
          modify: jest.fn(async (file: TFile, html: string) => {
            content.set(file.path, html);
          }),
          create: jest.fn(async (path: string, html: string) => {
            const file = artifactFile(path);
            files.set(path, file);
            folder.children.push(file);
            content.set(path, html);
            return file;
          }),
          createFolder: jest.fn(),
        },
      } as unknown as App;
      const service = new ArtifactService(app);

      await service.createArtifact({
        title: 'Incident Verlauf',
        kind: 'timeline',
        html: '<p>Analyse</p>',
      });

      await expect(service.listArtifacts()).resolves.toEqual([
        expect.objectContaining({
          title: 'Incident Verlauf',
          kind: 'timeline',
        }),
      ]);
      expect(content.get('.claudian/artifacts/incident-verlauf.html')).toContain('data-kind="timeline"');
    });

    it('keeps readable artifacts visible when one file cannot be read', async () => {
      const folder = artifactFolder('.claudian/artifacts');
      const broken = artifactFile('.claudian/artifacts/kaputt.html', { ctime: 1, mtime: 30 });
      const healthy = artifactFile('.claudian/artifacts/gesund.html', { ctime: 2, mtime: 20 });
      folder.children.push(broken, healthy);
      const app = {
        vault: {
          getAbstractFileByPath: jest.fn().mockReturnValue(folder),
          read: jest.fn(async (file: TFile) => {
            if (file === broken) throw new Error('Datei beschädigt');
            return '<body data-title="Gesundes Artifact" data-kind="dashboard" data-version="2"></body>';
          }),
        },
      } as unknown as App;

      await expect(new ArtifactService(app).listArtifacts()).resolves.toEqual([
        expect.objectContaining({
          id: 'gesund',
          title: 'Gesundes Artifact',
          kind: 'dashboard',
          version: 2,
        }),
      ]);
    });

    it('skips malformed artifact content while retaining valid HTML', async () => {
      const folder = artifactFolder('.claudian/artifacts');
      const malformed = artifactFile('.claudian/artifacts/kaputt.html');
      const healthy = artifactFile('.claudian/artifacts/gesund.html');
      folder.children.push(malformed, healthy);
      const app = {
        vault: {
          getAbstractFileByPath: jest.fn().mockReturnValue(folder),
          read: jest.fn(async (file: TFile) => (
            file === malformed
              ? 'kein HTML-Dokument'
              : '<body data-title="Gesund" data-kind="custom"></body>'
          )),
        },
      } as unknown as App;

      await expect(new ArtifactService(app).listArtifacts()).resolves.toEqual([
        expect.objectContaining({ id: 'gesund', title: 'Gesund' }),
      ]);
    });

    it('reports a meaningful load failure when every artifact file is unreadable', async () => {
      const folder = artifactFolder('.claudian/artifacts');
      folder.children.push(
        artifactFile('.claudian/artifacts/eins.html'),
        artifactFile('.claudian/artifacts/zwei.html'),
      );
      const app = {
        vault: {
          getAbstractFileByPath: jest.fn().mockReturnValue(folder),
          read: jest.fn().mockRejectedValue(new Error('Datei beschädigt')),
        },
      } as unknown as App;

      await expect(new ArtifactService(app).listArtifacts())
        .rejects.toThrow('Keine der 2 Artifact-Dateien konnte gelesen werden');
    });
  });

  describe('recoverable deletion', () => {
    it('moves an artifact to the Obsidian trash and can restore its exact content', async () => {
      const folder = artifactFolder('.claudian/artifacts');
      const file = artifactFile('.claudian/artifacts/analyse.html');
      const html = '<body data-version="3" data-kind="dashboard">Inhalt</body>';
      const files = new Map<string, TFile | TFolder>([
        [folder.path, folder],
        [file.path, file],
      ]);
      folder.children.push(file);
      const trashFile = jest.fn(async (trashedFile: TFile) => {
        files.delete(trashedFile.path);
        folder.children = folder.children.filter((child) => child !== trashedFile);
      });
      const create = jest.fn(async (path: string, restoredHtml: string) => {
        const restoredFile = artifactFile(path);
        files.set(path, restoredFile);
        folder.children.push(restoredFile);
        expect(restoredHtml).toBe(html);
        return restoredFile;
      });
      const permanentDelete = jest.fn();
      const app = {
        fileManager: { trashFile },
        vault: {
          getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
          read: jest.fn().mockResolvedValue(html),
          delete: permanentDelete,
          create,
          createFolder: jest.fn(),
        },
      } as unknown as App;
      const service = new ArtifactService(app);

      const deletion = await service.deleteArtifact(file.path);
      await service.restoreArtifact(deletion);

      expect(trashFile).toHaveBeenCalledWith(file);
      expect(permanentDelete).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledWith(file.path, html);
    });

    it('reports a missing artifact instead of silently succeeding', async () => {
      const trashFile = jest.fn();
      const app = {
        fileManager: { trashFile },
        vault: {
          getAbstractFileByPath: jest.fn().mockReturnValue(null),
        },
      } as unknown as App;

      const missingPath = '.claudian/artifacts/nicht-da.html';
      await expect(new ArtifactService(app).deleteArtifact(missingPath))
        .rejects.toThrow(`Artifact nicht gefunden: ${missingPath}`);
      expect(trashFile).not.toHaveBeenCalled();
    });

    it('never overwrites a newer file during undo', async () => {
      const existing = artifactFile('.claudian/artifacts/analyse.html');
      const create = jest.fn();
      const app = {
        vault: {
          getAbstractFileByPath: jest.fn().mockReturnValue(existing),
          create,
        },
      } as unknown as App;

      await expect(new ArtifactService(app).restoreArtifact({
        filePath: existing.path,
        html: '<html>Alt</html>',
      })).rejects.toThrow('ist bereits vorhanden');
      expect(create).not.toHaveBeenCalled();
    });

    it('refuses to trash files outside the artifact folder', async () => {
      const file = artifactFile('Notizen/wichtig.md');
      const trashFile = jest.fn();
      const read = jest.fn();
      const app = {
        fileManager: { trashFile },
        vault: {
          getAbstractFileByPath: jest.fn().mockReturnValue(file),
          read,
        },
      } as unknown as App;

      await expect(new ArtifactService(app).deleteArtifact(file.path))
        .rejects.toThrow('Ungültiger Artifact-Pfad');
      expect(read).not.toHaveBeenCalled();
      expect(trashFile).not.toHaveBeenCalled();
    });
  });
});
