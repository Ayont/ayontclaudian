/**
 * Claudian - File Link Utilities
 *
 * Detects Obsidian wikilinks [[path/to/file]] in rendered content and makes
 * them clickable to open the file in Obsidian.
 */

import type { App, Component } from 'obsidian';

import { getVaultFileByPath } from './obsidianCompat';
import { getVaultPath } from './path';

/**
 * Regex pattern to match Obsidian wikilinks in text content.
 *
 * Matches:
 * - Standard wikilinks: [[note]] or [[folder/note]]
 * - Wikilinks with display text: [[note|display text]]
 * - Wikilinks with headings: [[note#heading]]
 * - Wikilinks with block references: [[note^block]]
 *
 * Does NOT match image embeds ![[image.png]] (those are handled separately).
 */
const WIKILINK_PATTERN_SOURCE = '(?<!!)\\[\\[([^\\]|#^]+)(?:#[^\\]|]+)?(?:\\^[^\\]|]+)?(?:\\|[^\\]]+)?\\]\\]';

/** Creates a fresh regex instance to avoid global state issues */
function createWikilinkPattern(): RegExp {
  return new RegExp(WIKILINK_PATTERN_SOURCE, 'g');
}

interface WikilinkMatch {
  index: number;
  fullMatch: string;
  linkPath: string;
  linkTarget: string;
  displayText: string;
}

function buildWikilinkMatch(
  fullMatch: string,
  linkPath: string,
  index: number
): WikilinkMatch {
  const pipeIndex = fullMatch.lastIndexOf('|');
  const displayText = pipeIndex > 0 ? fullMatch.slice(pipeIndex + 1, -2) : linkPath;

  return {
    index,
    fullMatch,
    linkPath,
    linkTarget: extractLinkTarget(fullMatch),
    displayText,
  };
}

export function extractLinkTarget(fullMatch: string): string {
  const inner = fullMatch.slice(2, -2);
  const pipeIndex = inner.indexOf('|');
  return pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner;
}

/**
 * Finds all wikilinks in text that exist in the vault.
 * Sorted by index descending for end-to-start processing.
 */
function findWikilinks(app: App, text: string): WikilinkMatch[] {
  const pattern = createWikilinkPattern();
  const matches: WikilinkMatch[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const linkPath = match[1];

    if (!fileExistsInVault(app, linkPath)) continue;

    matches.push(buildWikilinkMatch(fullMatch, linkPath, match.index));
  }

  return matches.sort((a, b) => b.index - a.index);
}

function fileExistsInVault(app: App, linkPath: string): boolean {
  const file = app.metadataCache.getFirstLinkpathDest(linkPath, '');
  if (file) {
    return true;
  }

  const directFile = getVaultFileByPath(app, linkPath);
  if (directFile) {
    return true;
  }

  if (!linkPath.endsWith('.md')) {
    const withExt = getVaultFileByPath(app, linkPath + '.md');
    if (withExt) {
      return true;
    }
  }

  return false;
}

function extractLinkPathFromTarget(linkTarget: string): string {
  const subpathIndex = linkTarget.search(/[#^]/);
  return subpathIndex >= 0 ? linkTarget.slice(0, subpathIndex) : linkTarget;
}

function splitPathAndSubpath(linkTarget: string): { path: string; subpath: string } {
  const subpathIndex = linkTarget.search(/[#^]/);
  if (subpathIndex < 0) {
    return { path: linkTarget, subpath: '' };
  }
  return {
    path: linkTarget.slice(0, subpathIndex),
    subpath: linkTarget.slice(subpathIndex),
  };
}

function stripQuery(linkTarget: string): string {
  const queryIndex = linkTarget.indexOf('?');
  return queryIndex >= 0 ? linkTarget.slice(0, queryIndex) : linkTarget;
}

function isExternalHref(href: string): boolean {
  return /^(?:https?:|mailto:|tel:|obsidian:|app:|command:|javascript:|data:)/i.test(href);
}

function stripFileProtocol(value: string): string {
  if (!/^file:\/\//i.test(value)) {
    return value;
  }
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return value.replace(/^file:\/\//i, '');
  }
}

function normalizeRenderedVaultHref(app: App, rawHref: string | null): string | null {
  const raw = (rawHref ?? '').trim();
  if (!raw || raw.startsWith('#') || isExternalHref(raw)) {
    return null;
  }

  let decoded = stripQuery(raw);
  try {
    decoded = decodeURI(decoded);
  } catch {
    // Keep the raw value when it is not a valid URI-encoded string.
  }

  decoded = stripFileProtocol(decoded).replace(/\\/g, '/');
  const { path: rawPath, subpath } = splitPathAndSubpath(decoded);
  let candidatePath = rawPath.trim();
  if (!candidatePath) {
    return null;
  }

  const vaultPath = getVaultPath(app)?.replace(/\\/g, '/').replace(/\/+$/, '');
  if (vaultPath && candidatePath.startsWith(`${vaultPath}/`)) {
    candidatePath = candidatePath.slice(vaultPath.length + 1);
  }

  // Antigravity and other CLIs sometimes emit vault-relative links with a
  // leading slash: (/02-Projekte/foo.md). Obsidian's openLinkText expects
  // vault-relative paths without that slash.
  candidatePath = candidatePath.replace(/^\.?\//, '');

  if (!candidatePath || !fileExistsInVault(app, candidatePath)) {
    return null;
  }

  return `${candidatePath}${subpath}`;
}

/**
 * Creates a link element for a wikilink.
 * Click handling is done via event delegation in registerFileLinkHandler.
 */
function createWikilink(
  ownerDocument: Document,
  linkTarget: string,
  displayText: string
): HTMLElement {
  const link = ownerDocument.createElement('a');
  link.className = 'claudian-file-link internal-link';
  link.textContent = displayText;
  link.setAttribute('data-href', linkTarget);
  link.setAttribute('href', linkTarget);
  return link;
}

function repairEmptyInternalLink(app: App, link: HTMLAnchorElement): void {
  if ((link.textContent || '').trim()) return;

  const linkTarget = link.dataset.href || link.getAttribute('data-href') || link.getAttribute('href');
  if (!linkTarget) return;

  const linkPath = extractLinkPathFromTarget(linkTarget);
  if (!linkPath || !fileExistsInVault(app, linkPath)) return;

  link.classList.add('claudian-file-link');
  if (!link.dataset.href) {
    link.setAttribute('data-href', linkTarget);
  }
  link.textContent = linkTarget;
}

function repairRenderedVaultLink(app: App, link: HTMLAnchorElement): void {
  if (link.classList.contains('claudian-file-link') || link.classList.contains('internal-link')) {
    repairEmptyInternalLink(app, link);
    return;
  }

  const normalized = normalizeRenderedVaultHref(app, link.getAttribute('data-href') || link.getAttribute('href'));
  if (!normalized) {
    return;
  }

  link.classList.add('claudian-file-link', 'internal-link');
  link.setAttribute('data-href', normalized);
  link.setAttribute('href', normalized);
}

/**
 * Registers a delegated click handler for file links on a container.
 * Should be called once on the messages container.
 * Handles both our custom .claudian-file-link and Obsidian's .internal-link.
 */
export function registerFileLinkHandler(
  app: App,
  container: HTMLElement,
  component: Component
): void {
  component.registerDomEvent(container, 'click', (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    // Handle both our links and Obsidian's internal links
    const link = target.closest('.claudian-file-link, .internal-link') as HTMLAnchorElement;

    if (link) {
      event.preventDefault();
      const linkTarget = link.dataset.href || link.getAttribute('href');
      if (linkTarget) {
        void app.workspace.openLinkText(linkTarget, '', 'tab');
      }
    }
  });
}

function buildFragmentWithLinks(ownerDocument: Document, text: string, matches: WikilinkMatch[]): DocumentFragment {
  const fragment = ownerDocument.createDocumentFragment();
  let currentIndex = text.length;

  for (const { index, fullMatch, linkTarget, displayText } of matches) {
    const endIndex = index + fullMatch.length;

    if (endIndex < currentIndex) {
      fragment.insertBefore(
        ownerDocument.createTextNode(text.slice(endIndex, currentIndex)),
        fragment.firstChild
      );
    }

    fragment.insertBefore(createWikilink(ownerDocument, linkTarget, displayText), fragment.firstChild);
    currentIndex = index;
  }

  if (currentIndex > 0) {
    fragment.insertBefore(
      ownerDocument.createTextNode(text.slice(0, currentIndex)),
      fragment.firstChild
    );
  }

  return fragment;
}

function processTextNode(app: App, node: Text): boolean {
  const text = node.textContent;
  if (!text || !text.includes('[[')) return false;

  const matches = findWikilinks(app, text);
  if (matches.length === 0) return false;

  node.parentNode?.replaceChild(buildFragmentWithLinks(node.ownerDocument, text, matches), node);
  return true;
}

/**
 * Call after MarkdownRenderer.renderMarkdown().
 * Catches wikilinks that remain as raw text after rendering, especially inline code spans.
 */
export function processFileLinks(app: App, container: HTMLElement): void {
  if (!app || !container) return;

  // Repair resolved internal links that rendered as empty anchors and normalize
  // Markdown links that point back into the vault (including Antigravity-style
  // `(/02-Projekte/...)` and absolute vault paths) so delegated Obsidian
  // openLinkText handling can open them reliably.
  container.querySelectorAll('a').forEach((linkEl) => {
    repairRenderedVaultLink(app, linkEl as HTMLAnchorElement);
  });

  // Wikilinks in inline code aren't rendered by Obsidian's MarkdownRenderer
  container.querySelectorAll('code').forEach((codeEl) => {
    if (codeEl.parentElement?.tagName === 'PRE') return;

    const text = codeEl.textContent;
    if (!text || !text.includes('[[')) return;

    const matches = findWikilinks(app, text);
    if (matches.length === 0) return;

    codeEl.textContent = '';
    codeEl.appendChild(buildFragmentWithLinks(container.ownerDocument, text, matches));
  });

  const walker = container.ownerDocument.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const tagName = parent.tagName.toUpperCase();
        if (tagName === 'PRE' || tagName === 'CODE' || tagName === 'A') {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.closest('pre, code, a, .claudian-file-link, .internal-link')) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  // Modifying DOM while walking causes issues, so collect first
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    processTextNode(app, textNode);
  }
}
