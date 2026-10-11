/**
 * RATE_LIMIT, the number of runs per IP address per day on the server's own
 * keys, reads as a whole number of zero or more. Any other value keeps the
 * default of one run and logs one warning that names it, so a typo in the
 * server's environment cannot switch the limit off. The hourly chat limits
 * and the cap on concurrent chat calls read the same way.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';

interface RateLimitStatus {
  limit?: number;
  unlimited?: boolean;
}

/** Starts a server with `env`, reads GET /rate-limit, and returns it with the warnings logged while the server started. */
async function rateLimitWith(env: NodeJS.ProcessEnv): Promise<{ status: RateLimitStatus; warnings: string[] }> {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-rate-limit-'));
  const warn = mock.method(console, 'warn', () => {});
  const unset = { RATE_LIMIT: undefined, CHAT_RATE_LIMIT: undefined, CHAT_RATE_LIMIT_GLOBAL: undefined, CHAT_CONCURRENCY: undefined };
  const server = createMarsServer({ env: { ...process.env, ...unset, ...env, APP_DIR: appDir }, runPairSimulations: async () => {} });
  try {
    server.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/rate-limit`);
    assert.equal(res.status, 200);
    const warnings = warn.mock.calls
      .map((call) => call.arguments.map(String).join(' '))
      .filter((line) => line.includes('[rate-limit]'));
    return { status: (await res.json()) as RateLimitStatus, warnings };
  } finally {
    warn.mock.restore();
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
    rmSync(appDir, { recursive: true, force: true });
  }
}

for (const value of ['abc', '-1', '2.5', '10abc', '']) {
  test(`RATE_LIMIT=${JSON.stringify(value)} keeps the default of one run per IP address per day`, async () => {
    const { status, warnings } = await rateLimitWith({ RATE_LIMIT: value });

    assert.equal(status.unlimited, undefined, 'the limit must stay on');
    assert.equal(status.limit, 1);
    if (value === '') {
      assert.deepEqual(warnings, [], 'an empty value is the same as an unset one');
    } else {
      assert.equal(warnings.length, 1, 'expected one warning');
      assert.ok(warnings[0].includes(JSON.stringify(value)), `the warning must name ${JSON.stringify(value)}: ${warnings[0]}`);
    }
  });
}

test('RATE_LIMIT=3 allows three runs and RATE_LIMIT=0 turns the limit off, without a warning', async () => {
  const three = await rateLimitWith({ RATE_LIMIT: '3' });
  assert.equal(three.status.limit, 3);
  assert.deepEqual(three.warnings, []);

  const off = await rateLimitWith({ RATE_LIMIT: '0' });
  assert.equal(off.status.unlimited, true);
  assert.deepEqual(off.warnings, []);
});

test('a chat limit that is not a whole number logs a warning that names it', async () => {
  const { status, warnings } = await rateLimitWith({ CHAT_RATE_LIMIT: 'many', CHAT_RATE_LIMIT_GLOBAL: 'lots', CHAT_CONCURRENCY: 'four' });

  assert.equal(status.limit, 1);
  assert.equal(warnings.length, 3, `expected one warning per chat limit: ${warnings.join(' | ')}`);
  assert.ok(warnings.some((line) => line.includes('CHAT_RATE_LIMIT=') && line.includes('"many"')));
  assert.ok(warnings.some((line) => line.includes('CHAT_RATE_LIMIT_GLOBAL=') && line.includes('"lots"')));
  assert.ok(warnings.some((line) => line.includes('CHAT_CONCURRENCY=') && line.includes('"four"')));
});
