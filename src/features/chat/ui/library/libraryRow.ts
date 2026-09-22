import { setIcon } from 'obsidian';

import { renderFileFormatBadge } from '../file-drop/fileFormatIcons';
import { splitHighlight, type TextRange } from './libraryIndex';
import type { LibraryItemDetails } from './libraryItem';
import type { ThumbnailPlan, ThumbnailSlot } from './libraryThumbnails';

export interface LibraryRowActions {
  open: () => void;
  reveal: () => void;
  openExternal: () => void;
  showMenu: (event: MouseEvent) => void;
}

export interface LibraryRowOptions {
  itemId: string;
  details: LibraryItemDetails;
  isLive: boolean;
  isVault: boolean;
  plan: ThumbnailPlan;
  fileManagerName: string;
  actions: LibraryRowActions;
}

export interface LibraryRowView {
  /** List item that is shown, hidden and reordered. */
  readonly el: HTMLElement;
  /** The row's primary control; receives keyboard focus. */
  readonly openEl: HTMLButtonElement;
  readonly thumbnail: ThumbnailSlot;
  setHighlight: (nameRanges: readonly TextRange[], folderRanges: readonly TextRange[]) => void;
}

function renderHighlighted(el: HTMLElement, text: string, ranges: readonly TextRange[]): void {
  el.empty();
  if (ranges.length === 0) {
    el.setText(text);
    return;
  }
  for (const segment of splitHighlight(text, ranges)) {
    if (segment.highlighted) el.createEl('mark', { cls: 'claudian-preview-mark', text: segment.text });
    else el.appendText(segment.text);
  }
}

function rangesKey(ranges: readonly TextRange[]): string {
  return ranges.map(([start, end]) => `${start}-${end}`).join(',');
}

function addAction(
  parent: HTMLElement,
  icon: string,
  label: string,
  run: (event: MouseEvent) => void,
): void {
  // aria-label only: Obsidian renders it as the tooltip; a `title` would add a second one.
  const button = parent.createEl('button', {
    cls: 'claudian-preview-card-btn clickable-icon',
    attr: { type: 'button', 'aria-label': label },
  });
  setIcon(button, icon);
  button.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    run(event);
  });
}

/**
 * One library row: an open button (badge/thumbnail + highlighted name and
 * folder) beside its file actions. Siblings, not nested: a button inside a
 * button is invalid, and its inner controls would be hidden from assistive tech.
 */
export function createLibraryRow(parent: HTMLElement, options: LibraryRowOptions): LibraryRowView {
  const { details, actions } = options;
  const el = parent.createDiv({ cls: `claudian-preview-row claudian-preview-row--${details.kind}` });
  el.setAttribute('role', 'listitem');
  el.setAttribute('data-library-id', options.itemId);

  const liveClasses = options.isLive
    ? ` claudian-preview-card--live${options.isVault ? ' claudian-preview-card--vault' : ''}`
    : '';
  const openEl = el.createEl('button', {
    cls: `claudian-preview-card claudian-preview-row-open${liveClasses}`,
    attr: { type: 'button', 'aria-label': `${details.name} öffnen` },
  }) as HTMLButtonElement;

  const mediaEl = openEl.createSpan({ cls: 'claudian-preview-row-media' });
  mediaEl.setAttribute('data-thumb', options.plan.type === 'none' ? 'none' : 'pending');
  mediaEl.setAttribute('aria-hidden', 'true');
  renderFileFormatBadge(mediaEl.createSpan({ cls: 'claudian-preview-row-icon' }), details.name);

  const text = openEl.createSpan({ cls: 'claudian-preview-row-text' });
  const nameEl = text.createSpan({ cls: 'claudian-preview-card-name claudian-preview-row-name', text: details.name });
  const folderEl = details.folder
    ? text.createSpan({ cls: 'claudian-preview-row-folder', text: details.folder })
    : null;

  const actionsEl = el.createDiv({ cls: 'claudian-preview-card-actions claudian-preview-row-actions' });
  addAction(actionsEl, 'folder', `In ${options.fileManagerName} anzeigen`, actions.reveal);
  addAction(actionsEl, 'external-link', 'In Standard-App öffnen', actions.openExternal);
  addAction(actionsEl, 'more-horizontal', 'Weitere Aktionen', actions.showMenu);

  openEl.addEventListener('click', () => actions.open());
  el.addEventListener('contextmenu', (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    actions.showMenu(event);
  });

  let lastKey = '';
  return {
    el,
    openEl,
    thumbnail: { mediaEl, plan: options.plan },
    setHighlight(nameRanges, folderRanges) {
      const key = `${rangesKey(nameRanges)}|${rangesKey(folderRanges)}`;
      if (key === lastKey) return;
      lastKey = key;
      renderHighlighted(nameEl, details.name, nameRanges);
      if (folderEl) renderHighlighted(folderEl, details.folder, folderRanges);
    },
  };
}
