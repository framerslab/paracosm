/**
 * @fileoverview Persistent storage for completed simulation runs.
 *
 * Captures the SSE event stream of a finished sim into the active
 * SQL backend (default: SQLite via better-sqlite3) so visitors to the
 * hosted demo can replay a saved session at original pacing instead of
 * triggering a fresh LLM-powered run. Bounded ring of N most recent
 * saves (oldest evicted) keeps the file size predictable.
 *
 * Backed by `@framers/sql-storage-adapter` so the same code runs against
 * SQLite, Postgres, sql.js, or IndexedDB without changing call sites.
 * Override the resolver via `STORAGE_ADAPTER=postgres` + `DATABASE_URL`.
 *
 * Single-table schema with the event array stored as a JSON blob — for
 * a ring of 10 saved runs the row count is trivial and full-row reads
 * dominate access patterns. Splitting events into a per-event table
 * would add JOIN cost without any query that benefits.
 *
 * @module paracosm/cli/session-store
 */
import { createDatabase, type StorageAdapter, type DatabaseOptions } from '@framers/sql-storage-adapter';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Default ring size — pinned to the spec's "last 10 or so". */
export const DEFAULT_MAX_SESSIONS = 10;

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
}

/** A full session record, including the event payload for replay. */
export interface StoredSession {
  meta: SessionMeta;
  events: TimestampedEvent[];
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
   * from the event stream, inserts, and evicts the oldest row when the
   * row count exceeds `maxSessions`.
   *
   * Returns the new session's id and (when applicable) the id of the
   * row evicted to make room. Caller can log or surface the eviction.
   */
  saveSession(events: TimestampedEvent[], override?: SessionMetaOverride): Promise<{
    id: string;
    evictedId?: string;
  }>;
  /** Returns metadata for every stored session, newest first. */
  listSessions(): Promise<SessionMeta[]>;
  /** Loads one session in full. Returns `null` when the id is unknown. */
  getSession(id: string): Promise<StoredSession | null>;
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
   * it undefined and lets the env-driven resolver pick.
   */
  databaseOptions?: DatabaseOptions;
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
      leaders TEXT
    );
  `);
  await adapter.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_createdAt ON sessions(createdAt);`);

  // Idempotent schema migration for SQLite: add columns introduced
  // after the original schema landed, without dropping the DB.
  // Postgres tenants spin up with the latest schema directly; SQLite
  // boxes need ADD COLUMN statements to catch up on existing data.
  if (isSqliteAdapter(adapter)) {
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
  }
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
 * @param maxSessions Maximum rows to retain. Defaults to 10. Older
 *   sessions are evicted on save.
 * @param options Optional overrides (e.g. `databaseOptions: { type: 'memory' }`).
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

  let adapterPromise: Promise<StorageAdapter> | null = null;
  function getAdapter(): Promise<StorageAdapter> {
    if (!adapterPromise) {
      adapterPromise = (async () => {
        const adapter = await createDatabase(options.databaseOptions ?? { file: dbPath });
        await bootstrapSchema(adapter);
        return adapter;
      })();
    }
    return adapterPromise;
  }

  return {
    async saveSession(events, override) {
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

      await adapter.run(
        `INSERT INTO sessions
           (id, createdAt, scenarioId, scenarioName, leaderA, leaderB, turnCount, eventCount, durationMs, totalCostUSD, events, seedText, leaders)
         VALUES
           (@id, @createdAt, @scenarioId, @scenarioName, @leaderA, @leaderB, @turnCount, @eventCount, @durationMs, @totalCostUSD, @events, @seedText, @leaders)`,
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
        },
      );

      let evictedId: string | undefined;
      const totalRowsRow = await adapter.get<{ c: number }>('SELECT COUNT(*) AS c FROM sessions');
      const totalRows = totalRowsRow?.c ?? 0;
      if (totalRows > maxSessions) {
        const oldest = await adapter.get<{ id: string }>(
          'SELECT id FROM sessions ORDER BY createdAt ASC LIMIT 1',
        );
        if (oldest) {
          await adapter.run('DELETE FROM sessions WHERE id = ?', [oldest.id]);
          evictedId = oldest.id;
        }
      }

      return evictedId === undefined ? { id } : { id, evictedId };
    },

    async listSessions() {
      const adapter = await getAdapter();
      const rows = await adapter.all<SessionMetaRow>(
        `SELECT id, createdAt, scenarioId, scenarioName, leaderA, leaderB, turnCount, eventCount, durationMs, totalCostUSD, title, seedText, leaders
         FROM sessions ORDER BY createdAt DESC`,
      );
      return rows.map(rowToMeta);
    },

    async getSession(id) {
      const adapter = await getAdapter();
      const row = await adapter.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id]);
      if (!row) return null;
      const events = JSON.parse(row.events) as TimestampedEvent[];
      return { meta: rowToMeta(row), events };
    },

    async count() {
      const adapter = await getAdapter();
      const row = await adapter.get<{ c: number }>('SELECT COUNT(*) AS c FROM sessions');
      return row?.c ?? 0;
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
      return before?.n ?? 0;
    },

    async close() {
      if (!adapterPromise) return;
      const adapter = await adapterPromise;
      await adapter.close();
      adapterPromise = null;
    },
  };
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
}

interface SessionRow extends SessionMetaRow {
  events: string;
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
 * with `{ name, id, ... }`, and `complete` at the end with
 * `{ totalCostUSD, ... }` on its cost payload. Actor names appear in
 * the `setup` event. We extract these by scanning the SSE blobs once
 * so the metadata in the listing endpoint is rich enough to pick a
 * session without having to load it.
 */
function deriveMetadata(events: TimestampedEvent[]): SessionMetaOverride {
  const out: SessionMetaOverride = {};
  let maxCostSeen = 0;
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
    // above.
    if (innerType === 'turn_done') {
      const turn = (data as { turn?: number }).turn;
      if (typeof turn === 'number' && turn > (out.turnCount ?? 0)) {
        out.turnCount = turn;
      }
    }
    // Every sim event carries a cumulative `_cost` payload; `complete`
    // sometimes also carries a top-level `cost`. Track the highest
    // totalCostUSD observed across either so the metadata reflects the
    // full run cost even when the terminal `complete` itself omits it.
    const costCarrier = data as { _cost?: { totalCostUSD?: number }; cost?: { totalCostUSD?: number } };
    const seenCost = costCarrier._cost?.totalCostUSD ?? costCarrier.cost?.totalCostUSD;
    if (typeof seenCost === 'number' && seenCost > maxCostSeen) {
      maxCostSeen = seenCost;
    }
  }
  if (maxCostSeen > 0) out.totalCostUSD = maxCostSeen;
  return out;
}
