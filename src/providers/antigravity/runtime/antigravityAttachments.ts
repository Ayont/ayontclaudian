/**
 * Helpers for handing attachments to `agy`. Since agy is filesystem-based and
 * reads files referenced by `@path` (verified for both text and images, incl.
 * multimodal), Claudian stages base64 attachments to disk and injects `@`-paths
 * into the prompt. Pure functions only here; the runtime does the actual I/O.
 */

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** File extension (no dot) for a media type; falls back to `bin`. */
export function extensionForMediaType(mediaType: string): string {
  return EXTENSION_BY_MEDIA_TYPE[mediaType?.toLowerCase()] ?? 'bin';
}

/** Sanitizes an attachment base name to a safe, short on-disk filename stem. */
export function safeAttachmentStem(name: string, fallback: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return cleaned || fallback;
}

/**
 * Builds the `@path` mention block prepended to the prompt so agy reads each
 * staged attachment. Returns '' when there are no paths.
 */
export function buildAttachmentMentionPrefix(absPaths: string[]): string {
  const mentions = absPaths.filter(Boolean).map((p) => (p.includes(' ') ? `@"${p}"` : `@${p}`));
  if (mentions.length === 0) return '';
  const label = mentions.length === 1 ? 'Attached file' : 'Attached files';
  return `${label}: ${mentions.join(' ')}\n\n`;
}

/** Decodes a base64 image's data (handles optional data-URI prefix). */
export function decodeBase64Attachment(data: string): Buffer {
  const comma = data.indexOf(',');
  const raw = data.startsWith('data:') && comma >= 0 ? data.slice(comma + 1) : data;
  return Buffer.from(raw, 'base64');
}
