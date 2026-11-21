import test from 'node:test';
import assert from 'node:assert/strict';
import { request, type IncomingHttpHeaders } from 'node:http';
import { rmSync } from 'node:fs';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { mars, settingsBody, startServer, type RunServer, type RunServerOptions } from './helpers/run-server.js';

const crossSiteHeaders = {
  Origin: 'https://elsewhere.example',
  'Sec-Fetch-Site': 'cross-site',
  'Content-Type': 'text/plain;charset=UTF-8',
};
const simulateBody = {
  scenario: { id: 's1' },
  leader: {
    name: 'A', archetype: 'Pragmatist', unit: 'Crew', instructions: '',
    hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
  },
};

interface Answer { status: number; headers: IncomingHttpHeaders; text: string }
function send(api: RunServer, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  const url = new URL(path, api.base);
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: url.hostname, port: url.port, path, method: data === undefined ? 'GET' : 'POST', headers, timeout: 5000 }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('no answer within 5 s')));
    req.on('error', reject);
    req.end(data);
  });
}

async function withServer(body: (api: RunServer, calls: { compile: number; seed: number }) => Promise<void>, options: RunServerOptions = {}): Promise<void> {
  const calls = { compile: 0, seed: 0 };
  const api = await startServer({
    ...options,
    env: {
      PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: 'host-openai-key-of-this-test', PARACOSM_PLATFORM_API: '', PARACOSM_ALLOWED_ORIGINS: '',
      PARACOSM_ENABLE_SIMULATE_ENDPOINT: '', FIRECRAWL_API_KEY: '', ...options.env,
    },
    compileScenario: async json => {
      calls.compile++;
      if (options.compileScenario) return options.compileScenario(json, {});
      return { ...marsScenario, id: String(json.id) };
    },
    extra: { compileFromSeed: () => { calls.seed++; return new Promise(() => {}); } },
  });
  try { await body(api, calls); } finally {
    await api.close();
    rmSync(api.appDir, { recursive: true, force: true });
  }
}

function refusal(answer: Answer) {
  return {
    status: answer.status,
    error: answer.text.startsWith('{') ? JSON.parse(answer.text).error : undefined,
    cors: answer.headers['access-control-allow-origin'],
    cookie: answer.headers['set-cookie'],
  };
}
const hostedRefusal = { status: 403, error: 'cross_site_refused', cors: '*', cookie: undefined };

test('a keyless /setup from a page on another site opens no run and sets no cookie on the hosted demo', async t => {
  const forms: Array<[string, Record<string, string>]> = [
    ['cross-site headers', crossSiteHeaders],
    ['Origin alone', { Origin: 'https://elsewhere.example' }],
    ['null Origin', { Origin: 'null' }],
    ['unknown site value', { Origin: 'https://elsewhere.example', 'Sec-Fetch-Site': 'unknown-value' }],
    ['site header alone', { 'Sec-Fetch-Site': 'cross-site' }],
  ];
  for (const [name, headers] of forms) await t.test(name, async () => {
    await withServer(async api => {
      const answer = await send(api, '/setup', settingsBody(mars), { 'Content-Type': 'text/plain;charset=UTF-8', ...headers });
      const quota = JSON.parse((await send(api, '/rate-limit')).text);
      assert.deepEqual({ ...refusal(answer), launches: api.launches.length, remaining: quota.remaining },
        { ...hostedRefusal, launches: 0, remaining: 1 });
    }, { maxSimsPerDay: 1 });
  });
});

test('keyless /compile, compile-from-seed, /chat and /scenario/switch from a page on another site spend nothing on the hosted demo', async t => {
  await withServer(async (api, calls) => {
    const cases: Array<[string, unknown]> = [
      ['/compile', { scenario: { id: 'cross-site-compile', departments: [] } }],
      ['/api/quickstart/compile-from-seed', { seedText: 'Request site checks: a river town plans shared reservoirs, farms and a new water council. '.repeat(3).slice(0, 240) }],
      ['/chat', { agentId: 'a', message: 'hello' }],
      ['/scenario/switch', { id: 'lunar-outpost' }],
    ];
    for (const [path, body] of cases) await t.test(path, async () => {
      const before = { ...calls };
      const answer = await send(api, path, body, crossSiteHeaders);
      assert.deepEqual({ ...refusal(answer), compileCalls: calls.compile - before.compile, seedCalls: calls.seed - before.seed },
        { ...hostedRefusal, compileCalls: 0, seedCalls: 0 });
    });
    await t.test('the hourly chat and daily compile limits count none of them', async () => {
      const refused: number[] = [];
      for (let i = 0; i < 5; i++) {
        refused.push((await send(api, '/compile', { scenario: { id: `cross-site-limit-${i}`, departments: [] } }, crossSiteHeaders)).status);
      }
      const compile = await send(api, '/compile', { scenario: { id: 'no-origin-compile', departments: [] } });
      const chat = await send(api, '/chat', { agentId: 'a', message: 'hello' });
      assert.deepEqual({ refused, compile: compile.status, chat: chat.status }, { refused: [403, 403, 403, 403, 403], compile: 200, chat: 400 });
    });
  }, { maxSimsPerDay: 1, env: { CHAT_RATE_LIMIT: '1' } });
});

test('an own-key /compile with a seed from a page on another site is refused on the hosted demo', async t => {
  await withServer(async (api, calls) => {
    const seeds = ['a short brief', ['a short brief'], '   '];
    for (const [i, seedText] of seeds.entries()) await t.test(['text seed', 'array seed', 'blank seed'][i], async () => {
      const before = calls.compile;
      const answer = await send(api, '/compile', { scenario: { id: `own-seed-${i}`, departments: [] }, apiKey: 'sk-test', seedText }, crossSiteHeaders);
      assert.deepEqual({ ...refusal(answer), compileCalls: calls.compile - before }, { ...hostedRefusal, compileCalls: 0 });
    });
  }, { maxSimsPerDay: 1 });
});

test('a keyless /simulate from a page on another site spends nothing on the hosted demo', async () => {
  await withServer(async (api, calls) => {
    const answer = await send(api, '/simulate', simulateBody, crossSiteHeaders);
    const quota = JSON.parse((await send(api, '/rate-limit')).text);
    assert.deepEqual({ ...refusal(answer), compileCalls: calls.compile, remaining: quota.remaining },
      { ...hostedRefusal, compileCalls: 0, remaining: 1 });
  }, { maxSimsPerDay: 1, env: { PARACOSM_ENABLE_SIMULATE_ENDPOINT: 'true' }, compileScenario: async () => { throw new Error('compile unavailable'); } });
});

test('an own-key /setup from a page on another site runs', async () => {
  await withServer(async api => {
    assert.equal((await send(api, '/setup', { ...settingsBody(mars), apiKey: 'sk-test' }, crossSiteHeaders)).status, 200);
    assert.equal(api.launches.length, 1);
  });
});

test('/setup with neither Origin nor Sec-Fetch-Site runs', async () => {
  await withServer(async api => { assert.equal((await send(api, '/setup', settingsBody(mars))).status, 200); });
});

test("/setup from the demo's own page runs", async () => {
  await withServer(async api => {
    for (const headers of [
      { Origin: api.base, 'Sec-Fetch-Site': 'same-origin' },
      { Origin: api.base },
      { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' },
    ] as Array<Record<string, string>>) {
      assert.equal((await send(api, '/setup', settingsBody(mars), headers)).status, 200);
    }
  });
});

test("a listed origin counts as the demo's own", async () => {
  await withServer(async api => {
    assert.equal((await send(api, '/setup', settingsBody(mars), { Origin: 'https://embed.example', 'Sec-Fetch-Site': 'cross-site' })).status, 200);
  }, { env: { PARACOSM_ALLOWED_ORIGINS: 'https://embed.example' } });
});

test('with origins listed, a keyless /setup from any other origin is refused whatever Sec-Fetch-Site says', async t => {
  const forms: Array<[string, (port: string) => Record<string, string>]> = [
    ['Origin equal to Host', port => ({ Host: `other.example:${port}`, Origin: `http://other.example:${port}` })],
    ['same-origin site header', () => ({ Origin: 'https://other.example', 'Sec-Fetch-Site': 'same-origin' })],
  ];
  for (const [name, headersFor] of forms) await t.test(name, async () => {
    await withServer(async api => {
      const headers = { 'Content-Type': 'text/plain;charset=UTF-8', ...headersFor(new URL(api.base).port) };
      const answer = await send(api, '/setup', settingsBody(mars), headers);
      const quota = JSON.parse((await send(api, '/rate-limit')).text);
      assert.deepEqual({ ...refusal(answer), launches: api.launches.length, remaining: quota.remaining },
        { ...hostedRefusal, launches: 0, remaining: 1 });
    }, { maxSimsPerDay: 1, env: { PARACOSM_ALLOWED_ORIGINS: 'https://paracosm.example' } });
  });
});

test("with origins listed, the listed origin, a null Origin from the demo's own page and a request with neither header run", async () => {
  await withServer(async api => {
    const statuses: number[] = [];
    for (const headers of [
      { Origin: 'https://paracosm.example', 'Sec-Fetch-Site': 'same-origin' },
      { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' },
      {},
      { 'Sec-Fetch-Site': 'cross-site' },
    ] as Array<Record<string, string>>) {
      statuses.push((await send(api, '/setup', settingsBody(mars), headers)).status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 403]);
  }, { env: { PARACOSM_ALLOWED_ORIGINS: 'https://paracosm.example' } });
});

test("an own-key /compile from a page on another site compiles when it uses none of the host's keys", async () => {
  await withServer(async (api, calls) => {
    for (const [i, seed] of [{}, { seedText: 'a short brief', webSearch: false }].entries()) {
      const answer = await send(api, '/compile', { scenario: { id: `own-compile-${i}`, departments: [] }, apiKey: 'sk-test', ...seed }, crossSiteHeaders);
      assert.equal(answer.status, 200);
      assert.match(answer.headers['content-type'] ?? '', /text\/event-stream/);
      assert.equal(calls.compile, i + 1);
    }
  });
});

test('/simulate with neither Origin nor Sec-Fetch-Site runs', async () => {
  await withServer(async (api, calls) => {
    assert.equal((await send(api, '/simulate', simulateBody)).status, 502);
    assert.equal(calls.compile, 1);
  }, { env: { PARACOSM_ENABLE_SIMULATE_ENDPOINT: 'true' }, compileScenario: async () => { throw new Error('compile unavailable'); } });
});

test('a local server keeps its own check', async () => {
  await withServer(async api => {
    const answer = await send(api, '/setup', settingsBody(mars), crossSiteHeaders);
    assert.deepEqual({ ...refusal(answer), launches: api.launches.length }, { ...hostedRefusal, cors: undefined, launches: 0 });
  }, { env: { PARACOSM_HOSTED_DEMO: '', HOST: '', PARACOSM_ALLOWED_HOSTS: '' } });
});
