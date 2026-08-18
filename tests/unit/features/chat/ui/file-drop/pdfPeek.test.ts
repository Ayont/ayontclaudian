import { extractJpegFromPdf, rasterPeekFromBytes } from '@/features/chat/ui/file-drop/pdfPeek';

function tinyJpeg(): Uint8Array {
  // Minimal SOI…EOI envelope so the extractor can find a page image.
  return Uint8Array.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10,
    0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    ...Array.from({ length: 80 }, () => 0x11),
    0xFF, 0xD9,
  ]);
}

describe('extractJpegFromPdf', () => {
  it('pulls the first embedded JPEG out of a PDF-like buffer', () => {
    const jpeg = tinyJpeg();
    const pdf = Uint8Array.from([
      0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A,
      ...jpeg,
      0x0A, 0x65, 0x6E, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6D,
    ]);
    const found = extractJpegFromPdf(pdf);
    expect(found).not.toBeNull();
    expect(Array.from(found as Uint8Array)).toEqual(Array.from(jpeg));
  });

  it('returns null when the PDF has no JPEG stream', () => {
    expect(extractJpegFromPdf(Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toBeNull();
  });
});

describe('rasterPeekFromBytes', () => {
  it('returns a data-URI for an embedded JPEG so the chip can use an img', () => {
    const jpeg = tinyJpeg();
    const uri = rasterPeekFromBytes(jpeg);
    expect(uri.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(uri.length).toBeGreaterThan('data:image/jpeg;base64,'.length + 8);
  });
});
