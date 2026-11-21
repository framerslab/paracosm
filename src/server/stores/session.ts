/**
 * @fileoverview Persistent storage for completed simulation runs.
 *
 * Captures the SSE event stream of a finished sim into the active
 * SQL backend (default: SQLite via better-sqlite3) so visitors to the
 * hosted demo can replay a saved session at original pacing instead of
 * triggering a fresh LLM-powered run. Each owner (a visitor) keeps a
 * ring of their N most recent saves, oldest evicted. A bound on every
 * owner's rows together keeps the file size predictable: past it the save
 * evicts the oldest unpinned row of the owner holding the most rows, and
 * when every owner holds one row, the oldest unpinned row in the store,
 * another owner's included. Rows an admin saved (pinned) are never
 * evicted. With `ownerRings: false` (a local server) the store keeps one
 * ring of N rows, whoever saved them.
 *
 * "Oldest" is the order rows were saved in: a sequence number stored with
 * each row, which a clock moved back cannot reorder. A save's insert and
 * its evictions commit in one transaction, and opening the store trims
 * any owner over its bound, so a failed or cut save never leaves a bound
 * exceeded. A save under a run key already saved returns that row.
 *
 * Backed by `@framers/sql-storage-adapter`. Given only a path, the store
 * opens better-sqlite3, or sql.js when the native module cannot load;
 * `STORAGE_ADAPTER` and `DATABASE_URL` have no effect, because
 * `createDatabase({ file })` fixes that order in Node. Another backend,
 * such as Postgres, takes `databaseOptions` in `OpenSessionStoreOptions`.
 *
 * Single-table schema with the event array stored as a JSON blob — for
 * at most 50 saved runs the row count is trivial and full-row reads
 * dominate access patterns. Splitting events into a per-event table
 * would add JOIN cost without any query that benefits.
 *
 * @module paracosm/cli/session-store
 */
import { createDatabase, type StorageAdapter, type DatabaseOptions } from '@framers/sql-storage-adapter';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Default ring size of one owner's saved runs — pinned to the spec's "last 10 or so". */
export const DEFAULT_MAX_SESSIONS = 10;

/**
 * Default bound on the unpinned saved runs of every owner together. Past it
 * the owner holding the most rows gives up their oldest, and when every
 * owner holds one row, the oldest unpinned row in the store goes.
 */
export const DEFAULT_MAX_TOTAL_SESSIONS = 50;

/** A single SSE event captured at broadcast time. */
export interface TimestampedEvent {
  /** Wall-clock ms when the event was emitted. Used for replay pacing. */
  ts: number;
  /** Pre-formatted SSE message (`event: ...\ndata: ...\n\n`). */
  sse: string;
}

/**
 * Public metadata for a stored session — what `/sessions` returns to
 * the dashboard so users can pick which run to replay. Excludes the
 * events blob to keep the listing payload light.
 */
export interface SessionMeta {
  id: string;
  /** Wall-clock ms when the save endpoint was hit. */
  createdAt: number;
  scenarioId?: string;
  scenarioName?: string;
  leaderA?: string;
  leaderB?: string;
  /** Number of turns the run completed before being saved. */
  turnCount?: number;
  /** Number of SSE events captured. */
  eventCount: number;
  /** Wall-clock ms between the first and last event (sim duration). */
  durationMs?: number;
  /** Total cost in USD reported by the run's cost tracker, when available. */
  totalCostUSD?: number;
  /**
   * Short LLM-generated narrative title for the run, e.g.
   * "Aria's Cautious Descent" or "Engineering Wins on Turn 4".
   * Set asynchronously after `saveSession` returns via `updateTitle`;
   * `null` for rows saved before the titling pipeline ran or when the
   * title LLM call failed.
   */
  title?: string | null;
  /**
   * The seed prompt the user submitted to compile this scenario, when
   * available. Truncated to 1000 chars so the listing stays light.
   * Populated when the run originated from a compile-from-seed call;
   * preset/Mars-Genesis runs leave this undefined.
   */
  seedText?: string;
  /**
   * Full actor roster for runs with 3+ actors. The legacy leaderA /
   * leaderB columns only carry the first two — this array preserves
   * every actor's name so replay-tab UI can show "Aria, Maria, Atlas,
   * Reyes, +5 more" on a 9-actor run instead of just the first pair.
   * Empty / absent on pair runs (the legacy fields cover them).
   */
  leaders?: string[];
  /** True for a session an admin saved: listed to every visitor and never evicted. */
  pinned?: boolean;
}

/** A full session record, including the event payload for replay. */
export interface StoredSession {
  meta: SessionMeta;
  events: TimestampedEvent[];
  /** The owner key it was saved under (see {@link SaveSessionOptions.owner}), or null. */
  owner: string | null;
}

/** Who a saved session belongs to. */
export interface SaveSessionOptions {
  /**
   * An opaque key naming the visitor whose run it is (the server stores a
   * SHA-256 of the visitor id). Null or absent for a run with no visitor.
   */
  owner?: string | null;
  /** An admin save: listed to every visitor and never evicted by the ring. */
  pinned?: boolean;
  /**
   * The live run the session was saved from. A save under a run key
   * already saved adds no row and returns the saved row's id, so a save
   * retried after a restart never saves a run twice.
   */
  runKey?: string;
}

/** Which saved sessions a listing returns. */
export interface ListSessionsScope {
  /** Rows saved under this owner key, besides the pinned rows; null lists the pinned rows alone. */
  owner: string | null;
}

/** Optional metadata override accepted by `saveSession`. */
export interface SessionMetaOverride {
  scenarioId?: string;
  scenarioName?: string;
  leaderA?: string;
  leaderB?: string;
  turnCount?: number;
  totalCostUSD?: number;
  seedText?: string;
  /** Full actor roster — see {@link SessionMeta.leaders}. */
  leaders?: string[];
}

/**
 * Lightweight session-store handle returned by {@link openSessionStore}.
 * All methods are async because the underlying storage adapter is async
 * (the adapter abstracts SQLite, Postgres, sql.js, IndexedDB behind one
 * interface). Existing call sites already live inside async HTTP handlers;
 * adding `await` is a 1-character change per call.
 */
export interface SessionStore {
  /**
   * Persist a finished sim. Generates a UUID, computes derived metadata
   * from the event stream and inserts. An unpinned save then evicts the
   * oldest unpinned row of its own owner when that owner holds more than
   * `maxSessions`; when every owner's unpinned rows together exceed
   * `maxTotalSessions`, the owner holding the most rows (the one whose
   * oldest row is oldest, on a tie) gives up their oldest, so when every
   * owner holds one row the oldest unpinned row in the store goes, another
   * owner's included. Rows with no owner count as one owner. With
   * `ownerRings: false` the oldest unpinned row goes once the store holds
   * more than `maxSessions`. "Oldest" follows the order rows were saved in.
   * The insert and its evictions commit together or not at all, and saves
   * on one store run one at a time, so saves that finish together keep
   * both bounds. A save under a run key already saved returns that row's
   * id and adds none.
   *
   * Returns the session's id and (when applicable) the id of the last
   * row evicted to make room. Caller can log or surface the eviction.
   */
  saveSession(events: TimestampedEvent[], override?: SessionMetaOverride, options?: SaveSessionOptions): Promise<{
    id: string;
    evictedId?: string;
  }>;
  /**
   * Returns metadata for the stored sessions, newest first: every one, or
   * with `scope` the pinned ones and the ones saved under `scope.owner`.
   */
  listSessions(scope?: ListSessionsScope): Promise<SessionMeta[]>;
  /** Loads one session in full. Returns `null` when the id is unknown. */
  getSession(id: string): Promise<StoredSession | null>;
  /** The ids among `ids` the store holds. */
  existingIds(ids: readonly string[]): Promise<Set<string>>;
  /** Number of currently stored sessions. Useful for tests + smoke checks. */
  count(): Promise<number>;
  /**
   * Overwrite the title for a stored session. No-op when the id does
   * not exist. Surfaced separately so the title pipeline can run
   * asynchronously after `saveSession` returns — a failed or slow title
   * LLM call must not block the save itself.
   */
  updateTitle(id: string, title: string): Promise<void>;
  /**
   * Destructive: delete every saved session. Used by the
   * `/admin/data/wipe` endpoint for one-shot cleanups. Returns the
   * count of deleted rows.
   */
  wipeAll(): Promise<number>;
  /** Releases the underlying connection. */
  close(): Promise<void>;
}

export interface OpenSessionStoreOptions {
  /**
   * Optional override forwarded to `createDatabase`. Tests use this to
   * pin `type: 'memory'` for hermetic isolation; production code leaves
   * it undefined, so the store opens `dbPath` with SQLite.
   */
  databaseOptions?: DatabaseOptions;
  /**
   * The most unpinned rows the store keeps for every owner together;
   * defaults to {@link DEFAULT_MAX_TOTAL_SESSIONS}, and is never below
   * `maxSessions`.
   */
  maxTotalSessions?: number;
  /**
   * True (the default): each owner keeps a ring of `maxSessions` rows,
   * within `maxTotalSessions` in all (the hosted demo). False: one ring of
   * `maxSessions` rows for the whole store, whatever owner keys the rows
   * carry (a local server, whose operator is its only visitor).
   */
  ownerRings?: boolean;
}

function isSqliteAdapter(adapter: StorageAdapter): boolean {
  return adapter.kind === 'better-sqlite3' || adapter.kind === 'sqljs';
}

async function bootstrapSchema(adapter: StorageAdapter): Promise<void> {
  await adapter.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      createdAt INTEGER NOT NULL,
      scenarioId TEXT,
      scenarioName TEXT,
      leaderA TEXT,
      leaderB TEXT,
      turnCount INTEGER,
      eventCount INTEGER NOT NULL,
      durationMs INTEGER,
      totalCostUSD REAL,
      events TEXT NOT NULL,
      title TEXT,
      seedText TEXT,
      leaders TEXT,
      owner TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      seq INTEGER,
      runKey TEXT
    );
  `);
  await adapter.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_createdAt ON sessions(createdAt);`);

  // Idempotent schema migration: add columns introduced after the
  // original schema landed, without dropping the DB. CREATE TABLE IF NOT
  // EXISTS adds no column to a table made before, so a Postgres table
  // takes ADD COLUMN IF NOT EXISTS, and SQLite, which has no IF NOT
  // EXISTS there, reads its columns first.
  if (adapter.kind === 'postgres' || adapter.kind === 'supabase-postgres') {
    await adapter.exec('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title TEXT');
    await adapter.exec('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS seedText TEXT');
    await adapter.exec('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS leaders TEXT');
    await adapter.exec('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS owner TEXT');
    await adapter.exec('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pinned INTEGER NOT NULL DEFAULT 0');
    await adapter.exec('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS seq INTEGER');
    await adapter.exec('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS runKey TEXT');
  } else if (isSqliteAdapter(adapter)) {
    const columns = await adapter.all<{ name: string }>('PRAGMA table_info(sessions)');
    const addColumnIfMissing = async (name: string, ddl: string) => {
      if (columns.some((c) => c.name === name)) return;
      try {
        await adapter.exec(ddl);
      } catch (err) {
        const msg = String((err as Error).message ?? err);
        if (!msg.includes('duplicate column name')) throw err;
      }
    };
    await addColumnIfMissing('title', 'ALTER TABLE sessions ADD COLUMN title TEXT');
    await addColumnIfMissing('seedText', 'ALTER TABLE sessions ADD COLUMN seedText TEXT');
    await addColumnIfMissing('leaders', 'ALTER TABLE sessions ADD COLUMN leaders TEXT');
    await addColumnIfMissing('owner', 'ALTER TABLE sessions ADD COLUMN owner TEXT');
    await addColumnIfMissing('pinned', 'ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing('seq', 'ALTER TABLE sessions ADD COLUMN seq INTEGER');
    await addColumnIfMissing('runKey', 'ALTER TABLE sessions ADD COLUMN runKey TEXT');
  }
  await adapter.exec('CREATE INDEX IF NOT EXISTS idx_sessions_seq ON sessions(seq)');
  await adapter.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_runKey ON sessions(runKey)');

  // Rows saved before the sequence existed take one in the order they were
  // saved, after any row that has one.
  await adapter.transaction(async (trx) => {
    const unnumbered = await trx.all<{ id: string }>('SELECT id FROM sessions WHERE seq IS NULL ORDER BY createdAt ASC, id ASC');
    if (unnumbered.length === 0) return;
    let seq = await lastSeq(trx);
    for (const row of unnumbered) {
      seq += 1;
      await trx.run('UPDATE sessions SET seq = ? WHERE id = ?', [seq, row.id]);
    }
  });
}

/** The highest save sequence number in the store, 0 when it holds no row. */
async function lastSeq(adapter: StorageAdapter): Promise<number> {
  const row = await adapter.get<{ s: number | null }>('SELECT MAX(seq) AS s FROM sessions');
  return Number(row?.s ?? 0);
}

/**
 * Open or create the session-store database at `dbPath`.
 *
 * Creates the parent directory when missing so the first call after
 * a fresh deploy doesn't crash on a missing `data/` folder. The
 * single-table schema is created idempotently via CREATE TABLE IF NOT
 * EXISTS, so subsequent reopens are no-ops.
 *
 * The underlying adapter is opened lazily on first method call so this
 * factory plugs into the existing sync `createMarsServer` boot path
 * without forcing every caller to become async.
 *
 * @param dbPath Filesystem path to the SQLite database file. Use
 *   `':memory:'` in tests for an isolated in-process DB.
 * @param maxSessions Maximum unpinned rows one owner keeps. Defaults to
 *   10. An owner's older sessions are evicted on their save.
 * @param options Optional overrides (e.g. `databaseOptions: { type: 'memory' }`,
 *   `maxTotalSessions`).
 */
export function openSessionStore(
  dbPath: string,
  maxSessions: number = DEFAULT_MAX_SESSIONS,
  options: OpenSessionStoreOptions = {},
): SessionStore {
  if (dbPath !== ':memory:' && !options.databaseOptions?.type && dbPath) {
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
    } catch (err) {
      void err;
    }
  }

  const maxTotalSessions = Math.max(maxSessions, options.maxTotalSessions ?? DEFAULT_MAX_TOTAL_SESSIONS);
  const bounds: Bounds = { maxSessions, maxTotalSessions, ownerRings: options.ownerRings !== false };

  let adapterPromise: Promise<StorageAdapter> | null = null;
  function getAdapter(): Promise<StorageAdapter> {
    if (!adapterPromise) {
      adapterPromise = (async () => {
        const adapter = await createDatabase(options.databaseOptions ?? { file: dbPath });
        await bootstrapSchema(adapter);
        // Rows saved under wider bounds, or by a save cut before its
        // evictions, are brought within the bounds before any read.
        await adapter.transaction(trx => enforceBounds(trx, bounds, null));
        return adapter;
      })();
    }
    return adapterPromise;
  }

  // Saves run one at a time: each save's insert, counts and evictions read
  // the rows the save before it left, so runs that finish together cannot
  // both count the same rows and evict the same one, leaving a bound
  // exceeded, or take the same sequence number.
  let saveQueue: Promise<unknown> = Promise.resolve();

  const saveOne: SessionStore['saveSession'] = async (events, override, options) => {
    const adapter = await getAdapter();
    const id = randomUUID();
    const createdAt = Date.now();
    const derived = deriveMetadata(events);
    const eventCount = events.length;
    const durationMs = events.length >= 2
      ? events[events.length - 1].ts - events[0].ts
      : 0;

    // Persist `leaders` as a JSON-encoded string array. Only stamp it
    // when there's something to stamp — pair runs (n=2) leave it null
    // because leaderA/leaderB already cover that case and nothing in
    // the UI needs the array for n<3.
    const resolvedLeaders = override?.leaders ?? derived.leaders;
    const leadersJSON = resolvedLeaders && resolvedLeaders.length >= 3
      ? JSON.stringify(resolvedLeaders)
      : null;
    const pinned = options?.pinned === true;
    const runKey = !pinned && options?.runKey ? options.runKey : null;

    // The insert and its evictions commit together: a failure part way
    // rolls the insert back, so neither bound is ever left exceeded.
    return adapter.transaction(async (trx) => {
      if (runKey !== null) {
        const saved = await trx.get<{ id: string }>('SELECT id FROM sessions WHERE runKey = ?', [runKey]);
        if (saved) return { id: saved.id };
      }
      const seq = (await lastSeq(trx)) + 1;
      await trx.run(
        `INSERT INTO sessions
           (id, createdAt, scenarioId, scenarioName, leaderA, leaderB, turnCount, eventCount, durationMs, totalCostUSD, events, seedText, leaders, owner, pinned, seq, runKey)
         VALUES
           (@id, @createdAt, @scenarioId, @scenarioName, @leaderA, @leaderB, @turnCount, @eventCount, @durationMs, @totalCostUSD, @events, @seedText, @leaders, @owner, @pinned, @seq, @runKey)`,
        {
          id,
          createdAt,
          scenarioId: override?.scenarioId ?? derived.scenarioId ?? null,
          scenarioName: override?.scenarioName ?? derived.scenarioName ?? null,
          leaderA: override?.leaderA ?? derived.leaderA ?? null,
          leaderB: override?.leaderB ?? derived.leaderB ?? null,
          turnCount: override?.turnCount ?? derived.turnCount ?? null,
          eventCount,
          durationMs,
          totalCostUSD: override?.totalCostUSD ?? derived.totalCostUSD ?? null,
          events: JSON.stringify(events),
          seedText: override?.seedText ?? derived.seedText ?? null,
          leaders: leadersJSON,
          owner: options?.owner ?? null,
          pinned: pinned ? 1 : 0,
          seq,
          runKey,
        },
      );
      // An admin-saved (pinned) row is neither counted nor evicted, and
      // its save evicts nothing.
      const evictedId = pinned ? undefined : await enforceBounds(trx, bounds, { owner: options?.owner ?? null, id });
      return evictedId === undefined ? { id } : { id, evictedId };
    });
  };

  return {
    saveSession(events, override, options) {
      const save = saveQueue.then(() => saveOne(events, override, options));
      // A failed save rejects its own caller and leaves the queue running.
      saveQueue = save.catch(() => undefined);
      return save;
    },

    async listSessions(scope) {
      const adapter = await getAdapter();
      const columns = 'id, createdAt, scenarioId, scenarioName, leaderA, leaderB, turnCount, eventCount, durationMs, totalCostUSD, title, seedText, leaders, pinned';
      const rows = scope === undefined
        ? await adapter.all<SessionMetaRow>(`SELECT ${columns} FROM sessions ORDER BY seq DESC`)
        : scope.owner === null
          ? await adapter.all<SessionMetaRow>(`SELECT ${columns} FROM sessions WHERE pinned = 1 ORDER BY seq DESC`)
          : await adapter.all<SessionMetaRow>(
            `SELECT ${columns} FROM sessions WHERE pinned = 1 OR owner = ? ORDER BY seq DESC`,
            [scope.owner],
          );
      return rows.map(rowToMeta);
    },

    async getSession(id) {
      const adapter = await getAdapter();
      const row = await adapter.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id]);
      if (!row) return null;
      const events = JSON.parse(row.events) as TimestampedEvent[];
      return { meta: rowToMeta(row), events, owner: row.owner ?? null };
    },

    async existingIds(ids) {
      const found = new Set<string>();
      const unique = [...new Set(ids)];
      if (unique.length === 0) return found;
      const adapter = await getAdapter();
      for (let i = 0; i < unique.length; i += 500) {
        const chunk = unique.slice(i, i + 500);
        const rows = await adapter.all<{ id: string }>(
          `SELECT id FROM sessions WHERE id IN (${chunk.map(() => '?').join(', ')})`,
          chunk,
        );
        for (const row of rows) found.add(row.id);
      }
      return found;
    },

    async count() {
      const adapter = await getAdapter();
      const row = await adapter.get<{ c: number }>('SELECT COUNT(*) AS c FROM sessions');
      return Number(row?.c ?? 0);
    },

    async updateTitle(id, title) {
      // Trim + cap so a runaway LLM response can't bloat the metadata
      // row. 120 chars is generous for "Aria's Cautious Mars Descent"
      // style titles while still guarding against JSON hallucinations
      // that pack reasoning into the title field.
      const clean = title.trim().slice(0, 120);
      if (!clean) return;
      const adapter = await getAdapter();
      await adapter.run('UPDATE sessions SET title = ? WHERE id = ?', [clean, id]);
    },

    async wipeAll() {
      const adapter = await getAdapter();
      const before = await adapter.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions');
      await adapter.run('DELETE FROM sessions');
      return Number(before?.n ?? 0);
    },

    async close() {
      if (!adapterPromise) return;
      const adapter = await adapterPromise;
      await adapter.close();
      adapterPromise = null;
    },
  };
}

/** The bounds a store keeps its unpinned rows within. */
interface Bounds {
  maxSessions: number;
  maxTotalSessions: number;
  ownerRings: boolean;
}

/** The WHERE clause and parameters that select one owner's rows; rows with no owner are one owner. */
function ownerMatch(owner: string | null): { sql: string; params: string[] } {
  return owner === null ? { sql: 'owner IS NULL', params: [] } : { sql: 'owner = ?', params: [owner] };
}

/**
 * Deletes the oldest unpinned row (by save sequence) of `owner`, or of the
 * whole store when `owner` is undefined, never the row `keepId`, and returns
 * its id, or undefined when there is none.
 */
async function evictOldest(adapter: StorageAdapter, owner: string | null | undefined, keepId: string | null): Promise<string | undefined> {
  const match = owner === undefined ? { sql: '1 = 1', params: [] as string[] } : ownerMatch(owner);
  const keep = keepId === null ? { sql: '', params: [] as string[] } : { sql: ' AND id <> ?', params: [keepId] };
  const oldest = await adapter.get<{ id: string }>(
    `SELECT id FROM sessions WHERE pinned = 0 AND ${match.sql}${keep.sql} ORDER BY seq ASC LIMIT 1`,
    [...match.params, ...keep.params],
  );
  if (!oldest) return undefined;
  await adapter.run('DELETE FROM sessions WHERE id = ?', [oldest.id]);
  return oldest.id;
}

async function unpinnedCount(adapter: StorageAdapter, owner?: string | null): Promise<number> {
  const match = owner === undefined ? { sql: '1 = 1', params: [] as string[] } : ownerMatch(owner);
  const row = await adapter.get<{ c: number }>(`SELECT COUNT(*) AS c FROM sessions WHERE pinned = 0 AND ${match.sql}`, match.params);
  return Number(row?.c ?? 0);
}

/**
 * Evicts unpinned rows until the store is within its bounds; returns the
 * last id evicted. With `saved` (a save's owner and new row), the save's
 * owner is brought within their ring first and the new row is never the
 * one evicted; with null (the store opening), every owner is.
 */
async function enforceBounds(
  adapter: StorageAdapter,
  bounds: Bounds,
  saved: { owner: string | null; id: string } | null,
): Promise<string | undefined> {
  let evictedId: string | undefined;
  const keepId = saved?.id ?? null;
  if (!bounds.ownerRings) {
    while (await unpinnedCount(adapter) > bounds.maxSessions) {
      const evicted = await evictOldest(adapter, undefined, keepId);
      if (evicted === undefined) break;
      evictedId = evicted;
    }
    return evictedId;
  }
  const owners = saved
    ? [saved.owner]
    : (await adapter.all<{ owner: string | null }>(
      'SELECT owner FROM sessions WHERE pinned = 0 GROUP BY owner HAVING COUNT(*) > ?',
      [bounds.maxSessions],
    )).map(row => row.owner ?? null);
  for (const owner of owners) {
    while (await unpinnedCount(adapter, owner) > bounds.maxSessions) {
      const evicted = await evictOldest(adapter, owner, keepId);
      if (evicted === undefined) break;
      evictedId = evicted;
    }
  }
  while (await unpinnedCount(adapter) > bounds.maxTotalSessions) {
    // The owner holding the most rows; on a tie, the one whose oldest row
    // is oldest. When every owner holds one row, that is the oldest row of all.
    const largest = await adapter.get<{ owner: string | null }>(
      'SELECT owner FROM sessions WHERE pinned = 0 GROUP BY owner ORDER BY COUNT(*) DESC, MIN(seq) ASC LIMIT 1',
    );
    const evicted = largest ? await evictOldest(adapter, largest.owner ?? null, keepId) : undefined;
    if (evicted === undefined) break;
    evictedId = evicted;
  }
  return evictedId;
}

/** Internal row shape — narrow `unknown` to the columns we select. */
interface SessionMetaRow {
  id: string;
  createdAt: number;
  scenarioId: string | null;
  scenarioName: string | null;
  leaderA: string | null;
  leaderB: string | null;
  turnCount: number | null;
  eventCount: number;
  durationMs: number | null;
  totalCostUSD: number | null;
  title: string | null;
  seedText: string | null;
  /** JSON-encoded `string[]` (or null on legacy rows / pair runs). */
  leaders: string | null;
  pinned?: number | null;
}

interface SessionRow extends SessionMetaRow {
  events: string;
  owner: string | null;
}

function rowToMeta(row: SessionMetaRow): SessionMeta {
  const meta: SessionMeta = {
    id: row.id,
    createdAt: row.createdAt,
    eventCount: row.eventCount,
  };
  if (row.scenarioId) meta.scenarioId = row.scenarioId;
  if (row.scenarioName) meta.scenarioName = row.scenarioName;
  if (row.leaderA) meta.leaderA = row.leaderA;
  if (row.leaderB) meta.leaderB = row.leaderB;
  if (row.turnCount != null) meta.turnCount = row.turnCount;
  if (row.durationMs != null) meta.durationMs = row.durationMs;
  if (row.totalCostUSD != null) meta.totalCostUSD = row.totalCostUSD;
  if (row.title) meta.title = row.title;
  if (row.seedText) meta.seedText = row.seedText;
  if (row.pinned) meta.pinned = true;
  if (row.leaders) {
    // Defensive: a corrupted row (manual edit, partial migration) should
    // not blow up the whole listing. Drop the field instead and let the
    // legacy leaderA/leaderB carry the run.
    try {
      const parsed = JSON.parse(row.leaders);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        meta.leaders = parsed;
      }
    } catch {
      void 0;
    }
  }
  return meta;
}

/**
 * Pull common metadata fields out of the raw event stream.
 *
 * The orchestrator emits `active_scenario` near the start of every run
 * with `{ name, id, ... }`. Actor names appear in the `setup` event or
 * the parallel `status` event. We extract these by scanning the SSE blobs
 * once so the metadata in the listing endpoint is rich enough to pick a
 * session without having to load it.
 *
 * The cost: a `complete` frame's aggregate `cost.totalCostUSD`, as older
 * runs wrote it, when one is present. Otherwise each actor's last
 * cumulative `_cost.totalCostUSD` (one tracker per actor, carried inside a
 * sim frame's `data` or at its top), summed over the actors; a verdict's
 * cost is not an actor's and is left out.
 */
function deriveMetadata(events: TimestampedEvent[]): SessionMetaOverride {
  const out: SessionMetaOverride = {};
  const actorCosts = new Map<string, number>();
  let aggregateCost: number | undefined;
  for (const { sse } of events) {
    const lines = sse.split('\n');
    if (lines.length < 2) continue;
    const eventType = lines[0]?.replace(/^event:\s*/, '').trim();
    const dataLine = lines[1]?.replace(/^data:\s*/, '');
    if (!eventType || !dataLine) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataLine);
    } catch {
      continue;
    }
    // The orchestrator wraps every engine-emitted event in
    // `broadcast('sim', {type: <realType>, ...})`. So we treat the
    // nested `type` as the authoritative event kind for sim frames,
    // and otherwise fall back to the SSE event name.
    const innerType = eventType === 'sim' && typeof data.type === 'string'
      ? data.type
      : eventType;
    if (eventType === 'active_scenario') {
      if (typeof data.id === 'string') out.scenarioId = data.id;
      if (typeof data.name === 'string') out.scenarioName = data.name;
      // server-app threads the original seed prompt into the active_scenario
      // payload when the run originated from compile-from-seed. Truncate
      // to 1000 chars so the listing payload stays under control even
      // for paste-the-whole-PDF cases.
      if (typeof data.seedText === 'string' && data.seedText.trim().length > 0) {
        out.seedText = data.seedText.slice(0, 1000);
      }
    }
    // Two paths to the actor roster:
    //   1. Legacy SSE `event: setup` frames (kept so callers that
    //      pre-wrap-style feed events — including the test suite — keep
    //      working).
    //   2. Live prod path: pair-runner emits `event: status` with
    //      `phase: 'parallel'` at launch carrying the actors array
    //      (renamed from `leaders` in 0.8.0).
    if (eventType === 'setup') {
      const leaderA = (data as { leaderA?: { name?: string } }).leaderA?.name;
      const leaderB = (data as { leaderB?: { name?: string } }).leaderB?.name;
      if (typeof leaderA === 'string') out.leaderA = leaderA;
      if (typeof leaderB === 'string') out.leaderB = leaderB;
    }
    if (eventType === 'status' && data.phase === 'parallel') {
      const actors = Array.isArray((data as { actors?: unknown[] }).actors)
        ? (data as { actors: Array<{ name?: string }> }).actors
        : [];
      if (typeof actors[0]?.name === 'string') out.leaderA = actors[0].name;
      if (typeof actors[1]?.name === 'string') out.leaderB = actors[1].name;
      // Capture the full roster for 3+ actor runs so the replay UI can
      // render "Aria, Maria, Atlas, Reyes, +5 more" instead of falling
      // back to "Aria vs Maria" on a 9-actor run. Only stamp it when
      // actually >=3 actors — pair runs leave it absent and rely on
      // leaderA/leaderB.
      if (actors.length >= 3) {
        const names = actors
          .map((a) => (typeof a?.name === 'string' ? a.name : null))
          .filter((n): n is string => n != null && n.length > 0);
        if (names.length >= 3) out.leaders = names;
      }
    }
    // Count the highest `turn` observed. innerType covers both the
    // wrapped prod shape (`event: sim` + data.type=turn_done) and the
    // unwrapped legacy shape (`event: turn_done`) via the fallback
    // above. The wrapped shape carries the turn in its inner `data`
    // (`{type, leader, data: {turn, ...}}`), the legacy shape at the top.
    if (innerType === 'turn_done') {
      const inner = eventType === 'sim' && data.data && typeof data.data === 'object'
        ? data.data as { turn?: number }
        : data as { turn?: number };
      const turn = inner.turn;
      if (typeof turn === 'number' && turn > (out.turnCount ?? 0)) {
        out.turnCount = turn;
      }
    }
    if (innerType === 'complete') {
      const aggregate = (data as { cost?: { totalCostUSD?: unknown } }).cost?.totalCostUSD;
      if (typeof aggregate === 'number') aggregateCost = aggregate;
      continue;
    }
    if (innerType === 'verdict') continue;
    // Each actor's tracker is cumulative, so its highest value is its last.
    const nested = data.data && typeof data.data === 'object'
      ? (data.data as { _cost?: { totalCostUSD?: unknown } })._cost?.totalCostUSD
      : undefined;
    const top = (data as { _cost?: { totalCostUSD?: unknown } })._cost?.totalCostUSD;
    const seenCost = typeof nested === 'number' ? nested : top;
    if (typeof seenCost === 'number') {
      const actor = typeof data.leader === 'string' ? data.leader : '';
      if (seenCost > (actorCosts.get(actor) ?? 0)) actorCosts.set(actor, seenCost);
    }
  }
  const actorSum = [...actorCosts.values()].reduce((sum, cost) => sum + cost, 0);
  if (aggregateCost !== undefined) out.totalCostUSD = aggregateCost;
  else if (actorSum > 0) out.totalCostUSD = actorSum;
  return out;
}
