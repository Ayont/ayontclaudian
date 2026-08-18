/**
 * Pure file-type metadata used to render attachment preview chips: a Lucide icon
 * name, a CSS type class (drives the accent color), and a coarse "kind" used to
 * decide whether a thumbnail preview is possible (images) vs. an icon (PDF,
 * video, audio, archive, generic).
 */

export type AttachmentKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'code'
  | 'archive'
  | 'md'
  | 'generic';

export type AttachmentPeekMode = 'iframe' | 'media' | 'thumb' | 'table' | 'page' | 'code' | 'paper';

export interface AttachmentTypeMeta {
  icon: string;
  typeClass: string;
  kind: AttachmentKind;
}

/** A vault file the chat can dock into the document pane. */
export interface FileDockTarget {
  kind: 'file';
  path: string;
  name: string;
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'mpg', 'mpeg'];
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'];
const PDF_EXTS = ['pdf'];
const DOC_EXTS = ['doc', 'docx', 'odt', 'rtf', 'pages'];
const SHEET_EXTS = ['xls', 'xlsx', 'ods', 'csv', 'numbers'];
const SLIDE_EXTS = ['ppt', 'pptx', 'odp', 'key'];
const CODE_EXTS = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'rb', 'php', 'c', 'cpp', 'h', 'sh', 'yml', 'yaml', 'json', 'xml', 'html', 'css', 'sql'];
const ARCHIVE_EXTS = ['zip', 'tar', 'gz', 'rar', '7z', 'bz2'];
const MD_EXTS = ['md', 'markdown', 'mdx'];

/** Extracts a lowercased extension (no dot) from a filename. */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Maps a filename to an icon, CSS type class, and coarse kind. */
export function attachmentTypeMeta(name: string): AttachmentTypeMeta {
  const ext = fileExtension(name);
  if (IMAGE_EXTS.includes(ext)) return { icon: 'image', typeClass: 'image', kind: 'image' };
  if (VIDEO_EXTS.includes(ext)) return { icon: 'video', typeClass: 'video', kind: 'video' };
  if (AUDIO_EXTS.includes(ext)) return { icon: 'music', typeClass: 'audio', kind: 'audio' };
  if (PDF_EXTS.includes(ext)) return { icon: 'file-text', typeClass: 'pdf', kind: 'pdf' };
  if (DOC_EXTS.includes(ext)) return { icon: 'file-text', typeClass: 'doc', kind: 'doc' };
  if (SHEET_EXTS.includes(ext)) return { icon: 'table', typeClass: 'sheet', kind: 'sheet' };
  if (SLIDE_EXTS.includes(ext)) return { icon: 'presentation', typeClass: 'slides', kind: 'slides' };
  if (CODE_EXTS.includes(ext)) return { icon: 'file-code', typeClass: 'code', kind: 'code' };
  if (ARCHIVE_EXTS.includes(ext)) return { icon: 'file-archive', typeClass: 'archive', kind: 'archive' };
  if (MD_EXTS.includes(ext)) return { icon: 'file-text', typeClass: 'md', kind: 'md' };
  return { icon: 'file', typeClass: 'generic', kind: 'generic' };
}

/** How a dropped file should peek inside the chat card. */
export function attachmentPeekMode(name: string): AttachmentPeekMode {
  const { kind } = attachmentTypeMeta(name);
  const ext = fileExtension(name);
  if (kind === 'pdf') return 'iframe';
  if (kind === 'video' || kind === 'audio') return 'media';
  if (kind === 'image') return 'thumb';
  if (kind === 'sheet' && ext === 'csv') return 'table';
  if (kind === 'md') return 'page';
  if (kind === 'code') return 'code';
  return 'paper';
}

const KIND_LABELS: Record<AttachmentKind, string> = {
  pdf: 'PDF',
  doc: 'Dokument',
  sheet: 'Tabelle',
  slides: 'Präsentation',
  video: 'Video',
  audio: 'Audio',
  image: 'Bild',
  md: 'Notiz',
  code: 'Code',
  archive: 'Archiv',
  generic: 'Datei',
};

/** German label for the file kind shown on cards and in the dock. */
export function attachmentKindLabel(kind: AttachmentKind): string {
  return KIND_LABELS[kind];
}

/** Human-readable byte size, e.g. "1.2 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
