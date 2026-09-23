import { Notice } from 'obsidian';

type NoticeDocument = Pick<Document, 'createElement' | 'createDocumentFragment'>;

function currentDocument(): NoticeDocument | null {
  return typeof activeDocument !== 'undefined' ? activeDocument : null;
}

/**
 * A notice with one action (e.g. "Rückgängig"). The action runs at most once:
 * a double click on undo must not restore twice.
 */
export function showActionNotice(
  message: string,
  actionLabel: string,
  onAction: () => void,
  durationMs = 10_000,
): void {
  const doc = currentDocument();
  if (!doc) {
    new Notice(message, durationMs);
    return;
  }

  const fragment = doc.createDocumentFragment();
  const text = doc.createElement('span');
  text.textContent = `${message} `;
  const button = doc.createElement('button');
  button.className = 'claudian-notice-action mod-cta';
  button.textContent = actionLabel;
  fragment.append(text, button);

  const notice = new Notice(fragment, durationMs);
  let done = false;
  button.addEventListener('click', () => {
    if (done) return;
    done = true;
    notice.hide();
    onAction();
  });
}
