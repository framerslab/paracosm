#!/usr/bin/env npx tsx
/**
 * Broadcast a "you're in" email to every row in the waitlist DB.
 *
 * Usage (run from the paracosm working directory or with APP_DIR set):
 *
 *   ./scripts/send-waitlist-broadcast.ts                 # send to everyone
 *   ./scripts/send-waitlist-broadcast.ts --dry-run       # list recipients, send nothing
 *   ./scripts/send-waitlist-broadcast.ts --only=a@x.co   # restrict to one or more emails (comma-separated)
 *
 * Env requirements:
 *   - RESEND_API_KEY (required for actual sends; dry-run skips this)
 *   - MAIL_POSTAL_ADDRESS (required for actual sends): the sender's postal
 *     address, printed in every email's footer as commercial email must
 *     carry it (15 U.S.C. 7704(a)(5)). Without it the script sends nothing.
 *   - WAITLIST_FROM (optional, defaults to "Paracosm <team@frame.dev>")
 *   - MAIL_LINK_BASE (optional, defaults to https://paracosm.agentos.sh): the
 *     site whose /unsubscribe page the links open
 *   - APP_DIR (optional, defaults to cwd; controls where data/waitlist.db and
 *     data/mail.db live)
 *
 * Every email goes through sendOptionalEmail: an address on the suppression
 * list (data/mail.db: people who used an unsubscribe link, and addresses
 * added with scripts/mail-suppress.ts) gets nothing, and every email that
 * goes carries its own Unsubscribe link and the List-Unsubscribe and
 * List-Unsubscribe-Post headers. The list is read again before each send.
 * Suppressed addresses are counted, never printed.
 *
 * The script intentionally has no built-in tracking of "already sent" — run
 * it once per cohort. There's a 200ms sleep between sends to stay polite to
 * Resend's rate limit.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWaitlistStore } from '../src/server/stores/waitlist.js';
import { renderYoureIn } from '../src/server/services/email-templates.js';
import { sendOptionalEmail, DEFAULT_MAIL_LINK_BASE } from '../src/server/services/optional-mail.js';
import { mailDbPath, openMailStore } from '../src/server/stores/mail-suppression.js';

function loadEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

function parseArgs(): { dryRun: boolean; only: string[] | null } {
  const argv = process.argv.slice(2);
  let dryRun = false;
  let only: string[] | null = null;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--only=')) {
      only = a
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else {
      process.stderr.write(`Unknown arg: ${a}\n`);
      process.exit(2);
    }
  }
  return { dryRun, only };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  loadEnv();
  const { dryRun, only } = parseArgs();

  const appDir = process.env.APP_DIR || '.';
  const dbPath = resolve(appDir, 'data', 'waitlist.db');
  if (!existsSync(dbPath)) {
    process.stderr.write(`waitlist.db not found at ${dbPath}\n`);
    process.exit(1);
  }
  const mailDb = mailDbPath(appDir);
  const from = process.env.WAITLIST_FROM || 'Paracosm <team@frame.dev>';
  const postalAddress = (process.env.MAIL_POSTAL_ADDRESS ?? '').trim();
  const linkBase = process.env.MAIL_LINK_BASE || DEFAULT_MAIL_LINK_BASE;

  if (!dryRun && !process.env.RESEND_API_KEY) {
    process.stderr.write('RESEND_API_KEY missing — refusing to send. Use --dry-run to preview.\n');
    process.exit(1);
  }
  if (!dryRun && !postalAddress) {
    process.stderr.write(
      'MAIL_POSTAL_ADDRESS missing: every email must carry the sender\'s postal address. Refusing to send. Use --dry-run to preview.\n',
    );
    process.exit(1);
  }

  const store = createWaitlistStore({ dbPath });
  const all = await store.listAll();
  const targets = only
    ? all.filter((e) => only.includes(e.email.toLowerCase()))
    : all;

  process.stdout.write(`[broadcast] db=${dbPath} from=${from} dryRun=${dryRun}\n`);
  process.stdout.write(`[broadcast] ${targets.length}/${all.length} recipients selected\n`);

  if (targets.length === 0) {
    process.stdout.write('[broadcast] no recipients — exiting\n');
    return;
  }

  let sent = 0;
  let failed = 0;
  let suppressed = 0;
  for (const entry of targets) {
    if (dryRun) {
      // A dry run writes nothing: it reads the suppression list only if one exists.
      if (await isSuppressedReadOnly(mailDb, entry.email)) {
        suppressed += 1;
        continue;
      }
      process.stdout.write(`[dry-run] would send to ${entry.email} (${entry.userType})\n`);
      sent += 1;
      continue;
    }
    const result = await sendOptionalEmail({
      mailDbPath: mailDb,
      from,
      to: entry.email,
      replyTo: 'team@frame.dev',
      postalAddress,
      linkBase,
      render: (footer) => renderYoureIn({ email: entry.email, name: entry.name, ...footer }),
    });
    if (result === 'suppressed') {
      suppressed += 1;
      continue;
    }
    if (result === 'sent') {
      sent += 1;
      process.stdout.write(`[ok] ${entry.email}\n`);
    } else {
      failed += 1;
      process.stdout.write(`[fail] ${entry.email}\n`);
    }
    await sleep(200);
  }

  process.stdout.write(`[broadcast] done: sent=${sent} failed=${failed} suppressed=${suppressed}\n`);
  if (failed > 0) process.exit(1);
}

async function isSuppressedReadOnly(mailDb: string, address: string): Promise<boolean> {
  if (!existsSync(mailDb)) return false;
  const store = openMailStore({ dbPath: mailDb });
  try {
    return await store.isSuppressed(address);
  } finally {
    await store.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`FATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
