import type { Vault } from 'obsidian';

import { ImageStagingService } from '@/features/chat/services/ImageStagingService';

function createMockVault() {
  const files = new Map<string, ArrayBuffer>();

  return {
    adapter: {
      exists: jest.fn(async (path: string) => files.has(path)),
      mkdir: jest.fn(async () => {}),
      read: jest.fn(async (path: string) => {
        const data = files.get(path);
        if (!data) throw new Error(`File not found: ${path}`);
        return Buffer.from(data).toString('utf-8');
      }),
      write: jest.fn(async (path: string, data: string) => {
        files.set(path, Buffer.from(data, 'utf-8'));
      }),
      readBinary: jest.fn(async (path: string) => {
        const data = files.get(path);
        if (!data) throw new Error(`File not found: ${path}`);
        return data.slice(0);
      }),
      writeBinary: jest.fn(async (path: string, data: ArrayBuffer) => {
        files.set(path, data.slice(0));
      }),
      remove: jest.fn(async (path: string) => {
        files.delete(path);
      }),
    },
  } as unknown as Vault;
}

describe('ImageStagingService', () => {
  let vault: ReturnType<typeof createMockVault>;
  let service: ImageStagingService;

  beforeEach(() => {
    vault = createMockVault();
    service = new ImageStagingService(vault as unknown as Vault);
  });

  it('saves and loads an image', async () => {
    const attachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png' as const,
      data: Buffer.from('fake-image').toString('base64'),
      size: 1234,
      source: 'paste' as const,
    };

    await service.saveImage(attachment);
    const loaded = await service.loadImage('img-1');

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe('img-1');
    expect(loaded?.name).toBe('test.png');
    expect(loaded?.mediaType).toBe('image/png');
    expect(loaded?.data).toBe(attachment.data);
    expect(loaded?.size).toBe(1234);
    expect(loaded?.source).toBe('paste');
  });

  it('lists staged image metadata', async () => {
    await service.saveImage({
      id: 'img-2',
      name: 'drop.jpg',
      mediaType: 'image/jpeg' as const,
      data: Buffer.from('drop-data').toString('base64'),
      size: 567,
      source: 'drop' as const,
    });

    const entries = await service.listImages();

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('img-2');
    expect(entries[0].name).toBe('drop.jpg');
    expect(entries[0].filename).toBe('img-2.jpeg');
  });

  it('deletes an image and removes the file', async () => {
    await service.saveImage({
      id: 'img-3',
      name: 'delete.webp',
      mediaType: 'image/webp' as const,
      data: Buffer.from('webp-data').toString('base64'),
      size: 100,
      source: 'paste' as const,
    });

    expect(await service.loadImage('img-3')).not.toBeNull();

    await service.deleteImage('img-3');

    expect(await service.loadImage('img-3')).toBeNull();
    const entries = await service.listImages();
    expect(entries).toHaveLength(0);
  });

  it('cleans up old images but keeps recent ones', async () => {
    await service.saveImage({
      id: 'img-recent',
      name: 'recent.png',
      mediaType: 'image/png' as const,
      data: Buffer.from('recent').toString('base64'),
      size: 10,
      source: 'paste' as const,
    });

    await service.saveImage({
      id: 'img-old',
      name: 'old.png',
      mediaType: 'image/png' as const,
      data: Buffer.from('old').toString('base64'),
      size: 10,
      source: 'paste' as const,
    });

    // Mutate the manifest to make img-old ancient.
    const manifestPath = '.claudian/staging/images/manifest.json';
    const raw = await vault.adapter.read(manifestPath);
    const manifest = JSON.parse(raw);
    const oldEntry = manifest.images.find((i: { id: string }) => i.id === 'img-old');
    oldEntry.createdAt = Date.now() - 10 * 24 * 60 * 60 * 1000;
    await vault.adapter.write(manifestPath, JSON.stringify(manifest, null, 2));

    const removed = await service.cleanup(7);

    expect(removed).toBe(1);
    expect(await service.loadImage('img-recent')).not.toBeNull();
    expect(await service.loadImage('img-old')).toBeNull();
  });

  it('removes manifest entries whose backing file is missing', async () => {
    await service.saveImage({
      id: 'img-orphan',
      name: 'orphan.png',
      mediaType: 'image/png' as const,
      data: Buffer.from('orphan').toString('base64'),
      size: 10,
      source: 'paste' as const,
    });

    // Delete the backing file manually but keep the manifest entry.
    await vault.adapter.remove('.claudian/staging/images/img-orphan.png');

    const removed = await service.cleanup(7);

    expect(removed).toBe(1);
    expect(await service.loadImage('img-orphan')).toBeNull();
  });
});
