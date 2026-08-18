import {
  parseManifestVersion,
  releaseAssetBytes,
} from '@/app/update/pluginUpdateAssets';

describe('releaseAssetBytes', () => {
  it('prefers the raw arrayBuffer so octet-stream downloads are not written as empty text', () => {
    const bytes = new TextEncoder().encode('{"version":"5.99.7"}');
    const written = releaseAssetBytes({
      text: '',
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    expect(Buffer.from(written).toString('utf8')).toBe('{"version":"5.99.7"}');
  });

  it('falls back to text when no bytes arrived', () => {
    const written = releaseAssetBytes({ text: '{"version":"5.99.7"}' });
    expect(Buffer.from(written).toString('utf8')).toBe('{"version":"5.99.7"}');
  });

  it('rejects an empty download', () => {
    expect(() => releaseAssetBytes({ text: '' })).toThrow(/leer/i);
  });
});

describe('parseManifestVersion', () => {
  it('reads the version from a plugin manifest', () => {
    expect(parseManifestVersion('{"id":"realclaudian","version":"5.99.7"}')).toBe('5.99.7');
  });

  it('rejects HTML or a missing version so a failed download cannot look installed', () => {
    expect(parseManifestVersion('<!DOCTYPE html><html>Not Found</html>')).toBeNull();
    expect(parseManifestVersion('{"id":"realclaudian"}')).toBeNull();
  });
});
