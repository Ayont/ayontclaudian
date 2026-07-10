import type { App, Component } from 'obsidian';
import { MarkdownRenderer, Notice, setIcon } from 'obsidian';

export type LiveDocumentTheme = 'editorial' | 'business' | 'minimal' | 'warm' | 'technical';

export interface LiveDocument {
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  documentType?: string;
  theme: LiveDocumentTheme;
  body: string;
}

export interface LiveDocumentBlock {
  content: string;
  closed: boolean;
  liveDocument: LiveDocument | null;
}

interface LiveDocumentRenderContext {
  app: App;
  component: Component;
}

const DOCUMENT_FOLDER = '.claudian/documents';
const THEMES: LiveDocumentTheme[] = ['editorial', 'business', 'minimal', 'warm', 'technical'];
/** Keeps a user's theme choice stable while the same document is still streaming. */
const THEME_OVERRIDES = new Map<string, LiveDocumentTheme>();
const THEME_LABELS: Record<LiveDocumentTheme, string> = {
  editorial: 'Editorial',
  business: 'Business',
  minimal: 'Minimal',
  warm: 'Warm',
  technical: 'Technical',
};

function sanitizeMetaValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').slice(0, 160);
}

function isTheme(value: string): value is LiveDocumentTheme {
  return THEMES.includes(value as LiveDocumentTheme);
}

function parseMetadata(content: string): { metadata: Record<string, string>; body: string } {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized.startsWith('---\n')) return { metadata: {}, body: normalized };
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return { metadata: {}, body: normalized };

  const metadata: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = sanitizeMetaValue(line.slice(separator + 1));
    if (key && value) metadata[key] = value;
  }
  return { metadata, body: normalized.slice(end + 4).trim() };
}

export function parseLiveDocument(content: string): LiveDocument | null {
  const { metadata, body } = parseMetadata(content);
  if (!body.trim()) return null;

  const firstHeading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = sanitizeMetaValue(metadata.title ?? firstHeading ?? 'Untitled document');
  const requestedTheme = (metadata.theme ?? '').toLowerCase();
  return {
    title,
    subtitle: metadata.subtitle,
    author: metadata.author,
    date: metadata.date,
    documentType: metadata.type ?? metadata.document,
    theme: isTheme(requestedTheme) ? requestedTheme : 'editorial',
    body,
  };
}

/** Parses triple-or-longer document fences, including unfinished streaming output. */
export function parseLiveDocumentBlocks(markdown: string): LiveDocumentBlock[] {
  const blocks: LiveDocumentBlock[] = [];
  const opening = /(`{3,})(?:claudian-document|live-document)\s*\n/gi;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(markdown)) !== null) {
    const fence = match[1];
    const start = opening.lastIndex;
    const end = markdown.indexOf(fence, start);
    const closed = end >= 0;
    const content = markdown.slice(start, closed ? end : markdown.length).trim();
    blocks.push({ content, closed, liveDocument: parseLiveDocument(content) });
    if (!closed) break;
    opening.lastIndex = end + fence.length;
  }
  return blocks;
}

function wordCount(body: string): number {
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`()()-]/g, ' ')
    .replace(/\[|\]/g, ' ')
    .trim();
  return plain ? plain.split(/\s+/).length : 0;
}

function estimatedPages(words: number): number {
  return Math.max(1, Math.ceil(words / 480));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `document-${Date.now()}`;
}

function serializeDocument(document: LiveDocument, theme: LiveDocumentTheme): string {
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(document.title)}`,
    ...(document.subtitle ? [`subtitle: ${JSON.stringify(document.subtitle)}`] : []),
    ...(document.author ? [`author: ${JSON.stringify(document.author)}`] : []),
    ...(document.date ? [`date: ${JSON.stringify(document.date)}`] : []),
    ...(document.documentType ? [`type: ${JSON.stringify(document.documentType)}`] : []),
    `theme: ${theme}`,
    'created_by: ayontclaudian',
    '---',
  ];
  return `${frontmatter.join('\n')}\n\n${document.body.trim()}\n`;
}

async function ensureDocumentFolder(app: App): Promise<void> {
  if (!app.vault.getAbstractFileByPath('.claudian')) {
    await app.vault.createFolder('.claudian');
  }
  if (!app.vault.getAbstractFileByPath(DOCUMENT_FOLDER)) {
    await app.vault.createFolder(DOCUMENT_FOLDER);
  }
}

async function saveDocument(
  app: App,
  document: LiveDocument,
  theme: LiveDocumentTheme,
): Promise<string> {
  await ensureDocumentFolder(app);
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  const base = `${DOCUMENT_FOLDER}/${slugify(document.title)}-${stamp}`;
  let path = `${base}.md`;
  let suffix = 2;
  while (app.vault.getAbstractFileByPath(path)) path = `${base}-${suffix++}.md`;
  await app.vault.create(path, serializeDocument(document, theme));
  return path;
}

async function renderDocumentBody(
  target: HTMLElement,
  document: LiveDocument,
  context: LiveDocumentRenderContext,
): Promise<void> {
  target.empty();
  await MarkdownRenderer.render(context.app, document.body, target, '', context.component);
}

function createIconButton(
  parent: HTMLElement,
  icon: string,
  label: string,
): HTMLButtonElement {
  const button = parent.createEl('button', {
    cls: 'claudian-live-document-action',
    attr: { type: 'button', 'aria-label': label, title: label },
  });
  setIcon(button.createSpan(), icon);
  return button;
}

async function showExpandedDocument(
  sourceDocument: LiveDocument,
  theme: LiveDocumentTheme,
  context: LiveDocumentRenderContext,
): Promise<void> {
  const ownerDocument = context.app.workspace.containerEl.ownerDocument ?? window.document;
  const overlay = ownerDocument.body.createDiv({ cls: 'claudian-live-document-overlay' });
  const shell = overlay.createDiv({ cls: `claudian-live-document-expanded theme-${theme}` });
  const bar = shell.createDiv({ cls: 'claudian-live-document-expanded-bar' });
  bar.createSpan({ cls: 'claudian-live-document-expanded-title', text: sourceDocument.title });
  const closeButton = createIconButton(bar, 'x', 'Großansicht schließen');
  const page = shell.createDiv({ cls: 'claudian-live-document-page' });
  renderDocumentMasthead(page, sourceDocument);
  const body = page.createDiv({ cls: 'claudian-live-document-body' });
  await renderDocumentBody(body, sourceDocument, context);

  const close = () => {
    ownerDocument.removeEventListener('keydown', onKeydown);
    overlay.remove();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  ownerDocument.addEventListener('keydown', onKeydown);
}

function renderDocumentMasthead(page: HTMLElement, document: LiveDocument): void {
  const masthead = page.createDiv({ cls: 'claudian-live-document-masthead' });
  if (document.documentType) {
    masthead.createSpan({ cls: 'claudian-live-document-type', text: document.documentType });
  }
  masthead.createEl('h1', { text: document.title });
  if (document.subtitle) masthead.createEl('p', { cls: 'claudian-live-document-subtitle', text: document.subtitle });
  if (document.author || document.date) {
    const byline = masthead.createDiv({ cls: 'claudian-live-document-byline' });
    if (document.author) byline.createSpan({ text: document.author });
    if (document.author && document.date) byline.createSpan({ text: '·' });
    if (document.date) byline.createSpan({ text: document.date });
  }
}

export async function renderLiveDocument(
  container: HTMLElement,
  document: LiveDocument,
  context: LiveDocumentRenderContext,
): Promise<HTMLElement> {
  const themeKey = document.title.trim().toLowerCase();
  let activeTheme = THEME_OVERRIDES.get(themeKey) ?? document.theme;
  const words = wordCount(document.body);
  const card = container.createDiv({ cls: `claudian-live-document theme-${activeTheme}` });
  card.setAttribute('data-theme', activeTheme);

  const toolbar = card.createDiv({ cls: 'claudian-live-document-toolbar' });
  const identity = toolbar.createDiv({ cls: 'claudian-live-document-identity' });
  const icon = identity.createSpan({ cls: 'claudian-live-document-icon' });
  setIcon(icon, 'file-pen-line');
  identity.createSpan({ cls: 'claudian-live-document-label', text: 'Live document' });
  identity.createSpan({ cls: 'claudian-live-document-live', text: 'LIVE' });

  const actions = toolbar.createDiv({ cls: 'claudian-live-document-actions' });
  const themeButton = createIconButton(actions, 'palette', `Design: ${THEME_LABELS[activeTheme]}`);
  const copyButton = createIconButton(actions, 'copy', 'Dokument kopieren');
  const saveButton = createIconButton(actions, 'save', 'Als Markdown im Vault speichern');
  const expandButton = createIconButton(actions, 'maximize-2', 'Dokument groß öffnen');

  const viewport = card.createDiv({ cls: 'claudian-live-document-viewport' });
  const page = viewport.createDiv({ cls: 'claudian-live-document-page' });
  renderDocumentMasthead(page, document);
  const body = page.createDiv({ cls: 'claudian-live-document-body' });
  await renderDocumentBody(body, document, context);

  const footer = card.createDiv({ cls: 'claudian-live-document-footer' });
  const status = footer.createSpan({
    text: `${words.toLocaleString()} Wörter · ca. ${estimatedPages(words)} Seite${estimatedPages(words) === 1 ? '' : 'n'}`,
  });
  footer.createSpan({ text: 'Aktualisiert sich während der Antwort' });

  themeButton.addEventListener('click', () => {
    const nextIndex = (THEMES.indexOf(activeTheme) + 1) % THEMES.length;
    card.removeClass(`theme-${activeTheme}`);
    activeTheme = THEMES[nextIndex];
    THEME_OVERRIDES.set(themeKey, activeTheme);
    card.addClass(`theme-${activeTheme}`);
    card.setAttribute('data-theme', activeTheme);
    themeButton.setAttribute('aria-label', `Design: ${THEME_LABELS[activeTheme]}`);
    themeButton.setAttribute('title', `Design: ${THEME_LABELS[activeTheme]}`);
    status.setText(`${THEME_LABELS[activeTheme]} · ${words.toLocaleString()} Wörter · ca. ${estimatedPages(words)} Seite${estimatedPages(words) === 1 ? '' : 'n'}`);
  });

  copyButton.addEventListener('click', () => {
    void navigator.clipboard.writeText(serializeDocument(document, activeTheme)).then(() => {
      copyButton.empty();
      setIcon(copyButton, 'check');
      window.setTimeout(() => {
        copyButton.empty();
        setIcon(copyButton, 'copy');
      }, 1400);
    }).catch(() => new Notice('Dokument konnte nicht kopiert werden.'));
  });

  saveButton.addEventListener('click', () => {
    void saveDocument(context.app, document, activeTheme).then((path) => {
      new Notice(`Dokument gespeichert: ${path}`);
      saveButton.empty();
      setIcon(saveButton, 'check');
      window.setTimeout(() => {
        saveButton.empty();
        setIcon(saveButton, 'save');
      }, 1400);
    }).catch((error) => {
      new Notice(`Dokument konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  expandButton.addEventListener('click', () => {
    void showExpandedDocument(document, activeTheme, context);
  });

  return card;
}

/** Replaces live-document code fences with a designed, streaming document canvas. */
export async function renderLiveDocuments(
  root: HTMLElement,
  markdown: string,
  context: LiveDocumentRenderContext,
): Promise<boolean> {
  const blocks = parseLiveDocumentBlocks(markdown);
  const codeBlocks = Array.from(root.querySelectorAll(
    'pre code.language-claudian-document, pre code.language-live-document',
  ));
  let rendered = false;

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block.liveDocument) continue;
    const code = codeBlocks[index];
    const pre = code?.closest('pre');
    if (pre?.parentElement) {
      const doc = root.ownerDocument ?? window.document;
      const host = doc.createElement('div');
      pre.parentElement.replaceChild(host, pre);
      await renderLiveDocument(host, block.liveDocument, context);
      rendered = true;
    } else if (!block.closed) {
      await renderLiveDocument(root, block.liveDocument, context);
      rendered = true;
    }
  }
  return rendered;
}
