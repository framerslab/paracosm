/**
 * The landing-page waitlist is closed. POST /api/waitlist answers
 * 410 `{ error: 'waitlist_closed' }`, and the server leaves the stored
 * signups alone: it opens the waitlist store only when
 * PARACOSM_WAITLIST_STORE=1 asks it to, and then only to read it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer, type MarsServer } from '../../src/server/server-app.js';
import { createWaitlistStore } from '../../src/server/stores/waitlist.js';

/** The test process env without the waitlist flag, so a developer's shell cannot change the outcome. */
function serverEnv(appDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, APP_DIR: appDir };
  delete env.PARACOSM_WAITLIST_STORE;
  return env;
}

async function listen(server: MarsServer): Promise<number> {
  server.listen(0);
  await once(server, 'listening');
  return (server.address() as { port: number }).port;
}

function postSignup(port: number, email: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/waitlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name: 'Reader', useCase: 'Trying the closed route' }),
  });
}

function logLines(spy: { mock: { calls: ReadonlyArray<{ arguments: readonly unknown[] }> } }): string[] {
  return spy.mock.calls.map((call) => call.arguments.map(String).join(' '));
}

test('POST /api/waitlist answers 410 waitlist_closed and the server never opens the waitlist store', async (t) => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-waitlist-closed-'));
  const logSpy = t.mock.method(console, 'log');
  const server = createMarsServer({ env: serverEnv(appDir), runPairSimulations: async () => {} });
  const port = await listen(server);
  try {
    const res = await postSignup(port, 'reader@example.com');

    assert.equal(res.status, 410);
    assert.deepEqual(await res.json(), { error: 'waitlist_closed' });
    assert.equal(existsSync(join(appDir, 'data', 'waitlist.db')), false, 'a closed waitlist must not create the store');
    assert.ok(
      !logLines(logSpy).some((line) => line.includes('[waitlist]')),
      'without PARACOSM_WAITLIST_STORE=1 the server must not open the waitlist store',
    );
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('PARACOSM_WAITLIST_STORE=1 opens the stored signups for reading and the route still answers 410', async (t) => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-waitlist-export-'));
  const store = createWaitlistStore({ dbPath: join(appDir, 'data', 'waitlist.db') });
  await store.insertOrGetExisting({ email: 'first@example.com' });
  await store.insertOrGetExisting({ email: 'second@example.com' });

  const logSpy = t.mock.method(console, 'log');
  const server = createMarsServer({
    env: { ...serverEnv(appDir), PARACOSM_WAITLIST_STORE: '1' },
    runPairSimulations: async () => {},
  });
  const port = await listen(server);
  try {
    // The server counts the stored signups in the background once it starts.
    const deadline = Date.now() + 10_000;
    while (!logLines(logSpy).some((line) => line.includes('[waitlist]')) && Date.now() < deadline) {
      await new Promise((wait) => setTimeout(wait, 25));
    }
    const waitlistLine = logLines(logSpy).find((line) => line.includes('[waitlist]')) ?? '';
    assert.match(waitlistLine, /\(2 signups/, `expected the stored signup count in the server log, got: "${waitlistLine}"`);

    const res = await postSignup(port, 'third@example.com');

    assert.equal(res.status, 410);
    assert.deepEqual(await res.json(), { error: 'waitlist_closed' });
    assert.equal(await store.count(), 2, 'a closed waitlist must not add a row');
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  }
});
