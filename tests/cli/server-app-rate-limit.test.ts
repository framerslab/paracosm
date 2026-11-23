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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
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


for (const kind of ['run', 'compile'] as const) {
  test(`a host-billed ${kind} logs no client address`, async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'paracosm-limit-logs-'));
    const log = mock.method(console, 'log', () => {});
    const server = createMarsServer({
      env: {
        ...process.env, APP_DIR: appDir, PARACOSM_OUTPUT_DIR: join(appDir, 'runs'),
        PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: 'host-openai-key-of-this-test', PARACOSM_CLIENT_IP_HEADER: '',
        ANTHROPIC_API_KEY: '',
      },
      maxSimsPerDay: 1,
      runHistoryStore: createNoopRunHistoryStore(),
      runPairSimulations: async () => {},
      compileScenario: async json => ({ ...marsScenario, id: String(json.id) }) as never,
    });
    try {
      server.listen(0);
      await once(server, 'listening');
      const { port } = server.address() as { port: number };
      const base = `http://127.0.0.1:${port}`;
      const status = await (await fetch(`${base}/rate-limit`)).json() as { ip: string };
      assert.ok(status.ip);
      const count = kind === 'run' ? 2 : 6;
      for (let i = 0; i < count; i++) {
        const res = await fetch(`${base}/${kind === 'run' ? 'setup' : 'compile'}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(kind === 'run'
            ? { actors: marsScenario.presets[0].leaders, turns: 1, scenarioId: marsScenario.id }
            : { scenario: { id: `log-compile-${i}`, departments: [] }, webSearch: false }),
        });
        await res.text();
        assert.equal(res.status, i === count - 1 ? 429 : 200);
      }
      const lines = log.mock.calls.map(call => call.arguments.map(String).join(' '))
        .filter(line => line.includes('[rate-limit]'));
      assert.ok(lines.length > 0, 'the requests produce limit log lines');
      assert.ok(lines.some(line => /0 remaining of/.test(line)), 'the remaining count is kept');
      for (const line of lines) assert.equal(line.includes(status.ip), false, line);
    } finally {
      log.mock.restore();
      if (server.listening) {
        server.closeAllConnections();
        server.close();
        await once(server, 'close');
      }
      rmSync(appDir, { recursive: true, force: true });
    }
  });
}


test('a run refused at the day\'s limit says when the day\'s count resets, as GET /rate-limit does', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-refusal-reset-'));
  const log = mock.method(console, 'log', () => {});
  const server = createMarsServer({
    env: {
      ...process.env, APP_DIR: appDir, PARACOSM_OUTPUT_DIR: join(appDir, 'runs'),
      PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: 'host-openai-key-of-this-test', PARACOSM_CLIENT_IP_HEADER: '',
      ANTHROPIC_API_KEY: '',
    },
    maxSimsPerDay: 1,
    runHistoryStore: createNoopRunHistoryStore(),
    runPairSimulations: async () => {},
  });
  try {
    server.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    const base = `http://127.0.0.1:${port}`;
    const post = () => fetch(`${base}/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actors: marsScenario.presets[0].leaders, turns: 1, scenarioId: marsScenario.id }),
    });
    const first = await post();
    await first.text();
    assert.equal(first.status, 200);
    const refused = await post();
    assert.equal(refused.status, 429);
    const body = await refused.json() as { remaining?: unknown; resetAt?: unknown };
    const count = await (await fetch(`${base}/rate-limit`)).json() as { remaining: number; resetAt: number };
    assert.equal(body.remaining, 0);
    assert.equal(count.remaining, 0);
    // The page keeps the refusal until a count for a later day says a run is left: it needs this day's reset time.
    assert.equal(body.resetAt, count.resetAt);
  } finally {
    log.mock.restore();
    if (server.listening) {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('limit log lines name no client address', () => {
  const source = readFileSync(new URL('../../src/server/server-app.ts', import.meta.url), 'utf8');
  const logs = [...source.matchAll(/`(?:\\[\s\S]|[^`\\])*`/g)]
    .map(match => match[0]).filter(literal => literal.includes('[rate-limit]'));
  assert.ok(logs.length >= 10, 'covers the limit log statements');
  for (const literal of logs) {
    const expressions = [...literal.matchAll(/\$\{([^}]*)\}/g)].map(match => match[1]);
    for (const expression of expressions) {
      assert.doesNotMatch(expression, /\b(?:ip|rateIp|clientIp|\w*address\w*)\b/i);
    }
  }
});
