import { type App,normalizePath, Notice, requestUrl, setIcon } from 'obsidian';

interface InlineImageSpec {
  title: string;
  prompt: string;
  src: string;
  alt: string;
  provider: string;
}

function field(source: string, key: string): string {
  const match = source.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'mi'));
  return match?.[1]?.trim() ?? '';
}

export function parseInlineImage(source: string): InlineImageSpec | null {
  const body = source.replace(/^---\s*|\s*---$/g, '').trim();
  const src = field(body, 'path') || field(body, 'src') || field(body, 'url');
  if (!src) return null;
  return {
    title: field(body, 'title') || 'Generiertes Bild',
    prompt: field(body, 'prompt'),
    src,
    alt: field(body, 'alt') || field(body, 'title') || 'Generiertes Bild',
    provider: field(body, 'provider') || 'Image generation',
  };
}

function resourceUrl(app: App, src: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(src)) return src;
  return app.vault.adapter.getResourcePath(normalizePath(src.replace(/^@/, '')));
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  const parts = normalizePath(folder).split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await app.vault.adapter.exists(current))) await app.vault.adapter.mkdir(current);
  }
}

async function saveRemoteImage(app: App, spec: InlineImageSpec, mediaFolder: string): Promise<string> {
  if (!/^https?:/i.test(spec.src)) return spec.src.replace(/^@/, '');
  const response = await requestUrl({ url: spec.src });
  const type = response.headers['content-type'] ?? 'image/png';
  const extension = type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png';
  const safe = spec.title.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '') || 'generated-image';
  await ensureFolder(app, mediaFolder);
  const path = normalizePath(`${mediaFolder}/${safe}-${Date.now()}.${extension}`);
  await app.vault.adapter.writeBinary(path, response.arrayBuffer);
  return path;
}

function action(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
  const button = parent.createEl('button', { cls: 'claudian-inline-image-action', attr: { 'aria-label': label } });
  setIcon(button, icon);
  button.addEventListener('click', onClick);
}

export function renderInlineImages(
  root: HTMLElement,
  app: App,
  options: { mediaFolder?: string } = {},
): void {
  const blocks = Array.from(root.querySelectorAll('pre code.language-claudian-image'));
  for (const code of blocks) {
    const spec = parseInlineImage(code.textContent ?? '');
    const pre = code.closest('pre');
    if (!spec || !pre?.parentElement) continue;

    const card = createDiv({ cls: 'claudian-inline-image' });
    const header = card.createDiv({ cls: 'claudian-inline-image-header' });
    const identity = header.createDiv({ cls: 'claudian-inline-image-identity' });
    const icon = identity.createSpan();
    setIcon(icon, 'image');
    const labels = identity.createDiv();
    labels.createDiv({ cls: 'claudian-inline-image-title', text: spec.title });
    labels.createDiv({ cls: 'claudian-inline-image-provider', text: spec.provider });
    const actions = header.createDiv({ cls: 'claudian-inline-image-actions' });
    action(actions, 'copy', 'Prompt kopieren', () => {
      void navigator.clipboard.writeText(spec.prompt || spec.src);
      new Notice('Bildprompt kopiert.');
    });
    action(actions, 'save', 'Bild im Vault speichern', () => {
      void saveRemoteImage(app, spec, options.mediaFolder || 'attachments')
        .then((path) => new Notice(`Bild gespeichert: ${path}`))
        .catch((error) => new Notice(`Bild konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`));
    });

    const figure = card.createEl('figure', { cls: 'claudian-inline-image-figure' });
    const image = figure.createEl('img', { attr: { src: resourceUrl(app, spec.src), alt: spec.alt, loading: 'lazy' } });
    image.addEventListener('click', () => window.open(resourceUrl(app, spec.src), '_blank'));
    if (spec.prompt) figure.createEl('figcaption', { text: spec.prompt });
    pre.parentElement.replaceChild(card, pre);
  }
}
