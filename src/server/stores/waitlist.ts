/**
 * SQL-backed waitlist store. Mirrors `sqlite-run-history-store.ts`:
 * uses `@framers/sql-storage-adapter` so the same code works on
 * better-sqlite3 (default), sql.js (fallback), and Postgres (set
 * STORAGE_ADAPTER=postgres + DATABASE_URL). Email lookups are
 * case-insensitive (we lowercase on write).
 *
 * @module paracosm/cli/server/waitlist-store
 */
import { createDatabase, type StorageAdapter, type DatabaseOptions } from '@framers/sql-storage-adapter';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Allowed values for the `user_type` column. The form's <select>
 * defaults to `hobbyist`; the route layer enforces this set via Zod
 * so anything stored in the column is one of these literals.
 */
export const WAITLIST_USER_TYPES = [
  'vc',
  'investor',
  'developer',
  'enterprise',
  'professional',
  'researcher',
  'hobbyist',
  'other',
] as const;

export type WaitlistUserType = typeof WAITLIST_USER_TYPES[number];

export interface WaitlistEntry {
  id: number;
  email: string;
  name: string | null;
  useCase: string | null;
  source: string | null;
  userType: WaitlistUserType;
  ip: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface InsertWaitlistInput {
  email: string;
  name?: string | null;
  useCase?: string | null;
  source?: string | null;
  userType?: WaitlistUserType;
  ip?: string | null;
}

export interface InsertWaitlistResult {
  id: number;
  position: number;
  alreadyExisted: boolean;
}

export interface WaitlistStore {
  insertOrGetExisting(input: InsertWaitlistInput): Promise<InsertWaitlistResult>;
  count(): Promise<number>;
  findByEmail(email: string): Promise<WaitlistEntry | null>;
  listAll(): Promise<WaitlistEntry[]>;
}

export interface CreateWaitlistStoreOptions {
  /** SQLite file path. Ignored when STORAGE_ADAPTER selects Postgres. */
  dbPath?: string;
  /** Direct override for `createDatabase`. Tests pass `{ file: ':memory:' }`. */
  databaseOptions?: DatabaseOptions;
}

interface WaitlistRow {
  id: number;
  email: string;
  name: string | null;
  use_case: string | null;
  source: string | null;
  user_type: string | null;
  ip: string | null;
  created_at: string;
  confirmed_at: string | null;
}

function isSqliteAdapter(adapter: StorageAdapter): boolean {
  return adapter.kind === 'better-sqlite3' || adapter.kind === 'sqljs';
}

/**
 * Idempotent column-add migration. SQLite raises "duplicate column name"
 * when the column already exists; we swallow that and propagate any other
 * error. SQLite-only — Postgres tenants get the new columns inline in the
 * CREATE TABLE.
 */
async function ensureWaitlistColumns(adapter: StorageAdapter): Promise<void> {
  if (!isSqliteAdapter(adapter)) return;
  const newCols: ReadonlyArray<readonly [string, string]> = [
    // Free-form classification of what the visitor identifies as. Default
    // 'hobbyist' so existing rows from before this migration pick up a
    // sensible value without triggering NOT NULL violations.
    ['user_type', "TEXT NOT NULL DEFAULT 'hobbyist'"],
  ];
  for (const [name, type] of newCols) {
    try {
      await adapter.exec(`ALTER TABLE waitlist ADD COLUMN ${name} ${type};`);
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      if (!msg.includes('duplicate column name')) throw err;
    }
  }
}

async function bootstrap(adapter: StorageAdapter): Promise<void> {
  await adapter.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      use_case TEXT,
      source TEXT,
      user_type TEXT NOT NULL DEFAULT 'hobbyist',
      ip TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );
  `);
  await adapter.exec(`CREATE INDEX IF NOT EXISTS waitlist_created_idx ON waitlist(created_at);`);
  await ensureWaitlistColumns(adapter);
}

function rowToEntry(row: WaitlistRow): WaitlistEntry {
  const userType = (row.user_type && (WAITLIST_USER_TYPES as readonly string[]).includes(row.user_type)
    ? (row.user_type as WaitlistUserType)
    : 'hobbyist');
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    useCase: row.use_case,
    source: row.source,
    userType,
    ip: row.ip,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

export function createWaitlistStore(options: CreateWaitlistStoreOptions): WaitlistStore {
  const { dbPath, databaseOptions } = options;
  if (dbPath && dbPath !== ':memory:' && !databaseOptions?.type) {
    try { mkdirSync(dirname(dbPath), { recursive: true }); } catch { /* exists */ }
  }

  let adapterPromise: Promise<StorageAdapter> | null = null;
  function getAdapter(): Promise<StorageAdapter> {
    if (!adapterPromise) {
      adapterPromise = (async () => {
        const adapter = await createDatabase(
          databaseOptions ?? { file: dbPath ?? ':memory:' },
        );
        await bootstrap(adapter);
        return adapter;
      })();
    }
    return adapterPromise;
  }

  return {
    async insertOrGetExisting(input) {
      const adapter = await getAdapter();
      const normalized = input.email.trim().toLowerCase();
      const existing = await adapter.get<WaitlistRow>(
        `SELECT * FROM waitlist WHERE email = ? LIMIT 1`,
        [normalized],
      );
      if (existing) {
        const positionRow = await adapter.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM waitlist WHERE id <= ?`,
          [existing.id],
        );
        return {
          id: existing.id,
          position: positionRow?.n ?? 0,
          alreadyExisted: true,
        };
      }
      const createdAt = new Date().toISOString();
      await adapter.run(
        `INSERT INTO waitlist (email, name, use_case, source, user_type, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          normalized,
          input.name ?? null,
          input.useCase ?? null,
          input.source ?? null,
          input.userType ?? 'hobbyist',
          input.ip ?? null,
          createdAt,
        ],
      );
      const inserted = await adapter.get<WaitlistRow>(
        `SELECT * FROM waitlist WHERE email = ? LIMIT 1`,
        [normalized],
      );
      if (!inserted) throw new Error('Waitlist insert returned no row');
      const positionRow = await adapter.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM waitlist WHERE id <= ?`,
        [inserted.id],
      );
      return {
        id: inserted.id,
        position: positionRow?.n ?? 1,
        alreadyExisted: false,
      };
    },

    async count() {
      const adapter = await getAdapter();
      const row = await adapter.get<{ n: number }>(`SELECT COUNT(*) AS n FROM waitlist`);
      return row?.n ?? 0;
    },

    async findByEmail(email) {
      const adapter = await getAdapter();
      const row = await adapter.get<WaitlistRow>(
        `SELECT * FROM waitlist WHERE email = ? LIMIT 1`,
        [email.trim().toLowerCase()],
      );
      return row ? rowToEntry(row) : null;
    },

    async listAll() {
      const adapter = await getAdapter();
      const rows = await adapter.all<WaitlistRow>(
        `SELECT * FROM waitlist ORDER BY id ASC`,
      );
      return rows.map(rowToEntry);
    },
  };
}
