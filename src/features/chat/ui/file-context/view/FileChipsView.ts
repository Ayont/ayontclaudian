import { setIcon } from 'obsidian';

export interface FileChipsViewCallbacks {
  onRemoveAttachment: (path: string) => void;
  onOpenFile: (path: string) => void;
}

export class FileChipsView {
  private containerEl: HTMLElement;
  private callbacks: FileChipsViewCallbacks;
  private fileIndicatorEl: HTMLElement;

  constructor(containerEl: HTMLElement, callbacks: FileChipsViewCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;

    const firstChild = this.containerEl.firstChild;
    this.fileIndicatorEl = this.containerEl.createDiv({ cls: 'claudian-file-indicator' });
    if (firstChild) {
      this.containerEl.insertBefore(this.fileIndicatorEl, firstChild);
    }
  }

  destroy(): void {
    this.fileIndicatorEl.remove();
  }

  renderCurrentNote(filePath: string | null): void {
    this.fileIndicatorEl.empty();

    if (!filePath) {
      this.fileIndicatorEl.removeClass('claudian-visible-flex');
      this.fileIndicatorEl.addClass('claudian-hidden');
      return;
    }

    this.fileIndicatorEl.addClass('claudian-visible-flex');
    this.fileIndicatorEl.removeClass('claudian-hidden');
    this.renderFileChip(filePath, () => {
      this.callbacks.onRemoveAttachment(filePath);
    });
  }

  private renderFileChip(filePath: string, onRemove: () => void): void {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const { icon, typeClass } = this.getFileTypeMeta(ext);

    const chipEl = this.fileIndicatorEl.createDiv({ cls: `claudian-file-chip claudian-file-chip--${typeClass}` });

    const iconEl = chipEl.createSpan({ cls: 'claudian-file-chip-icon' });
    setIcon(iconEl, icon);

    const normalizedPath = filePath.replace(/\\/g, '/');
    const filename = normalizedPath.split('/').pop() || filePath;
    const nameEl = chipEl.createSpan({ cls: 'claudian-file-chip-name' });
    nameEl.setText(filename);
    nameEl.setAttribute('title', filePath);

    const removeEl = chipEl.createSpan({ cls: 'claudian-file-chip-remove' });
    removeEl.setText('\u00D7');
    removeEl.setAttribute('aria-label', 'Remove');

    chipEl.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.claudian-file-chip-remove')) {
        this.callbacks.onOpenFile(filePath);
      }
    });

    removeEl.addEventListener('click', () => {
      onRemove();
    });
  }

  /**
   * Maps a file extension to a Lucide icon name and a CSS color class.
   * PDF → red, Word → blue, Excel → green, code → purple, etc.
   */
  private getFileTypeMeta(ext: string): { icon: string; typeClass: string } {
    const pdfExts = ['pdf'];
    const docExts = ['doc', 'docx', 'odt', 'rtf', 'pages'];
    const sheetExts = ['xls', 'xlsx', 'ods', 'csv', 'numbers'];
    const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'rb', 'php', 'c', 'cpp', 'h', 'sh', 'yml', 'yaml', 'json', 'xml', 'html', 'css', 'sql'];
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z', 'bz2'];
    const mdExts = ['md', 'markdown', 'mdx'];

    if (pdfExts.includes(ext)) return { icon: 'file-text', typeClass: 'pdf' };
    if (docExts.includes(ext)) return { icon: 'file-text', typeClass: 'doc' };
    if (sheetExts.includes(ext)) return { icon: 'table', typeClass: 'sheet' };
    if (codeExts.includes(ext)) return { icon: 'file-code', typeClass: 'code' };
    if (imageExts.includes(ext)) return { icon: 'image', typeClass: 'image' };
    if (archiveExts.includes(ext)) return { icon: 'file-archive', typeClass: 'archive' };
    if (mdExts.includes(ext)) return { icon: 'file-text', typeClass: 'md' };
    return { icon: 'file-text', typeClass: 'default' };
  }
}
