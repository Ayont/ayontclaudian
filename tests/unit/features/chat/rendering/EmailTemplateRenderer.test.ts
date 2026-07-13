/** @jest-environment jsdom */

import {
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

  it('renders subject, type, recipient, and actions', async () => {
    const root = document.createElement('div');
    const email = parseEmailTemplate([
      '---',
      'subject: Angebot für [Projekt]',
      'to: "[Name]"',
      'template: sales',
      '---',
      'Hallo [Name],',
      '',
      'gerne sende ich Ihnen unser Angebot.',
    ].join('\n'))!;

    await renderEmailTemplate(root, email, createContext());

    expect(root.querySelector('.claudian-email-template.template-sales')).not.toBeNull();
    expect(root.querySelector('.claudian-email-field h3')?.textContent).toBe('Angebot für [Projekt]');
    expect(root.querySelector('.claudian-email-kind')?.textContent).toBe('Vertrieb');
    expect(root.querySelector('.claudian-email-recipient')?.textContent).toBe('[Name]');
    expect(root.querySelectorAll('.claudian-email-action')).toHaveLength(3);
  });

  it('replaces a rendered email fence with the designed card', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<pre><code class="language-claudian-email">email</code></pre>';
    const markdown = [
      '```claudian-email',
      '---',
      'subject: Support-Antwort',
      'template: support',
      '---',
      'Hallo, wir kümmern uns darum.',
      '```',
    ].join('\n');

    expect(await renderEmailTemplates(root, markdown, createContext())).toBe(true);
    expect(root.querySelector('pre')).toBeNull();
    expect(root.querySelector('.claudian-email-template.template-support')).not.toBeNull();
  });
});
