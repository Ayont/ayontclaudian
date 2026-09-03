/**
 * Media activity card and full-size preview modal.
 *
 * Renders interactive visual cards whenever a model analyzes, views, or reads
 * images, videos, audio, or PDF documents. Follows the liquid-glass design
 * system (DESIGN.md) with an ink-well viewport, format badges, inline media
 * playback, and a full-size modal overlay on click.
 */

import { normalizePath, setIcon } from 'obsidian';

import type { ToolCallInfo } from '../../../core/types';
import { getFileManagerName, openInDefaultApp, revealInSystemFileManager, showFileContextMenu } from '../services/FileActionService';
import { getLocale } from '../../../i18n/i18n';

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf';

export interface MediaActivity {
  kind: MediaKind;
  action: 'analyze' | 'view' | 'read' | 'inspect';
  target: string;
  fileName: string;
  extension: string;
}

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif', 'avif',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv',
]);

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus',
]);

const DOCUMENT_EXTENSIONS = new Set(['pdf']);

export function getMediaKindFromPath(pathOrUrl: string): MediaKind | null {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return null;
  const trimmed = pathOrUrl.trim().toLowerCase();

  if (trimmed.startsWith('data:image/')) return 'image';
  if (trimmed.startsWith('data:video/')) return 'video';
  if (trimmed.startsWith('data:audio/')) return 'audio';
  if (trimmed.startsWith('data:application/pdf')) return 'pdf';

  // Strip query strings or hash
  const clean = trimmed.split('?')[0].split('#')[0];
  const ext = clean.split('.').pop() ?? '';
  if (!ext || ext === clean) return null;

  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'pdf';

  return null;
}

export function isMediaToolName(name: string): boolean {
  const n = (name || '').trim().toLowerCase();
  if (n === 'analyze_image' || n === 'analyze-image' || n === 'analyzeimage') return true;
  if (n === 'show_image' || n === 'show-image' || n === 'showimage') return true;
  if (n === 'view_image' || n === 'view-image' || n === 'viewimage') return true;
  if (n === 'read_image' || n === 'read-image' || n === 'readimage') return true;
  if (n === 'inspect_image' || n === 'inspect-image' || n === 'display_image') return true;
  if (n === 'image_analysis' || n === 'vision_analyze') return true;
  return false;
}

function extractTargetCandidate(input: Record<string, unknown> = {}): string | null {
  const candidateKeys = [
    'file_path',
    'filePath',
    'path',
    'image_path',
    'imagePath',
    'file',
    'target_file',
    'targetFile',
    'url',
    'src',
    'image',
    'target',
  ];

  for (const key of candidateKeys) {
    const val = input[key];
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }

  // Scan any string values in input for media paths or data URIs
  for (const val of Object.values(input)) {
    if (typeof val === 'string' && (getMediaKindFromPath(val) || val.startsWith('data:image/'))) {
      return val.trim();
    }
  }

  return null;
}

export function resolveMediaActivity(
  toolName: string,
  input: Record<string, unknown> = {},
  result?: string,
): MediaActivity | null {
  const isNamedMediaTool = isMediaToolName(toolName);
  let target = extractTargetCandidate(input);

  // If no target in input, check result (e.g. tool returned a generated image path or URL)
  if (!target && result) {
    const trimmedResult = result.trim();
    if (getMediaKindFromPath(trimmedResult) || trimmedResult.startsWith('data:image/')) {
      target = trimmedResult;
    }
  }

  if (!target && !isNamedMediaTool) {
    return null;
  }

  const effectiveTarget = target ?? 'image.png';
  const detectedKind = getMediaKindFromPath(effectiveTarget);

  // For generic tools (like Read, Write, WebSearch), only treat as media if the target has a valid media extension or data URI
  if (!isNamedMediaTool && !detectedKind) {
    return null;
  }

  const kind = detectedKind ?? 'image';

  // Determine action
  const lowerName = toolName.toLowerCase();
  let action: MediaActivity['action'] = 'analyze';
  if (lowerName.includes('show') || lowerName.includes('view') || lowerName.includes('display')) {
    action = 'view';
  } else if (lowerName.includes('read') || lowerName.includes('load')) {
    action = 'read';
  } else if (lowerName.includes('inspect')) {
    action = 'inspect';
  }

  const cleanTarget = effectiveTarget.replace(/^[\\/@]+/, '').split('?')[0].split('#')[0];
  const fileName = cleanTarget.split(/[\\/]/).pop() || effectiveTarget;
  const extension = (fileName.split('.').pop() || kind).toUpperCase();

  return {
    kind,
    action,
    target: effectiveTarget,
    fileName,
    extension,
  };
}

export function describeMediaActivity(activity: MediaActivity, locale: string = getLocale()): {
  title: string;
  detail: string;
  icon: string;
} {
  const isDe = locale === 'de';
  let title = isDe ? 'Medium analysieren' : 'Analyze media';
  if (activity.kind === 'image') {
    if (activity.action === 'view') title = isDe ? 'Bild anzeigen' : 'View image';
    else if (activity.action === 'read') title = isDe ? 'Bild laden' : 'Load image';
    else if (activity.action === 'inspect') title = isDe ? 'Bild untersuchen' : 'Inspect image';
    else title = isDe ? 'Bild analysieren' : 'Analyze image';
  } else if (activity.kind === 'video') {
    if (activity.action === 'view') title = isDe ? 'Video ansehen' : 'View video';
    else title = isDe ? 'Video analysieren' : 'Analyze video';
  } else if (activity.kind === 'audio') {
    title = isDe ? 'Audio anhören' : 'Listen to audio';
  } else if (activity.kind === 'pdf') {
    title = isDe ? 'Dokument laden' : 'Inspect document';
  }

  const iconMap: Record<MediaKind, string> = {
    image: 'image',
    video: 'video',
    audio: 'headphones',
    pdf: 'file-text',
  };

  return {
    title,
    detail: activity.fileName,
    icon: iconMap[activity.kind] ?? 'file',
  };
}

export function decorateMediaToolElement(toolEl: HTMLElement, activity: MediaActivity): void {
  toolEl.addClass('claudian-tool-call-media');
  toolEl.addClass(`claudian-tool-call-media-${activity.kind}`);
  toolEl.dataset.mediaKind = activity.kind;
  toolEl.dataset.mediaAction = activity.action;
}

/**
 * Resolves a file path, URL, or data URI into an accessible browser URL.
 */
export function tryReadImageAsDataUri(filePath: string): string | null {
  try {
    const electronWindow = window as unknown as {
      require?: (moduleName: string) => any;
    };
    const nodeFs = electronWindow.require?.('fs');
    if (nodeFs && nodeFs.existsSync(filePath)) {
      const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'gif' ? 'image/gif'
        : ext === 'webp' ? 'image/webp'
        : ext === 'svg' ? 'image/svg+xml'
        : 'image/png';
      const buf = nodeFs.readFileSync(filePath);
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
  } catch {
    // Best-effort
  }
  return null;
}

export function resolveMediaResourceUrl(target: string): string {
  if (!target) return '';
  const trimmed = target.trim();
  if (/^(?:https?:|data:|blob:)/i.test(trimmed)) {
    return trimmed;
  }

  // Strip leading @ or file://
  const cleanPath = trimmed.replace(/^@/, '').replace(/^file:\/\//, '');

  try {
    const app = (window as unknown as {
      app?: {
        metadataCache?: { getFirstLinkpathDest?: (p: string, r: string) => any };
        vault?: {
          getAbstractFileByPath?: (p: string) => any;
          getFiles?: () => Array<{ path: string; name: string }>;
          getResourcePath?: (file: any) => string;
          adapter?: { getResourcePath?: (p: string) => string; getFullPath?: (p: string) => string };
        };
      };
    }).app;

    if (app) {
      // 1. Check if first link destination exists
      const file = app.metadataCache?.getFirstLinkpathDest?.(cleanPath, '')
        ?? app.vault?.getAbstractFileByPath?.(cleanPath);
      if (file && app.vault?.getResourcePath) {
        return app.vault.getResourcePath(file);
      }

      // 2. Search vault files for matching file name
      const fileName = cleanPath.split(/[\\/]/).pop()?.toLowerCase();
      if (fileName && app.vault?.getFiles && app.vault?.getResourcePath) {
        const matchingFile = app.vault.getFiles().find(f => f.name.toLowerCase() === fileName);
        if (matchingFile) {
          return app.vault.getResourcePath(matchingFile);
        }
      }

      // 3. Adapter getResourcePath
      if (app.vault?.adapter?.getResourcePath) {
        const normalized = normalizePath(cleanPath);
        const res = app.vault.adapter.getResourcePath(normalized);
        if (res) return res;
      }
    }
  } catch {
    // Fall through
  }

  // 4. Try reading absolute or relative path from disk as base64 data URI
  const dataUri = tryReadImageAsDataUri(cleanPath);
  if (dataUri) return dataUri;

  if (cleanPath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(cleanPath)) {
    return `file://${encodeURI(cleanPath)}`;
  }

  return cleanPath;
}

/**
 * Strips raw base64 chunks or binary buffers from model output so only
 * readable analysis remains.
 */
function cleanMediaAnalysisText(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  // If the result is just a data URI or huge base64 block, don't dump it
  if (/^data:(?:image|video|audio|application)\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]{100,}$/.test(trimmed)) {
    return '';
  }
  return trimmed;
}

/**
 * Opens a full-size modal overlay for an image or media file.
 */
export function openMediaModal(media: {
  src: string;
  title: string;
  kind?: MediaKind;
}): void {
  if (typeof window === "undefined" || !window.document || !window.document.body) {
    return;
  }
  const ownerDocument = window.document;
  const overlay = ownerDocument.createElement("div");
  overlay.className = "claudian-image-modal-overlay";

  const modal = ownerDocument.createElement("div");
  modal.className = "claudian-image-modal";
  overlay.appendChild(modal);

  const closeBtn = ownerDocument.createElement("div");
  closeBtn.className = "claudian-image-modal-close";
  closeBtn.textContent = "×";
  const isDe = getLocale() === 'de';
  closeBtn.setAttribute("aria-label", isDe ? "Schließen" : "Close");
  modal.appendChild(closeBtn);

  const kind = media.kind ?? "image";
  if (kind === "image") {
    const img = ownerDocument.createElement("img");
    img.src = media.src;
    img.alt = media.title;
    modal.appendChild(img);
  } else if (kind === "video") {
    const video = ownerDocument.createElement("video");
    video.className = "claudian-modal-video";
    video.controls = true;
    video.autoplay = true;
    video.src = media.src;
    modal.appendChild(video);
  } else if (kind === "audio") {
    const audio = ownerDocument.createElement("audio");
    audio.controls = true;
    audio.autoplay = true;
    audio.src = media.src;
    modal.appendChild(audio);
  }

  const caption = ownerDocument.createElement("div");
  caption.className = "claudian-image-modal-caption";
  caption.textContent = media.title;
  modal.appendChild(caption);

  const handleEsc = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  const close = () => {
    ownerDocument.removeEventListener("keydown", handleEsc);
    overlay.remove();
  };

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  ownerDocument.addEventListener("keydown", handleEsc);
  ownerDocument.body.appendChild(overlay);
}

/**
 * Renders the expanded contents of an image/video/audio/document tool call.
 */
export function renderMediaContent(
  container: HTMLElement,
  toolCall: ToolCallInfo,
  activity: MediaActivity,
  running: boolean,
): void {
  container.empty();
  container.addClass('claudian-media-panel');
  const isDe = getLocale() === 'de';

  const { title, detail, icon } = describeMediaActivity(activity);
  const resourceUrl = resolveMediaResourceUrl(activity.target);

  // Chrome header strip
  const chrome = container.createDiv({ cls: 'claudian-media-chrome' });

  const left = chrome.createDiv({ cls: 'claudian-media-left' });
  const iconEl = left.createSpan({ cls: 'claudian-media-icon' });
  setIcon(iconEl, icon);

  const titleEl = left.createSpan({ cls: 'claudian-media-title' });
  titleEl.setText(detail);
  titleEl.setAttribute('title', activity.target);

  const badgeEl = left.createSpan({ cls: 'claudian-media-badge' });
  badgeEl.setText(activity.extension);

  // Right actions
  const actions = chrome.createDiv({ cls: 'claudian-media-actions' });

  const expandBtn = actions.createEl('button', {
    cls: 'claudian-media-btn claudian-media-btn--expand',
    attr: {
      type: 'button',
      'aria-label': 'Vollbild anzeigen',
      title: 'Vollbild anzeigen',
    },
  });
  setIcon(expandBtn, 'maximize-2');
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openMediaModal({
      src: resourceUrl,
      title: `${detail} (${title})`,
      kind: activity.kind,
    });
  });

  const fileManager = getFileManagerName();
  const revealBtn = actions.createEl('button', {
    cls: 'claudian-media-btn claudian-media-btn--reveal',
    attr: {
      type: 'button',
      'aria-label': isDe ? `Im ${fileManager} anzeigen` : `Reveal in ${fileManager}`,
      title: isDe ? `Im ${fileManager} anzeigen` : `Reveal in ${fileManager}`,
    },
  });
  setIcon(revealBtn, 'folder');
  revealBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const app = (window as unknown as { app?: any }).app;
    if (app) void revealInSystemFileManager(app, activity.target);
  });

  const openDefaultBtn = actions.createEl('button', {
    cls: 'claudian-media-btn claudian-media-btn--open',
    attr: {
      type: 'button',
      'aria-label': isDe ? 'Mit Standard-App öffnen' : 'Open in default app',
      title: isDe ? 'Mit Standard-App öffnen' : 'Open in default app',
    },
  });
  setIcon(openDefaultBtn, 'external-link');
  openDefaultBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const app = (window as unknown as { app?: any }).app;
    if (app) void openInDefaultApp(app, activity.target);
  });

  const copyBtn = actions.createEl('button', {
    cls: 'claudian-media-btn claudian-media-btn--copy',
    attr: {
      type: 'button',
      'aria-label': 'Pfad kopieren',
      title: 'Pfad kopieren',
    },
  });
  setIcon(copyBtn, 'copy');
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(activity.target);
      copyBtn.addClass('is-copied');
      window.setTimeout(() => copyBtn.removeClass('is-copied'), 1500);
    } catch {
      // Best-effort copy
    }
  });

  container.addEventListener('contextmenu', (e) => {
    const app = (window as unknown as { app?: any }).app;
    if (app) {
      showFileContextMenu(app, e, activity.target, {
        kind: activity.kind,
        fileName: detail,
      });
    }
  });

  // Viewport
  const viewport = container.createDiv({ cls: 'claudian-media-viewport' });

  if (running) {
    viewport.addClass('is-running');
    const pulse = viewport.createDiv({ cls: 'claudian-media-running' });
    pulse.createSpan({ cls: 'claudian-media-running-dot' });
    pulse.createSpan({ cls: 'claudian-media-running-text', text: 'Medium wird analysiert\u2026' });
    return;
  }

  if (activity.kind === 'image') {
    const img = viewport.createEl('img', {
      cls: 'claudian-media-preview-img',
      attr: {
        src: resourceUrl,
        alt: detail,
        loading: 'lazy',
      },
    });

    img.addEventListener('click', (e) => {
      e.stopPropagation();
      openMediaModal({
        src: resourceUrl,
        title: `${detail} (${title})`,
        kind: 'image',
      });
    });

    img.addEventListener('error', () => {
      const app = (window as unknown as { app?: any }).app;
      if (app) {
        const found = app.metadataCache?.getFirstLinkpathDest?.(activity.fileName, '')
          ?? app.vault?.getFiles?.()?.find?.((f: any) => f.name.toLowerCase() === activity.fileName.toLowerCase());
        if (found && app.vault?.getResourcePath) {
          const alternateSrc = app.vault.getResourcePath(found);
          if (alternateSrc && img.getAttribute('src') !== alternateSrc) {
            img.setAttribute('src', alternateSrc);
            return;
          }
        }
      }
      const dataUri = tryReadImageAsDataUri(activity.target);
      if (dataUri && img.getAttribute('src') !== dataUri) {
        img.setAttribute('src', dataUri);
        return;
      }

      img.remove();
      const fallback = viewport.createDiv({ cls: 'claudian-media-fallback' });
      const fallbackIcon = fallback.createSpan({ cls: 'claudian-media-fallback-icon' });
      setIcon(fallbackIcon, 'image');
      fallback.createSpan({ cls: 'claudian-media-fallback-text', text: detail });
    });
  } else if (activity.kind === 'video') {
    viewport.createEl('video', {
      cls: 'claudian-media-preview-video',
      attr: {
        controls: 'true',
        preload: 'metadata',
        src: resourceUrl,
      },
    });
  } else if (activity.kind === 'audio') {
    viewport.createEl('audio', {
      cls: 'claudian-media-preview-audio',
      attr: {
        controls: 'true',
        preload: 'metadata',
        src: resourceUrl,
      },
    });
  } else if (activity.kind === 'pdf') {
    const pdfCard = viewport.createDiv({ cls: 'claudian-media-pdf-card' });
    const pdfIcon = pdfCard.createSpan({ cls: 'claudian-media-pdf-icon' });
    setIcon(pdfIcon, 'file-text');
    const pdfInfo = pdfCard.createDiv({ cls: 'claudian-media-pdf-info' });
    pdfInfo.createDiv({ cls: 'claudian-media-pdf-name', text: detail });
    pdfInfo.createDiv({ cls: 'claudian-media-pdf-path', text: activity.target });
  }

  // Analysis result caption (if provided by the model or tool)
  const analysisText = cleanMediaAnalysisText(toolCall.result ?? '');
  if (analysisText) {
    const captionEl = container.createDiv({ cls: 'claudian-media-caption' });
    const captionHeader = captionEl.createDiv({ cls: 'claudian-media-caption-header' });
    captionHeader.createSpan({ cls: 'claudian-media-caption-title', text: isDe ? 'Analyse' : 'Analysis' });
    const captionBody = captionEl.createDiv({ cls: 'claudian-media-caption-body' });
    captionBody.setText(analysisText);
  }
}
