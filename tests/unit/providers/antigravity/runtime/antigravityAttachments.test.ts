import {
  buildAttachmentMentionPrefix,
  decodeBase64Attachment,
  extensionForMediaType,
  safeAttachmentStem,
} from '@/providers/antigravity/runtime/antigravityAttachments';

describe('extensionForMediaType', () => {
  it('maps known media types', () => {
    expect(extensionForMediaType('image/png')).toBe('png');
    expect(extensionForMediaType('image/jpeg')).toBe('jpg');
    expect(extensionForMediaType('image/webp')).toBe('webp');
    expect(extensionForMediaType('application/pdf')).toBe('pdf');
  });

  it('falls back to bin for unknown types', () => {
    expect(extensionForMediaType('application/octet-stream')).toBe('bin');
    expect(extensionForMediaType('')).toBe('bin');
  });
});

describe('safeAttachmentStem', () => {
  it('strips extension and unsafe chars', () => {
    expect(safeAttachmentStem('My Photo (1).png', 'fallback')).toBe('My-Photo-1');
    expect(safeAttachmentStem('/a/b/résumé final.pdf', 'fallback')).toBe('r-sum-final');
  });

  it('uses the fallback for empty/garbage names', () => {
    expect(safeAttachmentStem('', 'attachment-1')).toBe('attachment-1');
    expect(safeAttachmentStem('***', 'attachment-2')).toBe('attachment-2');
  });
});

describe('buildAttachmentMentionPrefix', () => {
  it('returns empty for no paths', () => {
    expect(buildAttachmentMentionPrefix([])).toBe('');
  });

  it('builds @path mentions (singular vs plural)', () => {
    expect(buildAttachmentMentionPrefix(['/tmp/a.png'])).toBe('Attached file: @/tmp/a.png\n\n');
    expect(buildAttachmentMentionPrefix(['/tmp/a.png', '/tmp/b.pdf'])).toBe(
      'Attached files: @/tmp/a.png @/tmp/b.pdf\n\n',
    );
  });

  it('quotes paths that contain spaces', () => {
    expect(buildAttachmentMentionPrefix(['/tmp/my photo.png'])).toBe('Attached file: @"/tmp/my photo.png"\n\n');
    expect(buildAttachmentMentionPrefix(['/tmp/a.png', '/tmp/b file.pdf'])).toBe(
      'Attached files: @/tmp/a.png @"/tmp/b file.pdf"\n\n',
    );
  });
});

describe('decodeBase64Attachment', () => {
  it('decodes raw base64', () => {
    const data = Buffer.from('hello').toString('base64');
    expect(decodeBase64Attachment(data).toString()).toBe('hello');
  });

  it('strips a data-URI prefix', () => {
    const data = `data:image/png;base64,${Buffer.from('xy').toString('base64')}`;
    expect(decodeBase64Attachment(data).toString()).toBe('xy');
  });
});
