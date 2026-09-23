import { restoreComposerAttachment } from '@/features/chat/ui/file-drop/restoreAttachment';
import { attachmentOnlyDisplayContent, attachmentPromptReference } from '@/features/chat/ui/file-drop/stagedAttachment';

function bytes(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
}

describe('restoreComposerAttachment', () => {
  it('passes a plain file attachment through unchanged', async () => {
    const readBinary = jest.fn();
    const restored = await restoreComposerAttachment(
      { name: 'brief.pdf', relPath: '.claudian/attachments/brief.pdf', size: 10 },
      readBinary,
    );

    expect(restored).toEqual({ name: 'brief.pdf', relPath: '.claudian/attachments/brief.pdf', size: 10 });
    expect(readBinary).not.toHaveBeenCalled();
  });

  it('re-profiles a table from the vault so the agent gets the same preview block', async () => {
    const readBinary = jest.fn().mockResolvedValue(bytes('Name;Ort\nAda;Berlin\n'));
    const restored = await restoreComposerAttachment(
      { name: 'kunden.csv', relPath: '.claudian/attachments/kunden.csv', table: { rows: 1, columns: 2 } },
      readBinary,
    );

    expect(readBinary).toHaveBeenCalledWith('.claudian/attachments/kunden.csv');
    const reference = attachmentPromptReference(restored);
    expect(reference).toContain('Delimiter: semicolon');
    expect(reference).toContain('Ada');
    expect(reference).not.toMatch(/^@/);
  });

  it('falls back to the stored summary when the file cannot be read', async () => {
    const restored = await restoreComposerAttachment(
      { name: 'kunden.csv', relPath: '.claudian/attachments/kunden.csv', table: { rows: 2277, columns: 9 } },
      jest.fn().mockRejectedValue(new Error('gone')),
    );

    const reference = attachmentPromptReference(restored);
    expect(reference).toContain('2,277 data rows');
    expect(reference).toContain('.claudian/attachments/kunden.csv');
    expect(reference).not.toMatch(/^@/);
  });
});

describe('attachmentOnlyDisplayContent', () => {
  it('labels an attachment-only send by its file names', () => {
    expect(attachmentOnlyDisplayContent([{ name: 'a.pdf' }, { name: 'b.csv' }])).toBe('📎 a.pdf, b.csv');
    expect(attachmentOnlyDisplayContent([])).toBe('');
  });
});
