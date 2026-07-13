import type { App, Component } from 'obsidian';
import { MarkdownRenderer, Notice, setIcon } from 'obsidian';

export type EmailTemplateKind =
  | 'concise'
  | 'business'
  | 'friendly'
  | 'follow-up'
  | 'sales'
  | 'support';

export interface EmailTemplate {
  subject: string;
  recipient?: string;
  sender?: string;
  preheader?: string;
  kind: EmailTemplateKind;
  body: string;
}

export interface EmailTemplateBlock {
  content: string;
  closed: boolean;
  template: EmailTemplate | null;
}

interface EmailTemplateRenderContext {
  app: App;
  component: Component;
}

const EMAIL_FOLDER = '.claudian/email-templates';
const TEMPLATE_KINDS: EmailTemplateKind[] = [
  'concise',
  'business',
  'friendly',
  'follow-up',
  'sales',
  'support',
];

const TEMPLATE_LABELS: Record<EmailTemplateKind, string> = {
  concise: 'Kurz & direkt',
  business: 'Geschäftlich',
  friendly: 'Freundlich',
  'follow-up': 'Follow-up',
  sales: 'Vertrieb',
  support: 'Support',
};

function sanitizeMetaValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').slice(0, 240);
}

function isTemplateKind(value: string): value is EmailTemplateKind {
  return TEMPLATE_KINDS.includes(value as EmailTemplateKind);
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

export function parseEmailTemplate(content: string): EmailTemplate | null {
  const { metadata, body } = parseMetadata(content);
  if (!body.trim()) return null;

  const requestedKind = (metadata.template ?? metadata.kind ?? metadata.type ?? '').toLowerCase();
  return {
    subject: sanitizeMetaValue(metadata.subject ?? metadata.betreff ?? 'E-Mail ohne Betreff'),
    recipient: metadata.to ?? metadata.recipient ?? metadata.an,
    sender: metadata.from ?? metadata.sender ?? metadata.von,
    preheader: metadata.preheader,
    kind: isTemplateKind(requestedKind) ? requestedKind : 'concise',
    body,
  };
}

/** Parses complete and still-streaming email fences. */
export function parseEmailTemplateBlocks(markdown: string): EmailTemplateBlock[] {
  const blocks: EmailTemplateBlock[] = [];
  const opening = /(`{3,})(?:claudian-email|email-template)\s*\n/gi;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(markdown)) !== null) {
    const fence = match[1];
    const start = opening.lastIndex;
    const end = markdown.indexOf(fence, start);
    const closed = end >= 0;
    const content = markdown.slice(start, closed ? end : markdown.length).trim();
    blocks.push({ content, closed, template: parseEmailTemplate(content) });
    if (!closed) break;
    opening.lastIndex = end + fence.length;
  }
  return blocks;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56) || `email-${Date.now()}`;
}

function wordCount(body: string): number {
  const plain = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`()]/g, ' ')
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .trim();
  return plain ? plain.split(/\s+/).length : 0;
}

function serializeEmailTemplate(template: EmailTemplate): string {
  return [
    '---',
    `subject: ${JSON.stringify(template.subject)}`,
    ...(template.recipient ? [`to: ${JSON.stringify(template.recipient)}`] : []),
    ...(template.sender ? [`from: ${JSON.stringify(template.sender)}`] : []),
    ...(template.preheader ? [`preheader: ${JSON.stringify(template.preheader)}`] : []),
    `template: ${template.kind}`,
    'created_by: ayontclaudian',
    '---',
    '',
    template.body.trim(),
    '',
  ].join('\n');
}

function plainEmailText(template: EmailTemplate): string {
  return [
    ...(template.recipient ? [`An: ${template.recipient}`] : []),
    `Betreff: ${template.subject}`,
    '',
    template.body.trim(),
  ].join('\n');
}

async function ensureEmailFolder(app: App): Promise<void> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists('.claudian'))) await adapter.mkdir('.claudian');
  if (!(await adapter.exists(EMAIL_FOLDER))) await adapter.mkdir(EMAIL_FOLDER);
}

async function saveEmailTemplate(app: App, template: EmailTemplate): Promise<string> {
  await ensureEmailFolder(app);
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  const base = `${EMAIL_FOLDER}/${slugify(template.subject)}-${stamp}`;
  let path = `${base}.md`;
  let suffix = 2;
  while (await app.vault.adapter.exists(path)) path = `${base}-${suffix++}.md`;
  await app.vault.adapter.write(path, serializeEmailTemplate(template));
  return path;
}

function createIconButton(
  parent: HTMLElement,
  icon: string,
  label: string,
): HTMLButtonElement {
  const button = parent.createEl('button', {
    cls: 'claudian-email-action',
    attr: { type: 'button', 'aria-label': label, title: label },
  });
  setIcon(button.createSpan(), icon);
  return button;
}

function flashSuccess(button: HTMLButtonElement, originalIcon: string): void {
  button.empty();
  setIcon(button, 'check');
  window.setTimeout(() => {
    button.empty();
    setIcon(button, originalIcon);
  }, 1400);
}

function highlightPlaceholders(root: HTMLElement): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (/\[[^\]\n]{2,80}\]/.test(node.data)) nodes.push(node);
  }

  for (const node of nodes) {
    const fragment = root.ownerDocument.createDocumentFragment();
    const parts = node.data.split(/(\[[^\]\n]{2,80}\])/g);
    for (const part of parts) {
      if (/^\[[^\]\n]{2,80}\]$/.test(part)) {
        const mark = root.ownerDocument.createElement('mark');
        mark.className = 'claudian-email-placeholder';
        mark.textContent = part;
        fragment.appendChild(mark);
      } else if (part) {
        fragment.appendChild(root.ownerDocument.createTextNode(part));
      }
    }
    node.parentNode?.replaceChild(fragment, node);
  }
}

export async function renderEmailTemplate(
  container: HTMLElement,
  template: EmailTemplate,
  context: EmailTemplateRenderContext,
): Promise<HTMLElement> {
  const card = container.createDiv({
    cls: `claudian-email-template template-${template.kind}`,
  });

  const toolbar = card.createDiv({ cls: 'claudian-email-toolbar' });
  const identity = toolbar.createDiv({ cls: 'claudian-email-identity' });
  const icon = identity.createSpan({ cls: 'claudian-email-icon' });
  setIcon(icon, 'mail');
  identity.createSpan({ cls: 'claudian-email-label', text: 'E-Mail-Vorlage' });
  identity.createSpan({
    cls: 'claudian-email-kind',
    text: TEMPLATE_LABELS[template.kind],
  });

  const actions = toolbar.createDiv({ cls: 'claudian-email-actions' });
  const subjectButton = createIconButton(actions, 'text-cursor-input', 'Nur Betreff kopieren');
  const copyButton = createIconButton(actions, 'copy', 'Komplette E-Mail kopieren');
  const saveButton = createIconButton(actions, 'save', 'Vorlage im Vault speichern');

  const sheet = card.createDiv({ cls: 'claudian-email-sheet' });
  if (template.recipient) {
    const recipient = sheet.createDiv({ cls: 'claudian-email-field' });
    recipient.createSpan({ cls: 'claudian-email-field-label', text: 'AN' });
    recipient.createSpan({ cls: 'claudian-email-recipient', text: template.recipient });
  }
  const subject = sheet.createDiv({ cls: 'claudian-email-field is-subject' });
  subject.createSpan({ cls: 'claudian-email-field-label', text: 'BETREFF' });
  subject.createEl('h3', { text: template.subject });
  if (template.preheader) {
    const preheader = sheet.createDiv({ cls: 'claudian-email-preheader' });
    preheader.createSpan({ text: 'Vorschautext' });
    preheader.createEl('p', { text: template.preheader });
  }

  const body = sheet.createDiv({ cls: 'claudian-email-body' });
  await MarkdownRenderer.render(context.app, template.body, body, '', context.component);
  highlightPlaceholders(body);

  const footer = card.createDiv({ cls: 'claudian-email-footer' });
  footer.createSpan({
    text: `${wordCount(template.body).toLocaleString()} Wörter · ${TEMPLATE_LABELS[template.kind]}`,
  });
  footer.createSpan({ text: 'Platzhalter sind markiert' });

  subjectButton.addEventListener('click', () => {
    void navigator.clipboard.writeText(template.subject)
      .then(() => flashSuccess(subjectButton, 'text-cursor-input'))
      .catch(() => new Notice('Betreff konnte nicht kopiert werden.'));
  });
  copyButton.addEventListener('click', () => {
    void navigator.clipboard.writeText(plainEmailText(template))
      .then(() => flashSuccess(copyButton, 'copy'))
      .catch(() => new Notice('Mail konnte nicht kopiert werden.'));
  });
  saveButton.addEventListener('click', () => {
    void saveEmailTemplate(context.app, template).then((path) => {
      new Notice(`E-Mail-Vorlage gespeichert: ${path}`);
      flashSuccess(saveButton, 'save');
    }).catch((error) => {
      new Notice(`E-Mail-Vorlage konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  return card;
}

/** Replaces email-template code fences with compact, designed mail cards. */
export async function renderEmailTemplates(
  root: HTMLElement,
  markdown: string,
  context: EmailTemplateRenderContext,
): Promise<boolean> {
  const blocks = parseEmailTemplateBlocks(markdown);
  const codeBlocks = Array.from(root.querySelectorAll(
    'pre code.language-claudian-email, pre code.language-email-template',
  ));
  let rendered = false;

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block.template) continue;
    const code = codeBlocks[index];
    const pre = code?.closest('pre');
    if (pre?.parentElement) {
      const host = root.ownerDocument.createElement('div');
      pre.parentElement.replaceChild(host, pre);
      await renderEmailTemplate(host, block.template, context);
      rendered = true;
    } else if (!block.closed) {
      await renderEmailTemplate(root, block.template, context);
      rendered = true;
    }
  }
  return rendered;
}
