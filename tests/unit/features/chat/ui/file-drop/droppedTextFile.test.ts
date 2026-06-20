import {
  formatDroppedFileBlock,
  getFileExtension,
  isTextLikeFile,
  languageForFile,
  MAX_DROPPED_TEXT_SIZE,
} from '../../../../../../src/features/chat/ui/file-drop/droppedTextFile';

describe('getFileExtension', () => {
  it('returns the extension without the dot', () => {
    expect(getFileExtension('notes.md')).toBe('md');
    expect(getFileExtension('a/b/c/App.tsx')).toBe('tsx');
    expect(getFileExtension('archive.tar.gz')).toBe('gz');
  });

  it('treats dotfiles as their suffix', () => {
    expect(getFileExtension('.gitignore')).toBe('gitignore');
    expect(getFileExtension('/repo/.env')).toBe('env');
  });

  it('returns empty for extensionless names', () => {
    expect(getFileExtension('Makefile')).toBe('');
    expect(getFileExtension('LICENSE')).toBe('');
  });
});

describe('isTextLikeFile', () => {
  it('accepts common text/code extensions', () => {
    for (const n of ['readme.md', 'main.ts', 'a.py', 'data.json', 'style.css', 'q.sql', 'log.txt']) {
      expect(isTextLikeFile(n)).toBe(true);
    }
  });

  it('accepts by MIME type even with unknown extension', () => {
    expect(isTextLikeFile('weird.xyz', 'text/plain')).toBe(true);
    expect(isTextLikeFile('data.bin', 'application/json')).toBe(true);
  });

  it('accepts extensionless / dotfile known names', () => {
    expect(isTextLikeFile('Makefile')).toBe(true);
    expect(isTextLikeFile('Dockerfile')).toBe(true);
    expect(isTextLikeFile('.gitignore')).toBe(true);
  });

  it('rejects binary / unknown files', () => {
    for (const n of ['photo.heic', 'movie.mp4', 'archive.zip', 'app.exe', 'font.woff2']) {
      expect(isTextLikeFile(n)).toBe(false);
    }
  });
});

describe('languageForFile', () => {
  it('uses the extension as the language hint', () => {
    expect(languageForFile('a.ts')).toBe('ts');
    expect(languageForFile('q.sql')).toBe('sql');
  });
});

describe('formatDroppedFileBlock', () => {
  it('wraps content in a fenced block with language + filename', () => {
    const out = formatDroppedFileBlock('src/util.ts', 'export const x = 1;');
    expect(out).toContain('```ts util.ts');
    expect(out).toContain('export const x = 1;');
    expect(out.trim().endsWith('```')).toBe(true);
  });

  it('escapes embedded code fences by using a longer outer fence', () => {
    const content = '# Doc\n```js\nconsole.log(1)\n```\n';
    const out = formatDroppedFileBlock('doc.md', content);
    // Outer fence must be longer than the inner ``` (>=4 backticks).
    expect(out).toContain('````md doc.md');
    expect(out).toContain('```js');
  });

  it('normalizes CRLF and trims trailing whitespace', () => {
    const out = formatDroppedFileBlock('a.txt', 'line1\r\nline2   \n\n');
    expect(out).toContain('line1\nline2');
    expect(out).not.toContain('\r');
  });

  it('exposes a sane size cap', () => {
    expect(MAX_DROPPED_TEXT_SIZE).toBe(256 * 1024);
  });
});
