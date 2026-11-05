import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..', '..');

/** Runs Node with tsx from the repository root, the way the script is run by hand. */
function runNode(args: string[], env: NodeJS.ProcessEnv) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete childEnv.STORAGE_ADAPTER;
  return spawnSync(process.execPath, ['--import', 'tsx', ...args], { cwd: root, env: childEnv, encoding: 'utf8' });
}

/** Runs Node with tsx without blocking this process, so a stub server here can answer the child. */
function runNodeAsync(
  args: string[],
  env: NodeJS.ProcessEnv,
  stdin = '',
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete childEnv.STORAGE_ADAPTER;
  const child = spawn(process.execPath, ['--import', 'tsx', ...args], { cwd: root, env: childEnv });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  child.stdin.end(stdin);
  return new Promise((done) => child.on('close', (status) => done({ status, stdout, stderr })));
}

/** Seeds signups in a child process that exits, so this process holds no open handle. */
function seedSignups(appDir: string, emails: string[]): void {
  const seed = runNode(
    [
      '--input-type=module',
      '-e',
      `const { createWaitlistStore } = await import(${JSON.stringify(pathToFileURL(resolve(root, 'src/server/stores/waitlist.ts')).href)});
       const store = createWaitlistStore({ dbPath: process.env.SEED_DB });
       for (const email of JSON.parse(process.env.SEED_EMAILS)) await store.insertOrGetExisting({ email, name: 'Reader' });
       process.exit(0);`,
    ],
    { SEED_DB: join(appDir, 'data', 'waitlist.db'), SEED_EMAILS: JSON.stringify(emails) },
  );
  assert.equal(seed.status, 0, seed.stderr);
}

/** A local stand-in for the Resend API that records every email it is asked to send. */
async function resendStub() {
  const sent: Array<{ to: string; text: string; html: string; headers?: Record<string, string> }> = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (raw += chunk));
    req.on('end', () => {
      sent.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ id: `msg_${sent.length}` }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    sent,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

test('the waitlist broadcast script lists its recipients in a dry run', () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-broadcast-'));
  try {
    seedSignups(appDir, ['reader@example.com']);

    const result = runNode(['scripts/send-waitlist-broadcast.ts', '--dry-run'], { APP_DIR: appDir, RESEND_API_KEY: '' });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[broadcast\] 1\/1 recipients selected/);
    assert.match(result.stdout, /\[dry-run\] would send to reader@example\.com/);
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('a real broadcast refuses to start without the postal address and sends nothing', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-broadcast-postal-'));
  const stub = await resendStub();
  try {
    seedSignups(appDir, ['reader@example.com']);

    const result = await runNodeAsync(['scripts/send-waitlist-broadcast.ts'], {
      APP_DIR: appDir,
      RESEND_API_KEY: 're_broadcast_test',
      RESEND_BASE_URL: stub.url,
      MAIL_POSTAL_ADDRESS: '',
    });

    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /MAIL_POSTAL_ADDRESS/);
    assert.equal(stub.sent.length, 0);
  } finally {
    await stub.close();
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('the broadcast skips a suppressed address and every email it sends carries the unsubscribe link and headers', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-broadcast-send-'));
  const stub = await resendStub();
  try {
    seedSignups(appDir, ['reader@example.com', 'kept.out@example.com']);

    // The operator's list arrives on standard input, one address a line.
    const suppress = await runNodeAsync(['scripts/mail-suppress.ts'], { APP_DIR: appDir }, 'Kept.Out@Example.com\nnot an address\n');
    assert.equal(suppress.status, 0, suppress.stderr);
    assert.match(suppress.stdout, /1 address suppressed/);
    assert.equal(suppress.stdout.includes('kept.out'), false, 'the suppression script must not print the addresses');

    const result = await runNodeAsync(['scripts/send-waitlist-broadcast.ts'], {
      APP_DIR: appDir,
      RESEND_API_KEY: 're_broadcast_test',
      RESEND_BASE_URL: stub.url,
      MAIL_POSTAL_ADDRESS: 'Example Sender LLC, 100 Test Street, Testville, NV 89000',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /done: sent=1 failed=0 suppressed=1/);
    assert.equal(result.stdout.includes('kept.out'), false, 'the broadcast must not print a suppressed address');
    assert.deepEqual(stub.sent.map((mail) => mail.to), ['reader@example.com']);
    const [mail] = stub.sent;
    const link = /^<(https:\/\/paracosm\.agentos\.sh\/unsubscribe\?t=[A-Za-z0-9_-]{43})>$/.exec(mail.headers?.['List-Unsubscribe'] ?? '');
    assert.ok(link, `List-Unsubscribe must hold the one-click link, got ${JSON.stringify(mail.headers)}`);
    assert.equal(mail.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.ok(mail.text.includes(`Unsubscribe: ${link[1]}`));
    assert.ok(mail.html.includes(`href="${link[1]}"`));
    assert.ok(mail.text.includes('Example Sender LLC, 100 Test Street, Testville, NV 89000'));
  } finally {
    await stub.close();
    rmSync(appDir, { recursive: true, force: true });
  }
});
