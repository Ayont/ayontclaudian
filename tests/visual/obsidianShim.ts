/**
 * Browser stand-in for the `obsidian` module so the visual harness can run the
 * REAL todo renderers (StatusPanel, ToolCallRenderer) instead of a hand-copied
 * fixture that drifts from the code. Only what those modules touch at runtime
 * is implemented; the rest are inert placeholders so the bundle links.
 */

type DomInfo = { cls?: string | string[]; text?: string; attr?: Record<string, string> };

// Lucide paths (same set Obsidian ships), stroke 2 on a 24px grid.
const ICONS: Record<string, string> = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

function applyInfo(el: HTMLElement, info?: DomInfo | string): void {
  if (!info) return;
  if (typeof info === 'string') {
    el.className = info;
    return;
  }
  if (info.cls) {
    const classes = Array.isArray(info.cls) ? info.cls : info.cls.split(/\s+/);
    el.classList.add(...classes.filter(Boolean));
  }
  if (info.text !== undefined) el.textContent = info.text;
  for (const [name, value] of Object.entries(info.attr ?? {})) el.setAttribute(name, value);
}

function install(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (proto.createDiv) return;
  proto.createEl = function createEl(this: HTMLElement, tag: string, info?: DomInfo | string) {
    const el = this.ownerDocument.createElement(tag);
    applyInfo(el, info);
    this.appendChild(el);
    return el;
  };
  proto.createDiv = function createDiv(this: HTMLElement, info?: DomInfo | string) {
    return (this as unknown as { createEl: (tag: string, info?: DomInfo | string) => HTMLElement }).createEl('div', info);
  };
  proto.createSpan = function createSpan(this: HTMLElement, info?: DomInfo | string) {
    return (this as unknown as { createEl: (tag: string, info?: DomInfo | string) => HTMLElement }).createEl('span', info);
  };
  proto.empty = function empty(this: HTMLElement) {
    this.replaceChildren();
  };
  proto.setText = function setText(this: HTMLElement, text: string) {
    this.textContent = text;
  };
  proto.appendText = function appendText(this: HTMLElement, text: string) {
    this.append(text);
  };
  proto.addClass = function addClass(this: HTMLElement, ...classes: string[]) {
    this.classList.add(...classes.flatMap((cls) => cls.split(/\s+/)).filter(Boolean));
  };
  proto.removeClass = function removeClass(this: HTMLElement, ...classes: string[]) {
    this.classList.remove(...classes.flatMap((cls) => cls.split(/\s+/)).filter(Boolean));
  };
  proto.toggleClass = function toggleClass(this: HTMLElement, cls: string, value?: boolean) {
    this.classList.toggle(cls, value);
  };
  proto.hasClass = function hasClass(this: HTMLElement, cls: string) {
    return this.classList.contains(cls);
  };
  proto.setAttr = function setAttr(this: HTMLElement, name: string, value: string) {
    this.setAttribute(name, value);
  };
}

install();

export function setIcon(el: HTMLElement, name: string): void {
  el.replaceChildren();
  const body = ICONS[name];
  if (!body) return;
  el.insertAdjacentHTML(
    'beforeend',
    `<svg xmlns="http://www.w3.org/2000/svg" class="svg-icon lucide-${name}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
  );
}

export function setTooltip(): void {}

export class Notice {
  constructor(_message?: unknown) {}
  hide(): void {}
}

export class Menu {
  addItem(): this { return this; }
  addSeparator(): this { return this; }
  showAtMouseEvent(): void {}
  showAtPosition(): void {}
}

export class Modal {}
export class Component {}
export class TFile {}
export class TFolder {}
export const Platform = { isDesktop: true, isMobile: false, isMacOS: true };
export const MarkdownRenderer = { render: async (): Promise<void> => undefined };
export function normalizePath(value: string): string {
  return value;
}
