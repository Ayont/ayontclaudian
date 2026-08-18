import {
  attachmentKindLabel,
  attachmentPeekMode,
  attachmentTypeMeta,
  formatFileSize,
} from '@/features/chat/ui/file-drop/attachmentMeta';

describe('attachmentTypeMeta', () => {
  it('classifies office, media, and data files by kind', () => {
    expect(attachmentTypeMeta('brief.pdf').kind).toBe('pdf');
    expect(attachmentTypeMeta('vertrag.docx').kind).toBe('doc');
    expect(attachmentTypeMeta('budget.xlsx').kind).toBe('sheet');
    expect(attachmentTypeMeta('pitch.pptx').kind).toBe('slides');
    expect(attachmentTypeMeta('clip.mp4').kind).toBe('video');
    expect(attachmentTypeMeta('stimme.m4a').kind).toBe('audio');
    expect(attachmentTypeMeta('foto.webp').kind).toBe('image');
    expect(attachmentTypeMeta('notes.md').kind).toBe('md');
    expect(attachmentTypeMeta('app.ts').kind).toBe('code');
    expect(attachmentTypeMeta('pack.zip').kind).toBe('archive');
  });
});

describe('attachmentPeekMode', () => {
  it('picks a visual peek for each kind', () => {
    expect(attachmentPeekMode('brief.pdf')).toBe('iframe');
    expect(attachmentPeekMode('clip.mp4')).toBe('media');
    expect(attachmentPeekMode('stimme.mp3')).toBe('media');
    expect(attachmentPeekMode('foto.png')).toBe('thumb');
    expect(attachmentPeekMode('data.csv')).toBe('table');
    expect(attachmentPeekMode('notes.md')).toBe('page');
    expect(attachmentPeekMode('app.ts')).toBe('code');
    expect(attachmentPeekMode('vertrag.docx')).toBe('paper');
    expect(attachmentPeekMode('budget.xlsx')).toBe('paper');
    expect(attachmentPeekMode('pitch.pptx')).toBe('paper');
    expect(attachmentPeekMode('pack.zip')).toBe('paper');
  });
});

describe('attachmentKindLabel', () => {
  it('returns German labels for docked file kinds', () => {
    expect(attachmentKindLabel('pdf')).toBe('PDF');
    expect(attachmentKindLabel('doc')).toBe('Dokument');
    expect(attachmentKindLabel('sheet')).toBe('Tabelle');
    expect(attachmentKindLabel('slides')).toBe('Präsentation');
    expect(attachmentKindLabel('video')).toBe('Video');
    expect(attachmentKindLabel('audio')).toBe('Audio');
    expect(attachmentKindLabel('image')).toBe('Bild');
    expect(attachmentKindLabel('md')).toBe('Notiz');
    expect(attachmentKindLabel('code')).toBe('Code');
    expect(attachmentKindLabel('archive')).toBe('Archiv');
    expect(attachmentKindLabel('generic')).toBe('Datei');
  });
});

describe('formatFileSize', () => {
  it('formats bytes as a compact human size', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
