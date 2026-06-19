import { normalizePath, type Vault } from 'obsidian';

import type { ImageAttachment, ImageMediaType } from '../../../core/types';

export interface StagedImageEntry {
  id: string;
  filename: string;
  name: string;
  mediaType: ImageMediaType;
  size: number;
  source: 'file' | 'paste' | 'drop';
  createdAt: number;
}

interface StagingManifest {
  version: 1;
  images: StagedImageEntry[];
}

const MANIFEST_FILE = 'manifest.json';
const STAGING_FOLDER = '.claudian/staging/images';
const DEFAULT_MAX_AGE_DAYS = 7;

/**
 * Persists pasted/dropped image attachments to the vault filesystem so they
 * survive Obsidian restarts. Images are stored as binary files under
 * `.claudian/staging/images/` with a JSON manifest tracking metadata.
 *
 * Old entries (older than `DEFAULT_MAX_AGE_DAYS`) are cleaned up on startup.
 */
export class ImageStagingService {
  constructor(private readonly vault: Vault) {}

  private async ensureStagingFolder(): Promise<string> {
    const folder = normalizePath(STAGING_FOLDER);
    const exists = await this.vault.adapter.exists(folder);
    if (!exists) {
      await this.vault.adapter.mkdir(folder);
    }
    return folder;
  }

  private async readManifest(): Promise<StagingManifest> {
    const folder = await this.ensureStagingFolder();
    const manifestPath = normalizePath(`${folder}/${MANIFEST_FILE}`);
    try {
      const raw = await this.vault.adapter.read(manifestPath);
      const parsed = JSON.parse(raw) as StagingManifest;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.images)) {
        return parsed;
      }
    } catch {
      // Missing or corrupt manifest — start fresh.
    }
    return { version: 1, images: [] };
  }

  private async writeManifest(manifest: StagingManifest): Promise<void> {
    const folder = await this.ensureStagingFolder();
    const manifestPath = normalizePath(`${folder}/${MANIFEST_FILE}`);
    await this.vault.adapter.write(manifestPath, JSON.stringify(manifest, null, 2));
  }

  /**
   * Saves an image attachment to the staging folder and records it in the manifest.
   * If an image with the same id already exists, its entry is updated.
   */
  async saveImage(attachment: ImageAttachment): Promise<void> {
    const folder = await this.ensureStagingFolder();
    const ext = attachment.mediaType.split('/')[1] ?? 'png';
    const filename = `${attachment.id}.${ext}`;
    const filePath = normalizePath(`${folder}/${filename}`);

    await this.vault.adapter.writeBinary(filePath, Buffer.from(attachment.data, 'base64').buffer as ArrayBuffer);

    const manifest = await this.readManifest();
    const entry: StagedImageEntry = {
      id: attachment.id,
      filename,
      name: attachment.name,
      mediaType: attachment.mediaType,
      size: attachment.size,
      source: attachment.source,
      createdAt: Date.now(),
    };

    const index = manifest.images.findIndex((img) => img.id === attachment.id);
    if (index >= 0) {
      manifest.images[index] = entry;
    } else {
      manifest.images.push(entry);
    }

    await this.writeManifest(manifest);
  }

  /** Removes a staged image by id (file + manifest entry). */
  async deleteImage(id: string): Promise<void> {
    const manifest = await this.readManifest();
    const entry = manifest.images.find((img) => img.id === id);
    if (!entry) return;

    const folder = await this.ensureStagingFolder();
    const filePath = normalizePath(`${folder}/${entry.filename}`);
    try {
      if (await this.vault.adapter.exists(filePath)) {
        await this.vault.adapter.remove(filePath);
      }
    } catch {
      // Best-effort file removal.
    }

    manifest.images = manifest.images.filter((img) => img.id !== id);
    await this.writeManifest(manifest);
  }

  /** Loads a staged image as an `ImageAttachment`, or null if missing/corrupt. */
  async loadImage(id: string): Promise<ImageAttachment | null> {
    const manifest = await this.readManifest();
    const entry = manifest.images.find((img) => img.id === id);
    if (!entry) return null;

    const folder = await this.ensureStagingFolder();
    const filePath = normalizePath(`${folder}/${entry.filename}`);
    try {
      const buffer = await this.vault.adapter.readBinary(filePath);
      const data = Buffer.from(buffer).toString('base64');
      return {
        id: entry.id,
        name: entry.name,
        mediaType: entry.mediaType,
        data,
        size: entry.size,
        source: entry.source,
      };
    } catch {
      // File missing or unreadable — purge stale entry.
      await this.deleteImage(id);
      return null;
    }
  }

  /** Returns all staged image entries (metadata only, no binary data). */
  async listImages(): Promise<StagedImageEntry[]> {
    const manifest = await this.readManifest();
    return manifest.images;
  }

  /**
   * Removes entries older than `maxAgeDays` (default 7) and entries whose
   * backing file no longer exists. Called on plugin startup.
   */
  async cleanup(maxAgeDays = DEFAULT_MAX_AGE_DAYS): Promise<number> {
    const manifest = await this.readManifest();
    const folder = await this.ensureStagingFolder();
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const remaining: StagedImageEntry[] = [];
    let removed = 0;

    for (const entry of manifest.images) {
      const filePath = normalizePath(`${folder}/${entry.filename}`);
      const exists = await this.vault.adapter.exists(filePath);
      if (!exists || entry.createdAt < cutoff) {
        try {
          if (exists) {
            await this.vault.adapter.remove(filePath);
          }
        } catch {
          // Best-effort.
        }
        removed++;
        continue;
      }
      remaining.push(entry);
    }

    if (removed > 0) {
      await this.writeManifest({ version: 1, images: remaining });
    }
    return removed;
  }
}
