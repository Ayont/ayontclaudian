import { parseInlineImage } from '@/features/chat/rendering/InlineImageRenderer';

describe('InlineImageRenderer', () => {
  it('parses a generated vault image card', () => {
    expect(parseInlineImage(`---
title: Folien-FX Kampagne
prompt: Schwarzer Porsche in einer hellen Werkstatt
path: attachments/porsche.png
alt: Schwarzer Porsche
provider: Higgsfield
---`)).toEqual({
      title: 'Folien-FX Kampagne',
      prompt: 'Schwarzer Porsche in einer hellen Werkstatt',
      src: 'attachments/porsche.png',
      alt: 'Schwarzer Porsche',
      provider: 'Higgsfield',
    });
  });

  it('rejects blocks without an actual image source', () => {
    expect(parseInlineImage('title: Nur Behauptung')).toBeNull();
  });
});
