import type { TFile, Vault } from 'obsidian';

import { VisionService } from '../../../../../src/core/intelligence/vision/VisionService';

function createVault(): Vault {
  return {
    readBinary: jest.fn(async () => new TextEncoder().encode('binary-image-bytes').buffer),
  } as unknown as Vault;
}

function createImageFile(): TFile {
  return {
    path: 'image.png',
    name: 'image.png',
    extension: 'png',
    stat: { size: 1234 },
  } as TFile;
}

describe('VisionService', () => {
  it('returns a graceful message when no analyzer is configured', async () => {
    const vision = new VisionService(createVault());
    const result = await vision.analyzeImage(createImageFile());
    expect(result.path).toBe('image.png');
    expect(result.description).toContain('image.png');
  });

  it('rejects unsupported (non-image) file types', async () => {
    const vision = new VisionService(createVault());
    const result = await vision.analyzeImage({
      path: 'note.md',
      name: 'note.md',
      extension: 'md',
      stat: { size: 10 },
    } as TFile);
    expect(result.description).toContain('kein unterstütztes Bildformat');
  });

  it('runs the real provider-backed analyzer and returns its description', async () => {
    const analyzer = jest.fn().mockResolvedValue('Ein Diagramm mit drei Boxen.');
    const vision = new VisionService(createVault(), analyzer);

    const result = await vision.analyzeImage(createImageFile(), 'Was ist das?');

    expect(analyzer).toHaveBeenCalledTimes(1);
    const [image, prompt] = analyzer.mock.calls[0];
    expect(image.mediaType).toBe('image/png');
    expect(image.data).toBe(Buffer.from('binary-image-bytes').toString('base64'));
    expect(prompt).toBe('Was ist das?');
    expect(result.description).toBe('Ein Diagramm mit drei Boxen.');
  });

  it('surfaces analyzer failures without throwing', async () => {
    const analyzer = jest.fn().mockRejectedValue(new Error('provider offline'));
    const vision = new VisionService(createVault(), analyzer);

    const result = await vision.analyzeImage(createImageFile());

    expect(result.description).toContain('provider offline');
  });
});
