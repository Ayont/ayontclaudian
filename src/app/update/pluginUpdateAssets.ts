export interface ReleaseAssetResponse {
  text?: string;
  arrayBuffer?: ArrayBuffer;
}

/** GitHub serves release assets as octet-stream; empty `text` is not "no body". */
export function releaseAssetBytes(response: ReleaseAssetResponse): Uint8Array {
  if (response.arrayBuffer && response.arrayBuffer.byteLength > 0) {
    return new Uint8Array(response.arrayBuffer);
  }
  if (response.text) {
    return new TextEncoder().encode(response.text);
  }
  throw new Error('Download war leer.');
}

export function parseManifestVersion(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim()
      ? parsed.version.trim()
      : null;
  } catch {
    return null;
  }
}
