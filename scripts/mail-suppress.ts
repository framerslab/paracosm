#!/usr/bin/env npx tsx
/**
 * Adds addresses to the mail suppression list, so Paracosm sends them
 * nothing: a person who asked by email to stop, or any address that must
 * never be mailed.
 *
 * Usage (run from the paracosm working directory or with APP_DIR set):
 *
 *   ./scripts/mail-suppress.ts < addresses.txt
 *
 * Standard input holds one address a line; a line without an @ is skipped.
 * Each address is kept as a hash (src/server/stores/mail-suppression.ts) in
 * data/mail.db under APP_DIR, the store the broadcast script reads before
 * every send. The script prints counts only, never an address, and sends
 * no email.
 */
import { mailDbPath, openMailStore } from '../src/server/stores/mail-suppression.js';

async function readStdin(): Promise<string> {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

async function main(): Promise<void> {
  const lines = (await readStdin()).split('\n').map((line) => line.trim()).filter(Boolean);
  const addresses = lines.filter((line) => /^[^\s@]+@[^\s@]+$/.test(line));
  const skipped = lines.length - addresses.length;

  const store = openMailStore({ dbPath: mailDbPath(process.env.APP_DIR || '.') });
  try {
    for (const address of addresses) await store.suppress(address, 'manual');
  } finally {
    await store.close();
  }

  const noun = addresses.length === 1 ? 'address' : 'addresses';
  process.stdout.write(`[suppress] ${addresses.length} ${noun} suppressed, ${skipped} line${skipped === 1 ? '' : 's'} skipped\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
