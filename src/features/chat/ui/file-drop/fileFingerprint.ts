import { createHash } from 'crypto';

/** Hashing is skipped above this; such files are not compared for duplicates. */
export const MAX_FINGERPRINT_BYTES = 64 * 1024 * 1024;

/**
 * Content identity of a dropped file, or null when it is too large or
 * unreadable. Browsers save a repeated download as `name (1).csv`, so equal
 * bytes — not equal names — is what marks a duplicate.
 */
export async function fingerprintFile(file: Blob): Promise<string | null> {
  if (file.size > MAX_FINGERPRINT_BYTES) return null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return `${file.size}:${createHash('sha1').update(bytes).digest('hex')}`;
  } catch {
    return null;
  }
}
