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
 *   - WAITLIST_FROM (optional, defaults to "Paracosm <team@frame.dev>")
 *   - APP_DIR (optional, defaults to cwd; controls where data/waitlist.db lives)
 *
 * The script intentionally has no built-in tracking of "already sent" — run
 * it once per cohort. There's a 200ms sleep between sends to stay polite to
 * Resend's rate limit.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWaitlistStore } from '../src/server/stores/waitlist.js';
import { sendEmail } from '../src/server/services/email.js';
import { renderYoureIn } from '../src/server/services/email-templates.js';

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

  const dbPath = resolve(process.env.APP_DIR || '.', 'data', 'waitlist.db');
  if (!existsSync(dbPath)) {
    process.stderr.write(`waitlist.db not found at ${dbPath}\n`);
    process.exit(1);
  }
  const from = process.env.WAITLIST_FROM || 'Paracosm <team@frame.dev>';

  if (!dryRun && !process.env.RESEND_API_KEY) {
    process.stderr.write('RESEND_API_KEY missing — refusing to send. Use --dry-run to preview.\n');
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
  for (const entry of targets) {
    const rendered = renderYoureIn({ email: entry.email, name: entry.name });
    if (dryRun) {
      process.stdout.write(`[dry-run] would send to ${entry.email} (${entry.userType})\n`);
      sent += 1;
      continue;
    }
    const ok = await sendEmail({
      from,
      to: entry.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: 'team@frame.dev',
    });
    if (ok) {
      sent += 1;
      process.stdout.write(`[ok] ${entry.email}\n`);
    } else {
      failed += 1;
      process.stdout.write(`[fail] ${entry.email}\n`);
    }
    await sleep(200);
  }

  process.stdout.write(`[broadcast] done: sent=${sent} failed=${failed}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  process.stderr.write(`FATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
