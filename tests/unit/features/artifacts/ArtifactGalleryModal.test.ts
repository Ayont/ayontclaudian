import { createMockEl } from '@test/helpers/mockElement';
import type { App } from 'obsidian';

import { ArtifactGalleryModal } from '@/features/artifacts/ArtifactGalleryModal';
import type { ArtifactMeta } from '@/features/artifacts/ArtifactService';

const confirmMock = jest.fn();

jest.mock('@/shared/modals/ConfirmModal', () => ({
  confirm: (...args: unknown[]) => confirmMock(...args),
}));

const artifact: ArtifactMeta = {
  id: 'incident-verlauf',
  title: 'Incident Verlauf',
  icon: '🧭',
  kind: 'timeline',
  createdAt: 1_000,
  updatedAt: Date.now(),
  version: 3,
  filePath: '.claudian/artifacts/incident-verlauf.html',
};

const secondArtifact: ArtifactMeta = {
  ...artifact,
  id: 'technik-status',
  title: 'Technik Status',
  filePath: '.claudian/artifacts/technik-status.html',
};

function allElements(root: any): any[] {
  return [root, ...(root.children ?? []).flatMap((child: any) => allElements(child))];
}

function findByText(root: any, text: string): any | undefined {
  return allElements(root).find((element) => element.textContent === text);
}

async function flushAsyncHandlers(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function openGallery(overrides: Record<string, jest.Mock> = {}) {
  const artifactService = {
    listArtifacts: jest.fn().mockResolvedValue([artifact]),
    openInBrowser: jest.fn().mockResolvedValue(undefined),
    deleteArtifact: jest.fn(),
    restoreArtifact: jest.fn(),
    ...overrides,
  };
  const modal = new ArtifactGalleryModal({} as App, { artifactService } as any);
  const contentEl = createMockEl();
  (modal as any).contentEl = contentEl;
  (modal as any).modalEl = createMockEl();

  await ArtifactGalleryModal.prototype.onOpen.call(modal);

  return { artifactService, contentEl, modal };
}

describe('ArtifactGalleryModal', () => {
  beforeEach(() => {
    confirmMock.mockReset();
  });

  it('renders German copy and native labelled controls for each artifact', async () => {
    const { artifactService, contentEl, modal } = await openGallery();

    const heading = findByText(contentEl, 'Artifact-Galerie');
    expect(heading?.tagName).toBe('H2');
    expect(modal.modalEl.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(findByText(contentEl, 'Zeitleiste')).toBeDefined();

    const openButton = findByText(contentEl, 'Öffnen');
    const deleteButton = findByText(contentEl, 'In Papierkorb');
    expect(openButton?.tagName).toBe('BUTTON');
    expect(openButton?.getAttribute('aria-label')).toBe('Incident Verlauf im Browser öffnen');
    expect(deleteButton?.tagName).toBe('BUTTON');
    expect(deleteButton?.getAttribute('aria-label')).toBe('Incident Verlauf in den Papierkorb verschieben');
    expect(allElements(contentEl).some((element) => element.getAttribute?.('role') === 'button')).toBe(false);

    openButton.click();
    expect(artifactService.openInBrowser).toHaveBeenCalledWith(artifact.filePath);
  });

  it('keeps an independent undo action for every successively trashed artifact', async () => {
    confirmMock.mockResolvedValue(true);
    const firstSnapshot = { filePath: artifact.filePath, html: '<html>Erstes</html>' };
    const secondSnapshot = { filePath: secondArtifact.filePath, html: '<html>Zweites</html>' };
    const restoreArtifact = jest.fn().mockResolvedValue(undefined);
    const { artifactService, contentEl } = await openGallery({
      listArtifacts: jest.fn().mockResolvedValue([artifact, secondArtifact]),
      deleteArtifact: jest.fn()
        .mockResolvedValueOnce(firstSnapshot)
        .mockResolvedValueOnce(secondSnapshot),
      restoreArtifact,
    });

    allElements(contentEl).find(
      (element) => element.getAttribute?.('aria-label') === 'Incident Verlauf in den Papierkorb verschieben',
    )?.click();
    await flushAsyncHandlers();
    allElements(contentEl).find(
      (element) => element.getAttribute?.('aria-label') === 'Technik Status in den Papierkorb verschieben',
    )?.click();
    await flushAsyncHandlers();

    const undoButtons = allElements(contentEl).filter((element) => element.textContent === 'Rückgängig');
    expect(undoButtons).toHaveLength(2);
    expect(undoButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Incident Verlauf wiederherstellen',
      'Technik Status wiederherstellen',
    ]);

    undoButtons[0].click();
    await flushAsyncHandlers();
    expect(restoreArtifact).toHaveBeenCalledWith(firstSnapshot);
    expect(allElements(contentEl).some(
      (element) => element.getAttribute?.('aria-label') === 'Technik Status wiederherstellen',
    )).toBe(true);
    expect(artifactService.deleteArtifact).toHaveBeenCalledTimes(2);
  });

  it('confirms deletion and offers a keyboard-accessible undo action', async () => {
    const snapshot = { filePath: artifact.filePath, html: '<html>Artifact</html>' };
    confirmMock.mockResolvedValue(true);
    const { artifactService, contentEl } = await openGallery({
      deleteArtifact: jest.fn().mockResolvedValue(snapshot),
      restoreArtifact: jest.fn().mockResolvedValue(undefined),
    });

    findByText(contentEl, 'In Papierkorb').click();
    await flushAsyncHandlers();

    expect(confirmMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Obsidian-Papierkorb'),
      'In Papierkorb',
    );
    expect(artifactService.deleteArtifact).toHaveBeenCalledWith(artifact.filePath);
    const undoButton = findByText(contentEl, 'Rückgängig');
    expect(undoButton?.tagName).toBe('BUTTON');
    expect(undoButton?.getAttribute('aria-label')).toBe('Incident Verlauf wiederherstellen');

    undoButton.click();
    await flushAsyncHandlers();

    expect(artifactService.restoreArtifact).toHaveBeenCalledWith(snapshot);
    expect(findByText(contentEl, 'Incident Verlauf')).toBeDefined();
    expect(findByText(contentEl, '„Incident Verlauf“ wurde wiederhergestellt.')).toBeDefined();
  });

  it('keeps the artifact when moving it to trash is cancelled', async () => {
    confirmMock.mockResolvedValue(false);
    const { artifactService, contentEl } = await openGallery();
    const deleteButton = findByText(contentEl, 'In Papierkorb');

    deleteButton.click();
    await flushAsyncHandlers();

    expect(artifactService.deleteArtifact).not.toHaveBeenCalled();
    expect(deleteButton.disabled).toBe(false);
    expect(findByText(contentEl, 'Incident Verlauf')).toBeDefined();
  });

  it('renders a clear retry state when loading fails', async () => {
    const { contentEl } = await openGallery({
      listArtifacts: jest.fn().mockRejectedValue(new Error('Vault nicht erreichbar')),
    });

    const alert = allElements(contentEl).find((element) => element.getAttribute?.('role') === 'alert');
    expect(alert).toBeDefined();
    expect(findByText(contentEl, 'Artefakte konnten nicht geladen werden: Vault nicht erreichbar')).toBeDefined();
    expect(findByText(contentEl, 'Erneut versuchen')?.tagName).toBe('BUTTON');
  });

  it('keeps a failed deletion visible and announces the error', async () => {
    confirmMock.mockResolvedValue(true);
    const { artifactService, contentEl } = await openGallery({
      deleteArtifact: jest.fn().mockRejectedValue(new Error('Papierkorb gesperrt')),
    });

    findByText(contentEl, 'In Papierkorb').click();
    await flushAsyncHandlers();

    expect(artifactService.deleteArtifact).toHaveBeenCalled();
    expect(findByText(contentEl, 'Incident Verlauf')).toBeDefined();
    expect(findByText(
      contentEl,
      '„Incident Verlauf“ konnte nicht in den Papierkorb verschoben werden: Papierkorb gesperrt',
    )).toBeDefined();
    expect(allElements(contentEl).some((element) => element.getAttribute?.('role') === 'alert')).toBe(true);
  });

  it('keeps undo retryable when restoring from trash fails', async () => {
    const snapshot = { filePath: artifact.filePath, html: '<html>Artifact</html>' };
    const restoreArtifact = jest.fn()
      .mockRejectedValueOnce(new Error('Ziel kurzzeitig gesperrt'))
      .mockResolvedValueOnce(undefined);
    confirmMock.mockResolvedValue(true);
    const { artifactService, contentEl } = await openGallery({
      deleteArtifact: jest.fn().mockResolvedValue(snapshot),
      restoreArtifact,
    });

    findByText(contentEl, 'In Papierkorb').click();
    await flushAsyncHandlers();
    findByText(contentEl, 'Rückgängig').click();
    await flushAsyncHandlers();

    expect(findByText(
      contentEl,
      '„Incident Verlauf“ konnte nicht wiederhergestellt werden: Ziel kurzzeitig gesperrt',
    )).toBeDefined();
    const retryButton = findByText(contentEl, 'Wiederherstellung erneut versuchen');
    expect(retryButton?.tagName).toBe('BUTTON');

    retryButton.click();
    await flushAsyncHandlers();

    expect(artifactService.restoreArtifact).toHaveBeenCalledTimes(2);
    expect(findByText(contentEl, 'Incident Verlauf')).toBeDefined();
  });
});
