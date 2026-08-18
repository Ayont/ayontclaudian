import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const JPEG_SOI = [0xFF, 0xD8, 0xFF];
const MIN_JPEG_BYTES = 80;

/** First embedded JPEG in a PDF stream — enough for a composer peek. */
export function extractJpegFromPdf(bytes: Uint8Array): Uint8Array | null {
  for (let i = 0; i < bytes.length - 3; i += 1) {
    if (bytes[i] !== JPEG_SOI[0] || bytes[i + 1] !== JPEG_SOI[1] || bytes[i + 2] !== JPEG_SOI[2]) {
      continue;
    }
    for (let j = i + 3; j < bytes.length - 1; j += 1) {
      if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
        const slice = bytes.subarray(i, j + 2);
        if (slice.length >= MIN_JPEG_BYTES) return slice;
        break;
      }
    }
  }
  return null;
}

export function rasterPeekFromBytes(jpeg: Uint8Array): string {
  return `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`;
}

export function isRasterPeekSrc(src: string): boolean {
  return src.startsWith('data:image/') || /\.(png|jpe?g|webp)(?:\?|$)/i.test(src);
}

async function renderWithQuickLook(bytes: Uint8Array): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'claudian-pdf-peek-'));
  const pdfPath = path.join(dir, 'page.pdf');
  try {
    await fs.writeFile(pdfPath, bytes);
    await execFileAsync('qlmanage', ['-t', '-s', '512', '-o', dir, pdfPath], { timeout: 4000 });
    const pngPath = path.join(dir, 'page.pdf.png');
    const png = await fs.readFile(pngPath);
    if (png.length < 32) return null;
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** First-page peek as a data-URI image. Electron cannot show PDFs in app:// iframes. */
export async function createPdfPeekSrc(file: File): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const jpeg = extractJpegFromPdf(bytes);
    if (jpeg) return rasterPeekFromBytes(jpeg);
    return await renderWithQuickLook(bytes);
  } catch {
    return null;
  }
}
