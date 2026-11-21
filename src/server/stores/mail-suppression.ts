/**
 * The mail suppression list and the unsubscribe links, in
 * `${APP_DIR}/data/mail.db`, built on `@framers/sql-storage-adapter` like
 * the other stores here.
 *
 * - `mail_suppressions` holds one row per address that gets no more mail:
 *   `unsubscribed` when the person used a link, `manual` when the operator
 *   added it (`scripts/mail-suppress.ts`). Both stop every email Paracosm
 *   sends, since every one of them is optional.
 * - `mail_unsubscribe_tokens` holds one row per link mailed. A token is 32
 *   random bytes in base64url; only its SHA-256 is kept, beside the hash
 *   of the address it was mailed to. A token can do one thing: suppress
 *   that address.
 *
 * Addresses are kept as a SHA-256 of the lowercased address, so the list
 * names no one. Open a store, use it and close it: the broadcast script
 * and the dashboard server are separate processes, and a store opened per
 * use always reads what the other one wrote.
 *
 * The store runs on better-sqlite3 alone. sql.js, the library's fallback,
 * keeps a private copy of the file per connection and rewrites the whole
 * file on each write, so with two processes at once an unsubscribe could
 * be lost. Where better-sqlite3 cannot load, the store refuses to open:
 * the unsubscribe page answers 503 and the broadcast stops before sending.
 *
 * @module paracosm/cli/server/mail-suppression-store
 */
import {
  createDatabase,
  resolveStorageAdapter,
  type StorageAdapter,
  type DatabaseOptions,
} from '@framers/sql-storage-adapter';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Why an address gets no more mail. */
export type SuppressionReason = 'unsubscribed' | 'manual';

/** A token as it appears in an unsubscribe link: 32 bytes in base64url. */
export const UNSUBSCRIBE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Where the server and the scripts keep the mail store under an app directory. */
export function mailDbPath(appDir: string): string {
  return resolve(appDir, 'data', 'mail.db');
}

/** The key an address is kept under: SHA-256 of the trimmed, lowercased address. */
export function addressHash(address: string): string {
  return createHash('sha256').update(`paracosm-mail\0${address.trim().toLowerCase()}`).digest('hex');
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The suppression list and the unsubscribe tokens, as one open store. Close it after use. */
export interface MailStore {
  /** True when the address gets no more mail. */
  isSuppressed(address: string): Promise<boolean>;
  /** Stops all mail to the address. An operator's `manual` replaces an `unsubscribed`; never the reverse. */
  suppress(address: string, reason: SuppressionReason): Promise<void>;
  /** Draws a new unsubscribe token for one email to this address and keeps its hash. */
  mintUnsubscribeToken(address: string): Promise<string>;
  /** What a token stands for: null when the store does not know it. */
  findToken(token: string): Promise<{ suppressed: boolean } | null>;
  /** Suppresses the address the token was mailed to. False when the token is unknown. */
  unsubscribeByToken(token: string): Promise<boolean>;
  close(): Promise<void>;
}

/** Where {@link openMailStore} opens the store, and whether it may write. */
export interface OpenMailStoreOptions {
  /** SQLite file path, opened unless `databaseOptions` is given. Created with its folder when missing. */
  dbPath?: string;
  /** Direct override for `createDatabase`. Tests pass `{ file: ':memory:' }`. */
  databaseOptions?: DatabaseOptions;
  /**
   * Reads only: SQLite opens the file read-only, no folder or table is
   * created, and every write throws. A store without the tables reads as an
   * empty list. The broadcast's dry run opens the store this way.
   */
  readOnly?: boolean;
}

async function bootstrap(adapter: StorageAdapter): Promise<void> {
  await adapter.exec(`
    CREATE TABLE IF NOT EXISTS mail_suppressions (
      address_hash TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  await adapter.exec(`
    CREATE TABLE IF NOT EXISTS mail_unsubscribe_tokens (
      token_hash TEXT PRIMARY KEY,
      address_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

/**
 * Opens the mail store at `dbPath` on better-sqlite3, creating its folder
 * and tables unless `readOnly`. The database opens on first use; call
 * `close()` when done, so the next opener reads every write.
 */
export function openMailStore(options: OpenMailStoreOptions): MailStore {
  const { dbPath, databaseOptions, readOnly = false } = options;
  if (!readOnly && dbPath && dbPath !== ':memory:' && !databaseOptions?.type) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  let adapterPromise: Promise<StorageAdapter> | null = null;
  function getAdapter(): Promise<StorageAdapter> {
    if (!adapterPromise) {
      adapterPromise = (async () => {
        // A read-only store opens SQLite itself read-only, so no statement can write.
        const adapter = readOnly
          ? await resolveStorageAdapter({
              filePath: databaseOptions?.file ?? dbPath ?? ':memory:',
              priority: ['better-sqlite3'],
              openOptions: { readOnly: true },
            })
          : await createDatabase(databaseOptions ?? { file: dbPath ?? ':memory:', priority: ['better-sqlite3'] });
        try {
          if (!readOnly) await bootstrap(adapter);
        } catch (err) {
          await adapter.close().catch(() => {});
          throw err;
        }
        return adapter;
      })();
    }
    return adapterPromise;
  }

  function refuseWriteWhenReadOnly(): void {
    if (readOnly) throw new Error('This mail store was opened read-only.');
  }

  /** In a read-only store, whether a table exists; a writable store has created both. */
  async function hasTable(name: string): Promise<boolean> {
    if (!readOnly) return true;
    const adapter = await getAdapter();
    const row = await adapter.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      [name],
    );
    return row !== null && row !== undefined;
  }

  /** Records a suppression. `manual` overwrites `unsubscribed`; `unsubscribed` never overwrites anything. */
  async function suppressHash(hash: string, reason: SuppressionReason): Promise<void> {
    refuseWriteWhenReadOnly();
    const adapter = await getAdapter();
    const now = new Date().toISOString();
    if (reason === 'manual') {
      await adapter.run(
        `INSERT INTO mail_suppressions (address_hash, reason, created_at) VALUES (?, ?, ?)
         ON CONFLICT (address_hash) DO UPDATE SET reason = excluded.reason`,
        [hash, reason, now],
      );
    } else {
      await adapter.run(
        `INSERT INTO mail_suppressions (address_hash, reason, created_at) VALUES (?, ?, ?)
         ON CONFLICT (address_hash) DO NOTHING`,
        [hash, reason, now],
      );
    }
  }

  /** The address hash a token was mailed to, or null for a malformed or unknown token. */
  async function addressOfToken(token: string): Promise<string | null> {
    if (!UNSUBSCRIBE_TOKEN_PATTERN.test(token)) return null;
    if (!(await hasTable('mail_unsubscribe_tokens'))) return null;
    const adapter = await getAdapter();
    const row = await adapter.get<{ address_hash: string }>(
      `SELECT address_hash FROM mail_unsubscribe_tokens WHERE token_hash = ? LIMIT 1`,
      [tokenHash(token)],
    );
    return row?.address_hash ?? null;
  }

  /** Whether an address hash is on the list, under either reason. */
  async function isHashSuppressed(hash: string): Promise<boolean> {
    if (!(await hasTable('mail_suppressions'))) return false;
    const adapter = await getAdapter();
    const row = await adapter.get<{ reason: string }>(
      `SELECT reason FROM mail_suppressions WHERE address_hash = ? LIMIT 1`,
      [hash],
    );
    return row !== null && row !== undefined;
  }

  return {
    async isSuppressed(address) {
      return isHashSuppressed(addressHash(address));
    },

    async suppress(address, reason) {
      await suppressHash(addressHash(address), reason);
    },

    async mintUnsubscribeToken(address) {
      refuseWriteWhenReadOnly();
      const adapter = await getAdapter();
      const token = randomBytes(32).toString('base64url');
      await adapter.run(
        `INSERT INTO mail_unsubscribe_tokens (token_hash, address_hash, created_at) VALUES (?, ?, ?)`,
        [tokenHash(token), addressHash(address), new Date().toISOString()],
      );
      return token;
    },

    async findToken(token) {
      const hash = await addressOfToken(token);
      if (!hash) return null;
      return { suppressed: await isHashSuppressed(hash) };
    },

    async unsubscribeByToken(token) {
      const hash = await addressOfToken(token);
      if (!hash) return false;
      await suppressHash(hash, 'unsubscribed');
      return true;
    },

    async close() {
      if (!adapterPromise) return;
      const pending = adapterPromise;
      adapterPromise = null;
      let adapter: StorageAdapter;
      try {
        adapter = await pending;
      } catch {
        // The store never opened, and the call that used it already got the
        // error; there is nothing to close.
        return;
      }
      await adapter.close();
    },
  };
}
