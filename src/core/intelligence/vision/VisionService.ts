import type { TFile} from 'obsidian';
import { type Vault } from 'obsidian';

import type { ImageAttachment, ImageMediaType } from '../../types';

export interface ImageAnalysisResult {
  path: string;
  description: string;
  detectedText?: string[];
}

/**
 * Runs a real vision prompt for an image attachment against a vision-capable
 * provider and returns the model's text. Injected by the plugin so this service
 * stays decoupled from provider plumbing.
 */
export type VisionAnalyzer = (image: ImageAttachment, prompt: string) => Promise<string>;

const EXT_TO_MEDIA: Record<string, ImageMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const DEFAULT_VISION_PROMPT =
  'Beschreibe dieses Bild im Detail. Erfasse sichtbaren Text wörtlich, Layout, Objekte und auffällige Details. Antworte auf Deutsch.';

export class VisionService {
  constructor(
    private readonly vault: Vault,
    private analyzer: VisionAnalyzer | null = null,
  ) {}

  /** Wires the real provider-backed analyzer (called once during plugin load). */
  setAnalyzer(analyzer: VisionAnalyzer): void {
    this.analyzer = analyzer;
  }

  async analyzeImage(file: TFile, prompt: string = DEFAULT_VISION_PROMPT): Promise<ImageAnalysisResult> {
    const mediaType = EXT_TO_MEDIA[file.extension.toLowerCase()];
    if (!mediaType) {
      return {
        path: file.path,
        description: `„${file.path}" ist kein unterstütztes Bildformat (png, jpg, gif, webp).`,
      };
    }

    if (!this.analyzer) {
      return {
        path: file.path,
        description: `Bild unter ${file.path} (${file.stat.size} Bytes). Aktiviere einen bildfähigen Provider (z. B. Claude, Pi, Antigravity), um eine echte Bildanalyse zu erhalten.`,
      };
    }

    let data: string;
    try {
      const buffer = await this.vault.readBinary(file);
      data = Buffer.from(buffer).toString('base64');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { path: file.path, description: `„${file.path}" konnte nicht gelesen werden: ${message}` };
    }

    const image: ImageAttachment = {
      id: `vision-${file.path}`,
      name: file.name,
      mediaType,
      data,
      size: file.stat.size,
      source: 'file',
    };

    try {
      const description = (await this.analyzer(image, prompt)).trim();
      return {
        path: file.path,
        description: description || 'Der Provider lieferte keine Beschreibung zurück.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { path: file.path, description: `Bildanalyse fehlgeschlagen: ${message}` };
    }
  }
}
