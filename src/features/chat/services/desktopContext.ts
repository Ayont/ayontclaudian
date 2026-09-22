import { createHash, randomUUID } from 'crypto';
import type { TFile } from 'obsidian';

export type DesktopContextSource = DesktopSelectedText | { kind: 'note-file'; file: TFile };

export interface DesktopSelectedText {
  kind: 'note' | 'selection' | 'text';
  /** Local approval label only; never placed in the manifest or page result. */
  label: string;
  text: string;
}
export interface DesktopContextPage {
  pageId: string;
  data: string;
  offset: number;
  total: number;
  sha256: string;
  nextPageId: string | null;
}
export interface DesktopContextApproval {
  turnId: string;
  label: string;
  page: Readonly<DesktopContextPage>;
}

/** Pure in-memory adapter: caller supplies only explicitly selected snapshots.
 * No vault enumeration, file reads, transport, persistence or implicit approval.
 */
export class DesktopContextSnapshot {
  private pages = new Map<string, { page: Readonly<DesktopContextPage>; label: string }>();
  private items: { kind: DesktopSelectedText['kind']; utf16Length: number; sha256: string; firstPageId: string }[] = [];
  private disposed = false;

  constructor(private readonly turnId: string, inputs: readonly DesktopSelectedText[]) {
    if (!turnId || turnId.length > 128 || inputs.length > 4 || inputs.reduce((n, item) => n + Buffer.byteLength(item.text, 'utf8'), 0) > 65536) {
      throw new Error('Auswahlkontext zu groß: höchstens 4 Einträge / 64 KiB UTF-8. Nichts gekürzt.');
    }
    for (const input of inputs) {
      if (!['note', 'selection', 'text'].includes(input.kind) || input.label.length > 512) throw new Error('Ungültiger Auswahlkontext.');
      const sha256 = createHash('sha256').update(input.text, 'utf8').digest('hex');
      let offset = 0;
      let pageId = randomUUID();
      this.items.push({ kind: input.kind, utf16Length: input.text.length, sha256, firstPageId: pageId });
      do {
        let end = Math.min(input.text.length, offset + 500);
        const nextId = randomUUID();
        let page: DesktopContextPage;
        do {
          // Never split a surrogate pair, including when JSON escaping shrinks a page.
          if (end > offset && end < input.text.length && /[\uD800-\uDBFF]/.test(input.text[end - 1]) && /[\uDC00-\uDFFF]/.test(input.text[end])) end--;
          page = { pageId, data: input.text.slice(offset, end), offset, total: input.text.length, sha256, nextPageId: end < input.text.length ? nextId : null };
          if (JSON.stringify(page).length <= 900) break;
          end--;
        } while (end > offset);
        if (JSON.stringify(page).length > 900 || (end === offset && offset < input.text.length)) throw new Error('Kontextseite überschreitet Transportbudget.');
        this.pages.set(pageId, { page: Object.freeze(page), label: input.label });
        offset = end;
        pageId = nextId;
      } while (offset < input.text.length);
    }
  }

  manifest() {
    this.check();
    // Fresh copies prevent external mutation; opaque ids avoid disclosing paths.
    return { items: this.items.map(item => ({ ...item })) };
  }

  async readPage(pageId: string, approve: (details: DesktopContextApproval) => Promise<boolean>, signal: AbortSignal, allowed: () => boolean): Promise<Readonly<DesktopContextPage>> {
    const check = () => {
      this.check();
      if (signal.aborted || !allowed()) throw new Error('Kontextfreigabe widerrufen/abgebrochen.');
    };
    check();
    const entry = this.pages.get(pageId);
    if (!entry) throw new Error('Unbekannte Kontextseite für diese Anfrage.');
    let abort: (() => void) | undefined;
    try {
      const canceled = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new Error('Kontextfreigabe abgebrochen.'));
        signal.addEventListener('abort', abort, { once: true });
      });
      const decision = await Promise.race([Promise.resolve().then(() => { check(); return approve({ turnId: this.turnId, label: entry.label, page: entry.page }); }), canceled]);
      check();
      if (decision !== true) throw new Error('Kontextübertragung abgelehnt.');
      return entry.page;
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
    }
  }

  /** Call in turn finally, on cancellation, provider switch and permission revocation. */
  dispose(): void {
    this.disposed = true;
    this.pages.clear();
    this.items = [];
  }

  private check(): void {
    if (this.disposed) throw new Error('Auswahlkontext ist nicht mehr verfügbar.');
  }
}
