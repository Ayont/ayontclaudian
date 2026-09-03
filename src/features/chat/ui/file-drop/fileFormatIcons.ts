/**
 * Custom file format icons (non-Lucide) inspired by VS Code and modern IDEs.
 * Provides custom SVG badges and color-coded symbols for file formats.
 */

export interface FormatMeta {
  color: string;
  bg: string;
  borderColor: string;
  badgeText?: string;
  svg?: string;
}

/**
 * Clean, lightweight inline SVG icons for developer file formats.
 */
const ICONS_SVG: Record<string, string> = {
  markdown: `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9zM2.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-11zM3.5 5h1.2l1.3 1.8L7.3 5h1.2v6H7.2V7.7L6 9.4 4.8 7.7V11H3.5V5zm8 0h1v3.8l1.4-1.4.7.7-2.6 2.6-2.6-2.6.7-.7 1.4 1.4V5z"/>
    </svg>`,
  powershell: `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M1.5 2.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11zm2.354 2.146a.5.5 0 0 0-.708.708L5.793 8l-2.647 2.646a.5.5 0 0 0 .708.708l3-3a.5.5 0 0 0 0-.708l-3-3zm4.5 6.5a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1h-4z"/>
    </svg>`,
  terminal: `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M2 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H2zm0 1h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1.646 2.146a.5.5 0 0 0 0 .708L5.293 8.5l-1.647 1.646a.5.5 0 0 0 .708.708l2-2a.5.5 0 0 0 0-.708l-2-2a.5.5 0 0 0-.708 0zm4.854 4.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3z"/>
    </svg>`,
  css: `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M2.5 1.5 3.5 13l4.5 1.5 4.5-1.5 1-11.5h-11zm9.1 2.3-.2 2.2H5.1l.1 1.2h6l-.3 3.5-2.9 1-2.9-1-.2-1.9h1.3l.1.9 1.7.5 1.7-.5.2-1.8H4.9L4.6 3.8h7z"/>
    </svg>`,
  html: `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M2.5 1.5 3.5 13l4.5 1.5 4.5-1.5 1-11.5h-11zm8.3 4.2H5l.2 1.8h5.4l-.5 4.7-2.6.8-2.6-.8-.2-1.9h1.3l.1.9 1.4.4 1.4-.4.2-2.1H4.9L4.5 3.8h7.2l-.2 1.9z"/>
    </svg>`,
  json: `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M5.5 2.5c-.8 0-1.5.7-1.5 1.5v2c0 .8-.5 1.3-1.2 1.5.7.2 1.2.7 1.2 1.5v2c0 .8.7 1.5 1.5 1.5h.5a.5.5 0 0 0 0-1h-.5c-.3 0-.5-.2-.5-.5v-2c0-.9-.7-1.7-1.6-1.9.9-.2 1.6-1 1.6-1.9v-2c0-.3.2-.5.5-.5h.5a.5.5 0 0 0 0-1h-.5zm5 0a.5.5 0 0 0 0 1h.5c.3 0 .5.2.5.5v2c0 .9.7 1.7 1.6 1.9-.9.2-1.6 1-1.6 1.9v2c0 .3-.2.5-.5.5h-.5a.5.5 0 0 0 0 1h.5c.8 0 1.5-.7 1.5-1.5v-2c0-.8.5-1.3 1.2-1.5-.7-.2-1.2-.7-1.2-1.5v-2c0-.8-.7-1.5-1.5-1.5h-.5z"/>
    </svg>`,
  image: `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M14 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zm-1 10H3a.5.5 0 0 1-.4-.8l3-4a.5.5 0 0 1 .7 0l2 2.3 2-2.8a.5.5 0 0 1 .8 0l2.5 3.5a.5.5 0 0 1-.4.8zM5 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
    </svg>`,
  pdf: `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h5.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12a1.5 1.5 0 0 1 .439 1.061V14.5A1.5 1.5 0 0 1 13.5 16h-9A1.5 1.5 0 0 1 3 14.5v-13zM4.5 1a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V5h-3.5A1.5 1.5 0 0 1 9 3.5V1H4.5zM6 7.5a.5.5 0 0 1 .5-.5h1.5a1.5 1.5 0 0 1 0 3H7v1.5a.5.5 0 0 1-1 0v-4zm1 .5v1h.5a.5.5 0 0 0 0-1H7zm3-.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0v-3a.5.5 0 0 1 .5-.5z"/>
    </svg>`,
  archive: `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M2.5 1.5A1.5 1.5 0 0 1 4 0h8a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 12 16H4a1.5 1.5 0 0 1-1.5-1.5v-13zM7 1v1h2V1H7zm0 2v1h2V3H7zm0 2v1h2V5H7zm0 2v1h2V7H7zm0 2v1.5a1.5 1.5 0 0 0 3 0V9H7zm1 3.5a.5.5 0 1 1 1 0 .5.5 0 0 1-1 0z"/>
    </svg>`,
  database: `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M8 1c3.866 0 7 1.12 7 2.5v9c0 1.38-3.134 2.5-7 2.5s-7-1.12-7-2.5v-9C1 2.12 4.134 1 8 1zm0 1.2c-3.1 0-5.8.84-5.8 1.3 0 .46 2.7 1.3 5.8 1.3s5.8-.84 5.8-1.3c0-.46-2.7-1.3-5.8-1.3zm5.8 3.82c-.9.5-2.7 1.18-5.8 1.18s-4.9-.68-5.8-1.18v2.2c.7.5 2.7 1.18 5.8 1.18s5.1-.68 5.8-1.18v-2.2zm0 3.5c-.9.5-2.7 1.18-5.8 1.18s-4.9-.68-5.8-1.18v2.2c.7.5 2.7 1.18 5.8 1.18s5.1-.68 5.8-1.18v-2.2z"/>
    </svg>`,
};

/**
 * Returns metadata and styles for any filename or file extension.
 */
export function getFormatMeta(filename: string): FormatMeta {
  const dot = filename.lastIndexOf('.');
  const ext = (dot >= 0 ? filename.slice(dot + 1) : filename).toLowerCase().trim();

  switch (ext) {
    case 'md':
    case 'markdown':
    case 'mdx':
      return {
        color: '#60a5fa',
        bg: 'rgba(59, 130, 246, 0.16)',
        borderColor: 'rgba(59, 130, 246, 0.35)',
        svg: ICONS_SVG.markdown,
      };

    case 'ps1':
    case 'psm1':
    case 'psd1':
      return {
        color: '#38bdf8',
        bg: 'rgba(2, 132, 199, 0.20)',
        borderColor: 'rgba(56, 189, 248, 0.38)',
        svg: ICONS_SVG.powershell,
      };

    case 'sh':
    case 'bash':
    case 'zsh':
      return {
        color: '#4ade80',
        bg: 'rgba(34, 197, 94, 0.16)',
        borderColor: 'rgba(74, 222, 128, 0.35)',
        svg: ICONS_SVG.terminal,
      };

    case 'ts':
    case 'tsx':
      return {
        color: '#3178c6',
        bg: 'rgba(49, 120, 198, 0.22)',
        borderColor: 'rgba(49, 120, 198, 0.45)',
        badgeText: 'TS',
      };

    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return {
        color: '#facc15',
        bg: 'rgba(250, 204, 21, 0.18)',
        borderColor: 'rgba(250, 204, 21, 0.40)',
        badgeText: 'JS',
      };

    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return {
        color: '#38bdf8',
        bg: 'rgba(56, 189, 248, 0.16)',
        borderColor: 'rgba(56, 189, 248, 0.35)',
        svg: ICONS_SVG.css,
      };

    case 'html':
    case 'htm':
      return {
        color: '#fb923c',
        bg: 'rgba(251, 146, 60, 0.18)',
        borderColor: 'rgba(251, 146, 60, 0.38)',
        svg: ICONS_SVG.html,
      };

    case 'json':
    case 'jsonc':
      return {
        color: '#fbbf24',
        bg: 'rgba(251, 191, 36, 0.16)',
        borderColor: 'rgba(251, 191, 36, 0.35)',
        svg: ICONS_SVG.json,
      };

    case 'py':
      return {
        color: '#38bdf8',
        bg: 'rgba(56, 189, 248, 0.16)',
        borderColor: 'rgba(56, 189, 248, 0.35)',
        badgeText: 'PY',
      };

    case 'pdf':
      return {
        color: '#f87171',
        bg: 'rgba(239, 68, 68, 0.18)',
        borderColor: 'rgba(248, 113, 113, 0.40)',
        svg: ICONS_SVG.pdf,
      };

    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'bmp':
    case 'ico':
      return {
        color: '#c084fc',
        bg: 'rgba(192, 132, 252, 0.16)',
        borderColor: 'rgba(192, 132, 252, 0.35)',
        svg: ICONS_SVG.image,
      };

    case 'sql':
    case 'sqlite':
    case 'db':
      return {
        color: '#2dd4bf',
        bg: 'rgba(45, 212, 191, 0.16)',
        borderColor: 'rgba(45, 212, 191, 0.35)',
        svg: ICONS_SVG.database,
      };

    case 'zip':
    case 'tar':
    case 'gz':
    case 'rar':
    case '7z':
    case 'bz2':
      return {
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.16)',
        borderColor: 'rgba(245, 158, 11, 0.35)',
        svg: ICONS_SVG.archive,
      };

    case 'yml':
    case 'yaml':
    case 'toml':
    case 'ini':
    case 'env':
      return {
        color: '#a78bfa',
        bg: 'rgba(167, 139, 250, 0.16)',
        borderColor: 'rgba(167, 139, 250, 0.35)',
        badgeText: ext.toUpperCase().slice(0, 3),
      };

    case 'txt':
    case 'log':
      return {
        color: '#94a3b8',
        bg: 'rgba(148, 163, 184, 0.14)',
        borderColor: 'rgba(148, 163, 184, 0.30)',
        badgeText: ext.toUpperCase(),
      };

    default: {
      const displayExt = ext.length > 0 && ext.length <= 4 ? ext.toUpperCase() : 'DOC';
      return {
        color: '#a1a1aa',
        bg: 'rgba(161, 161, 170, 0.14)',
        borderColor: 'rgba(161, 161, 170, 0.28)',
        badgeText: displayExt,
      };
    }
  }
}

/**
 * Renders a crisp, modern format badge/icon element (non-Lucide) directly into a container.
 */
export function renderFileFormatBadge(container: HTMLElement, filename: string): HTMLElement {
  const meta = getFormatMeta(filename);
  container.empty();
  container.addClass('claudian-format-icon');
  container.style.color = meta.color;
  container.style.backgroundColor = meta.bg;
  container.style.borderColor = meta.borderColor;

  if (meta.svg) {
    container.innerHTML = meta.svg.trim();
  } else if (meta.badgeText) {
    const textSpan = container.createSpan({ cls: 'claudian-format-badge-text', text: meta.badgeText });
    textSpan.style.color = meta.color;
  }

  return container;
}
