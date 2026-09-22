import { randomUUID } from 'crypto';

import { type MemoryNote, rankMemoryNotes } from '../../../core/memory/memoryService';
import { DesktopContextSnapshot } from './desktopContext';

export interface KnowledgeApproval {
  readonly operation: 'graph-metadata-local' | 'memory-read-local' | 'metadata-egress' | 'note-read-local';
  readonly turnId: string;
  readonly scope: string;
  readonly paths: readonly string[];
  readonly terms?: readonly string[];
  /** Exact metadata payload proposed for transmission; local operations have none. */
  readonly manifest?: KnowledgeManifest;
}
export interface KnowledgeManifest {
  readonly items: readonly { readonly id: string; readonly path: string }[];
  readonly total: number;
}
export interface DesktopKnowledgeAdapters {
  /** Return only scoped resolvedLinks edges, at most maxEdges; throw on overflow.
   * Source -> target orientation preserves backlinks. No indexing or network. */
  graph(scope: string, maxEdges: number, signal: AbortSignal): Promise<readonly (readonly [string, string])[]>;
  /** Trusted bounded local loader: configured folder ONLY, at most maxNotes.
   * Check canonical identity, permissions and signal BEFORE EACH underlying read.
   * Existing cachedMemoryStore/getNotes or loadMemoryNotes need a guarded adapter;
   * unguarded global loaders cannot enforce this contract. Never starts a cache. */
  memories(folder: string, maxNotes: number, signal: AbortSignal): Promise<MemoryNote[]>;
  /** Resolve canonical vault note identity under root; reject symlinks/escapes,
   * recheck permission at read boundary, bound read to maxUtf16, return RAW text.
   * No arbitrary filesystem fallback. Parsed memory.content is not full text. */
  readNote(path: string, root: string, maxUtf16: number, signal: AbortSignal): Promise<string>;
}
export interface DesktopKnowledgeOptions {
  turnId: string;
  /** Explicit user-selected vault folder, not a model argument or vault root. */
  scope: string;
  /** Explicit independently approved configured memory folder. */
  memoryFolder?: string;
  signal: AbortSignal;
  allowed: () => boolean;
  approve: (request: KnowledgeApproval) => Promise<boolean>;
}

function validPath(path: string, memory = false): boolean {
  if (!path || path.length > 512 || /[\\:%]/u.test(path)
    || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  return path.split('/').every((part, index) => part !== '' && part !== '.' && part !== '..'
    && (!part.startsWith('.') || (memory && index === 0 && part === '.claudian'))
    && !/^(secrets?|credentials?|node_modules)$/i.test(part)
    && !/\.(pem|key|p12)$/i.test(part));
}
function within(path: string, root: string, memory = false): boolean {
  return validPath(path, memory) && path.startsWith(`${root}/`) && path.endsWith('.md');
}

/** Turn-local, provider-neutral, read-only service. No transport or global state.
 * Metadata approval is NOT page approval. Caller must use snapshot.readPage and
 * revalidate provider/turn/permissions immediately before every native send. */
export class DesktopKnowledgeService {
  private readonly controller = new AbortController();
  private readonly records = new Map<string, { id: string; root: string }>();
  private readonly snapshots = new Set<DesktopContextSnapshot>();
  private readonly options: Readonly<DesktopKnowledgeOptions>;
  private readonly onAbort = () => this.dispose();

  constructor(options: DesktopKnowledgeOptions, private readonly adapters: DesktopKnowledgeAdapters) {
    if (!options.turnId || options.turnId.length > 128 || !validPath(options.scope)
      || (options.memoryFolder !== undefined && (!validPath(options.memoryFolder, true)
        || options.memoryFolder === '.claudian'))) throw new Error('Ungültiger Wissensbereich.');
    this.options = Object.freeze({ ...options });
    options.signal.addEventListener('abort', this.onAbort, { once: true });
    if (options.signal.aborted) this.dispose();
  }

  private check(): void {
    if (this.controller.signal.aborted || this.options.signal.aborted || !this.options.allowed()) {
      this.dispose();
      throw new Error('Wissensfreigabe widerrufen/abgebrochen.');
    }
  }

  private async wait<T>(action: () => Promise<T>): Promise<T> {
    this.check();
    const signal = this.controller.signal;
    let abort!: () => void;
    const canceled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('Wissensfreigabe abgebrochen.'));
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      const value = await Promise.race([Promise.resolve().then(() => { this.check(); return action(); }), canceled]);
      this.check();
      return value;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  private async consent(operation: KnowledgeApproval['operation'], scope: string, paths: readonly string[], extra: Partial<KnowledgeApproval> = {}): Promise<void> {
    const request = Object.freeze({ ...extra, operation, turnId: this.options.turnId, scope, paths: Object.freeze([...paths]) });
    if (await this.wait(() => this.options.approve(request)) !== true) throw new Error('Wissenszugriff abgelehnt.');
  }

  private async publish(paths: string[], root: string): Promise<KnowledgeManifest> {
    const unique = [...new Set(paths)];
    if (unique.length > 4) throw new Error('Zu viele Ergebnisse: höchstens 4. Nichts gekürzt.');
    const entries = unique.map(path => ({ path, id: this.records.get(path)?.id ?? randomUUID() }));
    const manifest = Object.freeze({ items: Object.freeze(entries.map(item => Object.freeze(item))), total: entries.length });
    // Fail closed rather than silently dropping long private path labels.
    if (JSON.stringify(manifest).length > 900) throw new Error('Metadaten überschreiten Transportbudget. Nichts gekürzt.');
    await this.consent('metadata-egress', root, unique, { manifest });
    for (const entry of entries) this.records.set(entry.path, { id: entry.id, root });
    return manifest;
  }

  async graph(seed: string, direction: 'outgoing' | 'backlinks' | 'both' = 'both', depth = 1): Promise<KnowledgeManifest> {
    this.check();
    const root = this.options.scope;
    if (!within(seed, root) || !['outgoing', 'backlinks', 'both'].includes(direction)
      || !Number.isInteger(depth) || depth < 1 || depth > 3) throw new Error('Ungültige Graphanfrage.');
    await this.consent('graph-metadata-local', root, [seed]);
    const edges = await this.wait(() => this.adapters.graph(root, 4096, this.controller.signal));
    if (edges.length > 4096) throw new Error('Graph zu groß. Nichts gekürzt.');
    const seen = new Set([seed]);
    let frontier = [seed];
    const found: string[] = [];
    for (let level = 0; level < depth; level++) {
      const next = new Set<string>();
      for (const [source, target] of edges) {
        if (!within(source, root) || !within(target, root)) continue;
        if (direction !== 'backlinks' && frontier.includes(source) && !seen.has(target)) next.add(target);
        if (direction !== 'outgoing' && frontier.includes(target) && !seen.has(source)) next.add(source);
      }
      frontier = [...next].sort();
      for (const path of frontier) { seen.add(path); found.push(path); }
      if (found.length > 4) throw new Error('Zu viele Graphnachbarn: Bereich/Tiefe einschränken. Nichts gekürzt.');
    }
    return this.publish(found, root);
  }

  async recall(terms: readonly string[]): Promise<KnowledgeManifest> {
    this.check();
    if (!Array.isArray(terms) || terms.length > 12 || terms.some(term => typeof term !== 'string' || !/^[\p{L}\p{N}_-]{2,48}$/u.test(term))) throw new Error('Ungültige Suchbegriffe.');
    const queryTerms = Object.freeze([...new Set(terms)]);
    if (!queryTerms.length) return Object.freeze({ items: Object.freeze([]), total: 0 });
    const root = this.options.memoryFolder;
    if (!root) throw new Error('Kein freigegebener Erinnerungsordner.');
    await this.consent('memory-read-local', root, [], { terms: queryTerms });
    const notes = await this.wait(() => this.adapters.memories(root, 256, this.controller.signal));
    if (notes.length > 256 || notes.reduce((sum, note) => sum + note.content.length, 0) > 65536
      || notes.some(note => !within(note.path, root, true))) throw new Error('Erinnerungsquelle außerhalb Grenzen.');
    // Scores/reasons/topics remain local. Return only explicitly approved paths.
    const ranked = rankMemoryNotes(queryTerms.join(' '), notes, { limit: 4 });
    return this.publish(ranked.map(candidate => candidate.note.path), root);
  }

  async snapshot(ids: readonly string[]): Promise<DesktopContextSnapshot> {
    this.check();
    if (!ids.length || ids.length > 4 || new Set(ids).size !== ids.length) throw new Error('Ungültige Ergebnisauswahl.');
    const selected = ids.map(id => {
      const entry = [...this.records].find(([, record]) => record.id === id);
      if (!entry) throw new Error('Unbekanntes Wissensergebnis.');
      return entry;
    });
    const inputs: { kind: 'note'; label: string; text: string }[] = [];
    let total = 0;
    for (const [path, record] of selected) {
      await this.consent('note-read-local', record.root, [path]);
      const text = await this.wait(() => this.adapters.readNote(path, record.root, 65536 - total, this.controller.signal));
      total += text.length;
      if (total > 65536) throw new Error('Notizen zu groß. Nichts gekürzt.');
      inputs.push({ kind: 'note', label: path, text });
    }
    this.check();
    const snapshot = new DesktopContextSnapshot(this.options.turnId, inputs);
    this.snapshots.add(snapshot);
    return snapshot;
  }

  /** Mandatory on permission/scope/provider change and turn finally; cancels
   * pending approvals and invalidates IDs/pages. Does not erase remote text. */
  dispose(): void {
    this.controller.abort();
    this.options.signal.removeEventListener('abort', this.onAbort);
    this.records.clear();
    for (const snapshot of this.snapshots) snapshot.dispose();
    this.snapshots.clear();
  }
}
