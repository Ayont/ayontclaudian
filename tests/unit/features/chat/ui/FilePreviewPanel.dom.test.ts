/** @jest-environment jsdom */

import { setTooltip, TFile } from 'obsidian';

import { FilePreviewPanel } from '@/features/chat/ui/FilePreviewPanel';
import { NavigationSidebar } from '@/features/chat/ui/NavigationSidebar';

function installObsidianDomHelpers(): void {
  const proto = HTMLElement.prototype as any;
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
  proto.createDiv = function createDiv(options?: unknown) { return createChild.call(this, 'div', options as any); };
  proto.createSpan = function createSpan(options?: unknown) { return createChild.call(this, 'span', options as any); };
  proto.createEl = function createEl(tag: string, options?: unknown) { return createChild.call(this, tag, options as any); };
  proto.empty = function empty() { this.replaceChildren(); };
  proto.setText = function setText(value: string) { this.textContent = value; };
  proto.appendText = function appendText(value: string) { this.append(value); };
  proto.addClass = function addClass(...names: string[]) { this.classList.add(...names.flatMap((n) => n.split(/\s+/)).filter(Boolean)); };
  proto.removeClass = function removeClass(...names: string[]) { this.classList.remove(...names); };
  proto.hasClass = function hasClass(name: string) { return this.classList.contains(name); };
  proto.toggleClass = function toggleClass(name: string, force: boolean) { this.classList.toggle(name, force); };
}

function vaultFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split('/').pop() ?? path;
  file.basename = file.name.replace(/\.[^.]+$/, '');
  file.extension = file.name.split('.').pop() ?? '';
  (file as any).stat = { mtime: 1, size: 10 };
  return file;
}

function createPlugin(files: TFile[] = []) {
  return {
    app: {
      workspace: { getLeaf: jest.fn(() => ({ openFile: jest.fn() })) },
      vault: {
        getFiles: jest.fn(() => files),
        getAbstractFileByPath: jest.fn(() => null),
        cachedRead: jest.fn(async () => ''),
        readBinary: jest.fn(async () => new ArrayBuffer(8)),
        adapter: { getResourcePath: jest.fn((path: string) => `app://vault/${path}`) },
      },
    },
  };
}

function mount(files: TFile[] = []) {
  const wrapper = document.body.appendChild(document.createElement('div'));
  wrapper.className = 'claudian-messages-wrapper';
  const messages = wrapper.appendChild(document.createElement('div'));
  messages.className = 'claudian-messages';
  const nav = new NavigationSidebar(wrapper, messages);
  const panel = new FilePreviewPanel(wrapper, createPlugin(files) as any);
  panel.render();
  return { wrapper, messages, nav, panel };
}

function type(wrapper: HTMLElement, value: string): void {
  const input = wrapper.querySelector<HTMLInputElement>('.claudian-preview-search-input')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('FilePreviewPanel (DOM)', () => {
  beforeAll(installObsidianDomHelpers);
  afterEach(() => document.body.replaceChildren());

  it('highlights every matched substring with <mark> in the original spelling', () => {
    const { wrapper, panel } = mount();
    panel.rememberUpload({ name: 'Größenübersicht Straße.pdf', relPath: 'Projekte/Außendienst/Größenübersicht Straße.pdf' });
    panel.open();

    type(wrapper, 'strasse aussen');

    const row = wrapper.querySelector('.claudian-preview-row')!;
    expect([...row.querySelectorAll('.claudian-preview-row-name mark')].map((m) => m.textContent)).toEqual(['Straße']);
    expect([...row.querySelectorAll('.claudian-preview-row-folder mark')].map((m) => m.textContent)).toEqual(['Außen']);
    expect(row.querySelector('.claudian-preview-row-name')!.textContent).toBe('Größenübersicht Straße.pdf');

    type(wrapper, '');
    expect(row.querySelectorAll('mark')).toHaveLength(0);
  });

  it('shows image thumbnails only for visible rows of an open library', async () => {
    const { wrapper, panel } = mount([vaultFile('Bilder/strand.png'), vaultFile('Bilder/berg.jpg')]);
    await panel.refreshVaultDocuments();

    type(wrapper, 'strand');
    expect(wrapper.querySelectorAll('img.claudian-preview-thumb')).toHaveLength(0);

    panel.open();

    const thumbs = [...wrapper.querySelectorAll<HTMLImageElement>('img.claudian-preview-thumb')];
    expect(thumbs.map((img) => img.getAttribute('src'))).toEqual(['app://vault/Bilder/strand.png']);
    expect(thumbs[0].getAttribute('loading')).toBe('lazy');

    type(wrapper, '');
    expect(wrapper.querySelectorAll('img.claudian-preview-thumb')).toHaveLength(2);
  });

  it('falls back to the format badge when an image cannot be loaded', async () => {
    const { wrapper, panel } = mount([vaultFile('Bilder/kaputt.png')]);
    await panel.refreshVaultDocuments();
    panel.open();

    const media = wrapper.querySelector<HTMLElement>('.claudian-preview-row-media')!;
    media.querySelector('img')!.dispatchEvent(new Event('error'));

    expect(media.querySelector('img')).toBeNull();
    expect(media.querySelector('.claudian-preview-row-icon')).not.toBeNull();
    expect(media.getAttribute('data-thumb')).toBe('failed');
  });

  it('opens a row when its thumbnail is clicked', async () => {
    const { wrapper, panel } = mount([vaultFile('Bilder/strand.png')]);
    await panel.refreshVaultDocuments();
    panel.open();
    const openItem = jest.spyOn(panel as any, 'openItem').mockResolvedValue(undefined);

    wrapper.querySelector<HTMLElement>('img.claudian-preview-thumb')!.click();

    expect(openItem).toHaveBeenCalledTimes(1);
  });

  it('docks the chat arrows beside the open library through the shared container state', () => {
    const { wrapper, panel } = mount();
    const rail = wrapper.querySelector('.claudian-nav-sidebar')!;
    const pill = wrapper.querySelector('.claudian-nav-end-pill')!;
    const docked = '.claudian-preview-open > .claudian-nav-sidebar';

    expect(rail.matches(docked)).toBe(false);
    panel.open();
    expect(rail.matches(docked)).toBe(true);
    expect(pill.matches('.claudian-preview-open > .claudian-nav-end-pill')).toBe(true);
    panel.close();
    expect(rail.matches(docked)).toBe(false);
  });

  it('places arrow tooltips on the side away from the library drawer', () => {
    const { wrapper } = mount();
    const buttons = [...wrapper.querySelectorAll<HTMLElement>('.claudian-nav-btn')];

    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button.getAttribute('title')).toBeNull();
      expect(setTooltip).toHaveBeenCalledWith(button, button.getAttribute('aria-label'), { placement: 'left' });
    }
  });
});
