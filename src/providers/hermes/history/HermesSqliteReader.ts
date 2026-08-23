import { spawnSync as defaultSpawnSync } from 'node:child_process';

import { findNodeExecutable } from '../../../utils/env';

export type StoredRow = Record<string, unknown>;

interface SqliteModule {
  DatabaseSync: new (location: string, options?: Record<string, unknown>) => {
    close(): void;
    prepare(sql: string): {
      all(...params: unknown[]): StoredRow[];
    };
  };
}

export interface HermesSqliteReaderDependencies {
  findNodeExecutable?: () => string | null;
  requireSqliteModule?: () => SqliteModule | null;
  spawnSync?: typeof defaultSpawnSync;
}

export const HERMES_SQLITE_QUERY_MAX_BUFFER = 100 * 1024 * 1024;

/**
 * `active = 1` skips messages a rewind or compaction retired; `compacted`
 * rows are the pre-compression originals and would duplicate the summary.
 * Column list is pinned so a schema addition upstream cannot change the shape
 * the mapper sees.
 */
export const HERMES_MESSAGE_ROW_SQL = buildHermesMessageRowsSql('?');

const HERMES_SQLITE_CHILD_SCRIPT = `
const { DatabaseSync } = require('node:sqlite');
const [databasePath, sessionId, messageSql] = process.argv.slice(1);
let db;
try {
  db = new DatabaseSync(databasePath, { readonly: true });
  const messageRows = db.prepare(messageSql).all(sessionId);
  process.stdout.write(JSON.stringify({ messageRows }));
} finally {
  if (db) db.close();
}
`.trim();

/**
 * Reads a session's messages through the first strategy that works: the
 * renderer's own `node:sqlite`, a child Node process, then the `sqlite3` CLI.
 * Returns null when every strategy failed, so callers can tell "no messages"
 * apart from "could not read".
 */
export async function loadHermesSessionRows(
  databasePath: string,
  sessionId: string,
  dependencies: HermesSqliteReaderDependencies = {},
): Promise<StoredRow[] | null> {
  const resolved = resolveDependencies(dependencies);

  return loadRowsWithCurrentProcessSqlite(databasePath, sessionId, resolved.requireSqliteModule)
    ?? loadRowsWithNodeProcess(databasePath, sessionId, resolved.findNodeExecutable, resolved.spawnSync)
    ?? loadRowsWithSqliteCli(databasePath, sessionId, resolved.spawnSync);
}

function resolveDependencies(
  dependencies: HermesSqliteReaderDependencies,
): Required<HermesSqliteReaderDependencies> {
  return {
    findNodeExecutable,
    requireSqliteModule,
    spawnSync: defaultSpawnSync,
    ...dependencies,
  };
}

function requireSqliteModule(): SqliteModule | null {
  try {
    if (typeof module === 'undefined' || typeof module.require !== 'function') {
      return null;
    }

    const sqlite = module.require('node:sqlite') as unknown;
    return isSqliteModule(sqlite) ? sqlite : null;
  } catch {
    return null;
  }
}

function isSqliteModule(value: unknown): value is SqliteModule {
  return isPlainObject(value) && typeof value.DatabaseSync === 'function';
}

function loadRowsWithCurrentProcessSqlite(
  databasePath: string,
  sessionId: string,
  requireSqlite: () => SqliteModule | null,
): StoredRow[] | null {
  const sqlite = requireSqlite();
  if (!sqlite) {
    return null;
  }

  let db: InstanceType<SqliteModule['DatabaseSync']> | null = null;
  try {
    db = new sqlite.DatabaseSync(databasePath, { readonly: true });
    return db.prepare(HERMES_MESSAGE_ROW_SQL).all(sessionId);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function loadRowsWithNodeProcess(
  databasePath: string,
  sessionId: string,
  findNode: () => string | null,
  spawnSync: typeof defaultSpawnSync,
): StoredRow[] | null {
  const nodePath = findNode();
  if (!nodePath) {
    return null;
  }

  const result = spawnSync(
    nodePath,
    ['-e', HERMES_SQLITE_CHILD_SCRIPT, databasePath, sessionId, HERMES_MESSAGE_ROW_SQL],
    { encoding: 'utf8', maxBuffer: HERMES_SQLITE_QUERY_MAX_BUFFER, windowsHide: true },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(getSpawnStdout(result.stdout) || '{}') as unknown;
    return isPlainObject(parsed) ? parseStoredRowsValue(parsed.messageRows) : null;
  } catch {
    return null;
  }
}

function loadRowsWithSqliteCli(
  databasePath: string,
  sessionId: string,
  spawnSync: typeof defaultSpawnSync,
): StoredRow[] | null {
  const result = spawnSync(
    'sqlite3',
    ['-json', databasePath, buildHermesMessageRowsSql(`'${escapeSqlLiteral(sessionId)}'`)],
    { encoding: 'utf8', maxBuffer: HERMES_SQLITE_QUERY_MAX_BUFFER, windowsHide: true },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  try {
    return parseStoredRowsValue(JSON.parse(getSpawnStdout(result.stdout) || '[]') as unknown);
  } catch {
    return null;
  }
}

function parseStoredRowsValue(value: unknown): StoredRow[] | null {
  return Array.isArray(value)
    ? value.filter((row): row is StoredRow => isPlainObject(row))
    : null;
}

function getSpawnStdout(stdout: string | Buffer | null | undefined): string {
  return typeof stdout === 'string' ? stdout : stdout?.toString('utf8') ?? '';
}

function escapeSqlLiteral(value: string): string {
  return value.replaceAll('\'', '\'\'');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildHermesMessageRowsSql(sessionIdExpression: string): string {
  return `
select
  id,
  role,
  content,
  tool_call_id,
  tool_calls,
  tool_name,
  timestamp,
  reasoning,
  reasoning_content
from messages
where session_id = ${sessionIdExpression}
  and active = 1
  and coalesce(compacted, 0) = 0
order by timestamp asc, id asc;`.trim();
}
