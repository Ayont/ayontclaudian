import { profileDelimitedText } from '@/features/chat/ui/file-drop/delimitedTable';
import {
  attachmentPromptReferences,
  type ComposerAttachment,
  toMessageAttachment,
} from '@/features/chat/ui/file-drop/stagedAttachment';
import { TABLE_REFERENCE_TAG } from '@/features/chat/ui/file-drop/tableReference';

const table: ComposerAttachment = {
  name: 'calls.csv',
  relPath: '.claudian/attachments/calls-1.csv',
  size: 2048,
  table: profileDelimitedText('a,b\n1,2\n3,4\n', 'csv'),
};
const pdf: ComposerAttachment = { name: 'brief.pdf', relPath: '.claudian/attachments/brief-1.pdf', previewSrc: 'data:image/png;base64,AA' };

describe('toMessageAttachment', () => {
  it('keeps only the summary of a table on the persisted message', () => {
    expect(toMessageAttachment(table)).toEqual({
      name: 'calls.csv',
      relPath: '.claudian/attachments/calls-1.csv',
      size: 2048,
      table: { rows: 2, columns: 2 },
    });
  });

  it('passes other attachments through unchanged', () => {
    expect(toMessageAttachment(pdf)).toEqual(pdf);
  });
});

describe('attachmentPromptReferences', () => {
  it('references tables by block and everything else by @path, in order', () => {
    const text = attachmentPromptReferences([pdf, table]);
    const [first, ...rest] = text.split('\n');

    expect(first).toBe('@.claudian/attachments/brief-1.pdf');
    expect(rest.join('\n').startsWith(`<${TABLE_REFERENCE_TAG} `)).toBe(true);
    expect(text).not.toContain('@.claudian/attachments/calls-1.csv');
  });

  it('is empty without attachments', () => {
    expect(attachmentPromptReferences([])).toBe('');
  });
});
