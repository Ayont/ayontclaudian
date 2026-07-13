import {
  appendImagePathReferences,
  stagedImagePath,
} from '@/core/providers/imagePathFallback';
import type { ImageAttachment } from '@/core/types';

const image = (id: string, mediaType = 'image/png'): ImageAttachment => ({
  id,
  name: `${id}.png`,
  mediaType: mediaType as ImageAttachment['mediaType'],
  data: 'base64',
  size: 10,
  source: 'paste',
});

describe('stagedImagePath', () => {
  it('mirrors the ImageStagingService filename rule (id + mediaType ext)', () => {
    expect(stagedImagePath(image('img-1'))).toBe('.claudian/staging/images/img-1.png');
    expect(stagedImagePath(image('img-2', 'image/jpeg'))).toBe('.claudian/staging/images/img-2.jpeg');
  });
});

describe('appendImagePathReferences', () => {
  it('appends @path references for every attached image', () => {
    const result = appendImagePathReferences('Was ist auf dem Bild?', [image('img-1'), image('img-2')]);

    expect(result).toBe(
      'Was ist auf dem Bild?\n\n[Attached images — read and analyze these image files:]\n'
      + '@.claudian/staging/images/img-1.png\n@.claudian/staging/images/img-2.png',
    );
  });

  it('returns the text unchanged without images', () => {
    expect(appendImagePathReferences('Nur Text', [])).toBe('Nur Text');
    expect(appendImagePathReferences('Nur Text', undefined)).toBe('Nur Text');
  });

  it('emits only the reference block for an empty prompt', () => {
    const result = appendImagePathReferences('', [image('img-1')]);

    expect(result.startsWith('[Attached images')).toBe(true);
    expect(result).toContain('@.claudian/staging/images/img-1.png');
  });
});
