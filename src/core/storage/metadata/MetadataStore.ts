export interface MetadataRecord {
  id: string;
  [key: string]: unknown;
}

export interface MetadataTable<T extends MetadataRecord = MetadataRecord> {
  records: Record<string, T>;
}

export interface MetadataDatabase {
  version: number;
  tables: Record<string, MetadataTable>;
}

const DEFAULT_DB: MetadataDatabase = {
  version: 1,
  tables: {},
};

export class MetadataStore {
  private db: MetadataDatabase = DEFAULT_DB;
  private dirty = false;
  private saveTimeout: number | null = null;

  constructor(
    private readonly read: () => Promise<string>,
    private readonly write: (content: string) => Promise<void>,
  ) {}

  async initialize(): Promise<void> {
    try {
      const raw = await this.read();
      const parsed = JSON.parse(raw) as MetadataDatabase;
      this.db = { ...DEFAULT_DB, ...parsed, tables: { ...DEFAULT_DB.tables, ...parsed.tables } };
    } catch {
      this.db = JSON.parse(JSON.stringify(DEFAULT_DB)) as MetadataDatabase;
    }
  }

  private ensureTable<T extends MetadataRecord>(name: string): MetadataTable<T> {
    if (!this.db.tables[name]) {
      this.db.tables[name] = { records: {} };
    }
    return this.db.tables[name] as MetadataTable<T>;
  }

  get<T extends MetadataRecord>(table: string, id: string): T | undefined {
    return this.ensureTable<T>(table).records[id];
  }

  getAll<T extends MetadataRecord>(table: string): T[] {
    return Object.values(this.ensureTable<T>(table).records);
  }

  set<T extends MetadataRecord>(table: string, record: T): void {
    this.ensureTable<T>(table).records[record.id] = record;
    this.schedulePersist();
  }

  delete(table: string, id: string): void {
    delete this.ensureTable(table).records[id];
    this.schedulePersist();
  }

  query<T extends MetadataRecord>(
    table: string,
    predicate: (record: T) => boolean,
    options: { limit?: number; orderBy?: keyof T; order?: 'asc' | 'desc' } = {},
  ): T[] {
    let results = this.getAll<T>(table).filter(predicate);
    if (options.orderBy) {
      const key = options.orderBy;
      const order = options.order ?? 'desc';
      results = results.sort((a, b) => {
        const av = a[key] as number | string;
        const bv = b[key] as number | string;
        if (av === bv) return 0;
        const less = av < bv;
        return order === 'asc' ? (less ? -1 : 1) : (less ? 1 : -1);
      });
    }
    return options.limit ? results.slice(0, options.limit) : results;
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = window.setTimeout(() => {
      void this.persist();
    }, 500);
  }

  async persist(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await this.write(JSON.stringify(this.db, null, 2));
  }
}
