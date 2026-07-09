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
        const encoded = new TextEncoder().encode(data);
        files.set(path, encoded.buffer.slice(0));
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

  it('scopes images per conversation and never mixes chats', async () => {
    const make = (id: string) => ({
      id,
      name: `${id}.png`,
      mediaType: 'image/png' as const,
      data: Buffer.from(id).toString('base64'),
      size: 10,
      source: 'paste' as const,
    });

    await service.saveImage(make('img-a1'), 'conv-a');
    await service.saveImage(make('img-a2'), 'conv-a');
    await service.saveImage(make('img-b1'), 'conv-b');
    await service.saveImage(make('img-draft'), null);

    const aImages = await service.listImagesForConversation('conv-a');
    const bImages = await service.listImagesForConversation('conv-b');
    const draftImages = await service.listImagesForConversation(null);

    expect(aImages.map((i) => i.id).sort()).toEqual(['img-a1', 'img-a2']);
    expect(bImages.map((i) => i.id)).toEqual(['img-b1']);
    expect(draftImages.map((i) => i.id)).toEqual(['img-draft']);
  });

  it('re-tags draft images to a newly created conversation', async () => {
    await service.saveImage(
      {
        id: 'img-draft',
        name: 'draft.png',
        mediaType: 'image/png' as const,
        data: Buffer.from('draft').toString('base64'),
        size: 10,
        source: 'paste' as const,
      },
      null,
    );

    await service.reassignConversation(['img-draft'], 'conv-new');

    expect(await service.listImagesForConversation(null)).toHaveLength(0);
    expect((await service.listImagesForConversation('conv-new')).map((i) => i.id)).toEqual(['img-draft']);
  });

  it('retains sent conversation images beyond the draft cleanup window', async () => {
    await service.saveImage(
      {
        id: 'img-history',
        name: 'history.png',
        mediaType: 'image/png' as const,
        data: Buffer.from('history').toString('base64'),
        size: 10,
        source: 'paste' as const,
      },
      'conv-history',
    );
    await service.archiveMessageImages(['img-history'], 'conv-history', 'msg-history');

    const manifestPath = '.claudian/staging/images/manifest.json';
    const raw = await vault.adapter.read(manifestPath);
    const manifest = JSON.parse(raw);
    manifest.images[0].createdAt = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await vault.adapter.write(manifestPath, JSON.stringify(manifest, null, 2));

    expect(await service.cleanup(7)).toBe(0);
    expect(await service.loadImage('img-history')).not.toBeNull();
    expect((await service.listImages())[0].messageId).toBe('msg-history');
  });

  it('purges legacy unscoped entries on cleanup so they never dump globally', async () => {
    // Simulate a pre-scoping manifest: an entry with NO conversationId field.
    const manifestPath = '.claudian/staging/images/manifest.json';
    await vault.adapter.writeBinary('.claudian/staging/images/legacy.png', new TextEncoder().encode('legacy').buffer);
    await vault.adapter.write(
      manifestPath,
      JSON.stringify(
        {
          version: 1,
          images: [
            {
              id: 'legacy',
              filename: 'legacy.png',
              name: 'legacy.png',
              mediaType: 'image/png',
              size: 10,
              source: 'paste',
              createdAt: Date.now(),
            },
          ],
        },
        null,
        2,
      ),
    );

    const removed = await service.cleanup(7);

    expect(removed).toBe(1);
    expect(await service.listImages()).toHaveLength(0);
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
