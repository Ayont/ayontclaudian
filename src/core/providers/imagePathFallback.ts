import type { ImageAttachment } from '../types';

/**
 * Universal vision fallback for CLI providers without native image blocks.
 *
 * Every pasted/dropped image is persisted to `.claudian/staging/images/` at
 * attach time (ImageStagingService), so the binary is ALWAYS on disk when a
 * turn is sent. Agents run with the vault as their working directory and can
 * read image files through their file tools — referencing the staged path in
 * the prompt therefore gives every provider working vision, even when its
 * transport (plain stdin prompt) cannot carry base64 image blocks.
 */

const IMAGE_STAGING_FOLDER = '.claudian/staging/images';

/** Vault-relative path of an image's staged binary (same rule as saveImage). */
export function stagedImagePath(image: ImageAttachment): string {
  const ext = image.mediaType.split('/')[1] ?? 'png';
  return `${IMAGE_STAGING_FOLDER}/${image.id}.${ext}`;
}

/**
 * Appends `@path` references for all attached images to the outgoing prompt
 * text. No-op without images. Safe to combine with native image blocks
 * (redundant but harmless — reliability over token thrift).
 */
export function appendImagePathReferences(
  text: string,
  images: readonly ImageAttachment[] | undefined,
): string {
  if (!images || images.length === 0) return text;

  const refs = images.map((image) => `@${stagedImagePath(image)}`).join('\n');
  const block = `[Attached images — read and analyze these image files:]\n${refs}`;
  return text ? `${text}\n\n${block}` : block;
}
