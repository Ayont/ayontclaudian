import type { App, Component } from 'obsidian';
import { Notice, setIcon } from 'obsidian';

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
  support: 'Support / Ticket',
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

/** Turns accidental provider Markdown into copy-ready plain email text. */
export function emailBodyToPlainText(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .replace(/^```[^\n]*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[ \t]*[*+][ \t]+/gm, '- ')
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
  const plain = emailBodyToPlainText(body).trim();
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
    emailBodyToPlainText(template.body),
    '',
  ].join('\n');
}

function plainEmailText(template: EmailTemplate): string {
  return [
    ...(template.recipient ? [`An: ${template.recipient}`] : []),
    `Betreff: ${template.subject}`,
    '',
    emailBodyToPlainText(template.body),
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

function flashIconSuccess(button: HTMLButtonElement, originalIcon: string): void {
  button.empty();
  setIcon(button, 'check');
  window.setTimeout(() => {
    button.empty();
    setIcon(button, originalIcon);
  }, 1400);
}

function createPrimaryCopyButton(parent: HTMLElement): HTMLButtonElement {
  const button = parent.createEl('button', {
    cls: 'claudian-email-copy-primary',
    attr: { type: 'button', 'aria-label': 'Aktive Mail komplett kopieren' },
  });
  const icon = button.createSpan({ cls: 'claudian-email-copy-primary-icon' });
  setIcon(icon, 'copy');
  button.createSpan({ cls: 'claudian-email-copy-primary-label', text: 'Mail kopieren' });
  return button;
}

function flashPrimarySuccess(button: HTMLButtonElement): void {
  const icon = button.querySelector('.claudian-email-copy-primary-icon');
  const label = button.querySelector('.claudian-email-copy-primary-label');
  if (icon instanceof HTMLElement) {
    icon.empty();
    setIcon(icon, 'check');
  }
  label?.setText('Kopiert');
  window.setTimeout(() => {
    if (icon instanceof HTMLElement) {
      icon.empty();
      setIcon(icon, 'copy');
    }
    label?.setText('Mail kopieren');
  }, 1400);
}

function cloneAsPlainTemplate(template: EmailTemplate): EmailTemplate {
  return {
    ...template,
    body: emailBodyToPlainText(template.body),
  };
}

function buildTabLabels(templates: EmailTemplate[]): string[] {
  const totals = new Map<EmailTemplateKind, number>();
  const seen = new Map<EmailTemplateKind, number>();
  for (const template of templates) totals.set(template.kind, (totals.get(template.kind) ?? 0) + 1);
  return templates.map((template) => {
    const number = (seen.get(template.kind) ?? 0) + 1;
    seen.set(template.kind, number);
    const base = TEMPLATE_LABELS[template.kind];
    return (totals.get(template.kind) ?? 0) > 1 ? `${base} ${number}` : base;
  });
}

export async function renderEmailTemplateWorkspace(
  container: HTMLElement,
  sourceTemplates: EmailTemplate[],
  context: EmailTemplateRenderContext,
): Promise<HTMLElement> {
  const drafts = sourceTemplates.map(cloneAsPlainTemplate);
  let activeIndex = 0;
  let activeKind = drafts[0].kind;
  const labels = buildTabLabels(drafts);

  const card = container.createDiv({
    cls: `claudian-email-template template-${activeKind}`,
  });

  const toolbar = card.createDiv({ cls: 'claudian-email-toolbar' });
  const identity = toolbar.createDiv({ cls: 'claudian-email-identity' });
  const icon = identity.createSpan({ cls: 'claudian-email-icon' });
  setIcon(icon, 'mails');
  identity.createSpan({ cls: 'claudian-email-label', text: 'E-Mail-Editor' });
  const counter = identity.createSpan({
    cls: 'claudian-email-kind',
    text: `${labels[0]} · 1/${drafts.length}`,
  });

  const actions = toolbar.createDiv({ cls: 'claudian-email-actions' });
  const selectButton = createIconButton(actions, 'text-select', 'Mailtext vollständig markieren');
  const saveButton = createIconButton(actions, 'save', 'Aktive Vorlage im Vault speichern');
  const copyButton = createPrimaryCopyButton(actions);

  const tabs = card.createDiv({
    cls: 'claudian-email-tabs',
    attr: { role: 'tablist', 'aria-label': 'E-Mail-Variante auswählen' },
  });
  const tabButtons = drafts.map((template, index) => {
    const button = tabs.createEl('button', {
      cls: `claudian-email-tab${index === 0 ? ' is-active' : ''}`,
      text: labels[index],
      attr: {
        type: 'button',
        role: 'tab',
        'aria-selected': index === 0 ? 'true' : 'false',
        'data-kind': template.kind,
      },
    });
    return button;
  });

  const editor = card.createDiv({ cls: 'claudian-email-editor' });
  const recipientRow = editor.createDiv({ cls: 'claudian-email-editor-row' });
  recipientRow.createEl('label', { text: 'An' });
  const recipientInput = recipientRow.createEl('input', {
    cls: 'claudian-email-input',
    attr: {
      type: 'text',
      placeholder: '[Empfänger]',
      autocomplete: 'off',
      'aria-label': 'Empfänger',
    },
  });

  const subjectRow = editor.createDiv({ cls: 'claudian-email-editor-row is-subject' });
  subjectRow.createEl('label', { text: 'Betreff' });
  const subjectInput = subjectRow.createEl('input', {
    cls: 'claudian-email-input claudian-email-subject-input',
    attr: {
      type: 'text',
      placeholder: 'Betreff eingeben',
      autocomplete: 'off',
      'aria-label': 'Betreff',
    },
  });

  const textLabel = editor.createDiv({ cls: 'claudian-email-text-label' });
  textLabel.createSpan({ text: 'MAILTEXT' });
  textLabel.createSpan({ text: 'Klartext · direkt bearbeitbar' });
  const bodyInput = editor.createEl('textarea', {
    cls: 'claudian-email-body-input',
    attr: {
      rows: '12',
      spellcheck: 'true',
      'aria-label': 'E-Mail-Text',
    },
  });

  const footer = card.createDiv({ cls: 'claudian-email-footer' });
  const stats = footer.createSpan();
  footer.createSpan({ text: 'Änderungen bleiben beim Wechsel der Varianten erhalten' });

  const syncDraft = () => {
    const draft = drafts[activeIndex];
    draft.recipient = recipientInput.value.trim() || undefined;
    draft.subject = subjectInput.value;
    draft.body = bodyInput.value;
  };

  const renderDraft = (index: number) => {
    activeIndex = index;
    const draft = drafts[index];
    card.removeClass(`template-${activeKind}`);
    activeKind = draft.kind;
    card.addClass(`template-${activeKind}`);
    recipientInput.value = draft.recipient ?? '';
    subjectInput.value = draft.subject;
    bodyInput.value = draft.body;
    counter.setText(`${labels[index]} · ${index + 1}/${drafts.length}`);
    stats.setText(`${wordCount(draft.body).toLocaleString()} Wörter · ${labels[index]}`);
    tabButtons.forEach((button, buttonIndex) => {
      const selected = buttonIndex === index;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  };

  tabButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      if (index === activeIndex) return;
      syncDraft();
      renderDraft(index);
    });
  });

  recipientInput.addEventListener('input', syncDraft);
  subjectInput.addEventListener('input', syncDraft);
  bodyInput.addEventListener('input', () => {
    syncDraft();
    stats.setText(`${wordCount(bodyInput.value).toLocaleString()} Wörter · ${labels[activeIndex]}`);
  });

  selectButton.addEventListener('click', () => {
    bodyInput.focus();
    bodyInput.select();
  });
  copyButton.addEventListener('click', () => {
    syncDraft();
    void navigator.clipboard.writeText(plainEmailText(drafts[activeIndex]))
      .then(() => flashPrimarySuccess(copyButton))
      .catch(() => new Notice('Mail konnte nicht kopiert werden.'));
  });
  saveButton.addEventListener('click', () => {
    syncDraft();
    void saveEmailTemplate(context.app, drafts[activeIndex]).then((path) => {
      new Notice(`E-Mail-Vorlage gespeichert: ${path}`);
      flashIconSuccess(saveButton, 'save');
    }).catch((error) => {
      new Notice(`E-Mail-Vorlage konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  renderDraft(0);
  return card;
}

export async function renderEmailTemplate(
  container: HTMLElement,
  template: EmailTemplate,
  context: EmailTemplateRenderContext,
): Promise<HTMLElement> {
  return renderEmailTemplateWorkspace(container, [template], context);
}

/** Groups every email fence in one selectable, plain-text editor. */
export async function renderEmailTemplates(
  root: HTMLElement,
  markdown: string,
  context: EmailTemplateRenderContext,
): Promise<boolean> {
  const blocks = parseEmailTemplateBlocks(markdown);
  const templates = blocks
    .map((block) => block.template)
    .filter((template): template is EmailTemplate => template !== null);
  if (templates.length === 0) return false;

  const codeBlocks = Array.from(root.querySelectorAll(
    'pre code.language-claudian-email, pre code.language-email-template',
  ));
  const pres = codeBlocks
    .map((code) => code.closest('pre'))
    .filter((pre): pre is HTMLPreElement => pre !== null);
  const firstPre = pres[0];

  if (firstPre?.parentElement) {
    const host = root.ownerDocument.createElement('div');
    firstPre.parentElement.replaceChild(host, firstPre);
    for (const pre of pres.slice(1)) pre.remove();
    await renderEmailTemplateWorkspace(host, templates, context);
    return true;
  }

  if (blocks.some((block) => !block.closed)) {
    await renderEmailTemplateWorkspace(root, templates, context);
    return true;
  }
  return false;
}
