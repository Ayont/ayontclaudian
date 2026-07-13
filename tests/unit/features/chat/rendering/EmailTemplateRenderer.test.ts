/** @jest-environment jsdom */

import {
  emailBodyToPlainText,
  parseEmailTemplate,
  parseEmailTemplateBlocks,
  renderEmailTemplate,
  renderEmailTemplates,
} from '@/features/chat/rendering/EmailTemplateRenderer';

function installObsidianDomHelpers(): void {
  const createChild = function createChild(
    this: HTMLElement,
    tag: string,
    options?: { cls?: string; text?: string; attr?: Record<string, string> },
  ) {
    const element = document.createElement(tag);
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    for (const [key, value] of Object.entries(options?.attr ?? {})) element.setAttribute(key, value);
    this.appendChild(element);
    return element;
  };
  (HTMLElement.prototype as any).createDiv = function createDiv(options?: unknown) {
    return createChild.call(this, 'div', options as any);
  };
  (HTMLElement.prototype as any).createSpan = function createSpan(options?: unknown) {
    return createChild.call(this, 'span', options as any);
  };
  (HTMLElement.prototype as any).createEl = function createEl(tag: string, options?: unknown) {
    return createChild.call(this, tag, options as any);
  };
  (HTMLElement.prototype as any).empty = function empty() {
    this.replaceChildren();
    return this;
  };
  (HTMLElement.prototype as any).setText = function setText(value: string) {
    this.textContent = value;
  };
  (HTMLElement.prototype as any).addClass = function addClass(value: string) {
    this.classList.add(value);
  };
  (HTMLElement.prototype as any).removeClass = function removeClass(value: string) {
    this.classList.remove(value);
  };
}

function createContext() {
  return {
    app: {
      vault: {
        adapter: {
          exists: jest.fn().mockResolvedValue(false),
          mkdir: jest.fn().mockResolvedValue(undefined),
          write: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as any,
    component: {} as any,
  };
}

describe('EmailTemplateRenderer', () => {
  beforeAll(() => installObsidianDomHelpers());

  it('parses email metadata and a supported template kind', () => {
    const email = parseEmailTemplate([
      '---',
      'subject: Termin am Donnerstag',
      'to: "[Kunde]"',
      'preheader: Kurze Erinnerung an unseren Termin',
      'template: follow-up',
      '---',
      'Hallo [Name],',
      '',
      'hiermit erinnere ich an unseren Termin.',
    ].join('\n'));

    expect(email).toMatchObject({
      subject: 'Termin am Donnerstag',
      recipient: '[Kunde]',
      preheader: 'Kurze Erinnerung an unseren Termin',
      kind: 'follow-up',
    });
    expect(email?.body).toContain('Hallo [Name]');
  });

  it('falls back to the concise template and supports German metadata aliases', () => {
    const email = parseEmailTemplate([
      '---',
      'betreff: Rückfrage',
      'an: Team',
      'template: unknown',
      '---',
      'Kurze Nachricht.',
    ].join('\n'));

    expect(email).toMatchObject({ subject: 'Rückfrage', recipient: 'Team', kind: 'concise' });
  });

  it('parses multiple blocks and unfinished streaming output', () => {
    const blocks = parseEmailTemplateBlocks([
      '```claudian-email',
      '---',
      'subject: Version A',
      'template: business',
      '---',
      'Text A',
      '```',
      '```claudian-email',
      '---',
      'subject: Version B',
      'template: friendly',
      '---',
      'Text B',
    ].join('\n'));

    expect(blocks).toHaveLength(2);
    expect(blocks[0].closed).toBe(true);
    expect(blocks[1].closed).toBe(false);
    expect(blocks[1].template?.kind).toBe('friendly');
  });

  it('normalizes provider Markdown into copy-ready plain text', () => {
    expect(emailBodyToPlainText([
      '## Antwort',
      '',
      'Hallo **[Name]**,',
      '',
      '> Ihr Ticket ist bearbeitet.',
      '',
      '* [Status öffnen](https://example.com/ticket)',
    ].join('\n'))).toBe([
      'Antwort',
      '',
      'Hallo [Name],',
      '',
      'Ihr Ticket ist bearbeitet.',
      '',
      '- Status öffnen (https://example.com/ticket)',
    ].join('\n'));
  });

  it('renders editable plain-text fields and copy controls', async () => {
    const root = document.createElement('div');
    const email = parseEmailTemplate([
      '---',
      'subject: Angebot für [Projekt]',
      'to: "[Name]"',
      'template: sales',
      '---',
      'Hallo [Name],',
      '',
      'gerne sende ich Ihnen unser **Angebot**.',
    ].join('\n'))!;

    await renderEmailTemplate(root, email, createContext());

    expect(root.querySelector('.claudian-email-template.template-sales')).not.toBeNull();
    expect((root.querySelector('.claudian-email-subject-input') as HTMLInputElement).value)
      .toBe('Angebot für [Projekt]');
    expect((root.querySelector('[aria-label="Empfänger"]') as HTMLInputElement).value).toBe('[Name]');
    expect((root.querySelector('.claudian-email-body-input') as HTMLTextAreaElement).value)
      .toContain('unser Angebot.');
    expect(root.querySelector('.claudian-email-kind')?.textContent).toBe('Vertrieb · 1/1');
    expect(root.querySelectorAll('.claudian-email-action')).toHaveLength(2);
    expect(root.querySelector('.claudian-email-copy-primary')).not.toBeNull();
  });

  it('groups multiple rendered fences into one selectable editor', async () => {
    const root = document.createElement('div');
    root.innerHTML = [
      '<pre><code class="language-claudian-email">email A</code></pre>',
      '<pre><code class="language-claudian-email">email B</code></pre>',
    ].join('');
    const markdown = [
      '```claudian-email',
      '---',
      'subject: Support-Antwort',
      'template: support',
      '---',
      'Hallo, wir kümmern uns darum.',
      '```',
      '```claudian-email',
      '---',
      'subject: Freundliche Antwort',
      'template: friendly',
      '---',
      'Hallo, danke für deine Nachricht.',
      '```',
    ].join('\n');

    expect(await renderEmailTemplates(root, markdown, createContext())).toBe(true);
    expect(root.querySelector('pre')).toBeNull();
    expect(root.querySelector('.claudian-email-template.template-support')).not.toBeNull();
    expect(root.querySelectorAll('.claudian-email-template')).toHaveLength(1);
    expect(root.querySelectorAll('.claudian-email-tab')).toHaveLength(2);

    (root.querySelectorAll('.claudian-email-tab')[1] as HTMLButtonElement).click();
    expect(root.querySelector('.claudian-email-template.template-friendly')).not.toBeNull();
    expect((root.querySelector('.claudian-email-subject-input') as HTMLInputElement).value)
      .toBe('Freundliche Antwort');
  });
});
