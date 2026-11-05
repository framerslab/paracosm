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
 * @module paracosm/cli/server/mail-suppression-store
 */
import { createDatabase, type StorageAdapter, type DatabaseOptions } from '@framers/sql-storage-adapter';
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

export interface OpenMailStoreOptions {
  /** SQLite file path, opened unless `databaseOptions` is given. Created with its folder when missing. */
  dbPath?: string;
  /** Direct override for `createDatabase`. Tests pass `{ file: ':memory:' }`. */
  databaseOptions?: DatabaseOptions;
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

export function openMailStore(options: OpenMailStoreOptions): MailStore {
  const { dbPath, databaseOptions } = options;
  if (dbPath && dbPath !== ':memory:' && !databaseOptions?.type) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  let adapterPromise: Promise<StorageAdapter> | null = null;
  function getAdapter(): Promise<StorageAdapter> {
    if (!adapterPromise) {
      adapterPromise = (async () => {
        const adapter = await createDatabase(databaseOptions ?? { file: dbPath ?? ':memory:' });
        await bootstrap(adapter);
        return adapter;
      })();
    }
    return adapterPromise;
  }

  async function suppressHash(hash: string, reason: SuppressionReason): Promise<void> {
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

  async function addressOfToken(token: string): Promise<string | null> {
    if (!UNSUBSCRIBE_TOKEN_PATTERN.test(token)) return null;
    const adapter = await getAdapter();
    const row = await adapter.get<{ address_hash: string }>(
      `SELECT address_hash FROM mail_unsubscribe_tokens WHERE token_hash = ? LIMIT 1`,
      [tokenHash(token)],
    );
    return row?.address_hash ?? null;
  }

  async function isHashSuppressed(hash: string): Promise<boolean> {
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
      const adapter = await adapterPromise;
      adapterPromise = null;
      await adapter.close();
    },
  };
}
