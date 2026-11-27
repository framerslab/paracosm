import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { LeaderPromptAnswer } from '../../src/api/leader-prompt.js';
import { DEMO_EXECUTION, DEMO_PROVIDER, scenarioKeyPersonnel } from '../../src/cli/sim-config.js';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { MAX_ORDER_CHARS } from '../../src/engine/presets/fill-instructions.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { GENERAL_AUDIENCE_GUIDANCE } from '../../src/runtime/util/audience.js';
import { formatStateLine } from '../../src/runtime/util/scenario-state.js';
import { hostedRunModels } from '../../src/server/hosted-model-policy.js';
import { captureMarsOpenings, firstCommanderTurn, withPromptRuns } from './helpers/leader-prompt-wire.js';
import { withProviderWire, type WireCall } from './helpers/provider-wire.js';
import { readScenario, waitFor, withVisitors } from './helpers/run-server.js';
import type { Visitor } from './helpers/visitor.js';

test('both Mars commanders receive the original system prompt and opening message byte for byte', async () => {
  const fixture = new URL('../fixtures/leader-prompt/mars-opening.json', import.meta.url);
  const original = JSON.parse(await readFile(fixture, 'utf8')) as Awaited<ReturnType<typeof captureMarsOpenings>>;
  assert.deepEqual(Object.keys(original).sort(), ['aria', 'dietrich']);
  for (const capture of Object.values(original)) {
    assert.deepEqual(Object.keys(capture).sort(), ['opening', 'system']);
    assert.ok(capture.system.length > 0 && capture.opening.length > 0);
  }
  const actual = await captureMarsOpenings();
  for (const leader of ['aria', 'dietrich'] as const) {
    for (const part of ['system', 'opening'] as const) {
      assert.ok(
        Buffer.from(actual[leader][part], 'utf8').equals(Buffer.from(original[leader][part], 'utf8')),
        `${leader}'s ${part} changed from the original wire capture`,
      );
    }
  }
});

const modeHeader = 'X-Paracosm-Prompt-Mode';
const clientAddress = (last: number) => ({ 'x-real-ip': `192.0.2.${last}` });
const trustedAddress = { PARACOSM_CLIENT_IP_HEADER: 'x-real-ip' };
const marsPath = '/leader-prompt?scenario=mars-genesis&place=1';
const marsDraft = readScenario('mars.json');
const lunar = readScenario('lunar.json');
const [aria, dietrich] = marsDraft.presets[0].leaders;

type Limit = { remaining: number; limit: number; allowed: boolean; resetAt: number };

function assertPromptHeaders(response: Response): void {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(response.headers.get('vary')?.toLowerCase().split(/,\s*/), ['cookie', modeHeader.toLowerCase()]);
}

async function readPrompt(visitor: Visitor, scenarioId: string, place = 1, mode?: string): Promise<LeaderPromptAnswer> {
  const query = new URLSearchParams({ scenario: scenarioId, place: String(place) });
  const response = await visitor.get(`/leader-prompt?${query}`, mode ? { headers: { [modeHeader]: mode } } : undefined);
  assert.equal(response.status, 200);
  assertPromptHeaders(response);
  return await response.json() as LeaderPromptAnswer;
}

async function select(visit: Visitor, id: string): Promise<void> {
  assert.equal((await visit.post('/scenario/switch', { id })).status, 200);
}

async function runTurn(visit: Visitor, id: string, actors: readonly object[], seed: number, own = false): Promise<void> {
  const response = await visit.post('/setup', {
    quickstart: { scenarioId: id },
    turns: 1,
    seed,
    actors,
    ...(own ? { apiKey: 'visitor-openai-for-prompt-tests' } : {}),
  });
  assert.equal(response.status, 200);
  await waitFor(async () => (await visit.json<{ isComplete: boolean }>('/results')).isComplete,
    'the pair to finish its first turn', 120_000);
}

function assertWireParity(answer: LeaderPromptAnswer, calls: readonly WireCall[], marker: string): void {
  const { bootstrap, decision } = firstCommanderTurn(calls, marker);
  assert.deepEqual(Buffer.from(answer.parts.system), Buffer.from(bootstrap.system));
  assert.deepEqual(Buffer.from(answer.parts.opening), Buffer.from(bootstrap.lastUser));
  const printedBar = /^- Your bar: you take the bold option when it succeeds at least (\d+) times in 100\./m
    .exec(decision.lastUser);
  if (!answer.scores.length) {
    assert.equal(printedBar, null);
    assert.equal(answer.bar, null);
    return;
  }
  assert.ok(printedBar);
  assert.match(decision.lastUser, /is the bold option\. It succeeds about \d+ times in 100\./);
  assert.match(decision.lastUser, /A leader with no lean either way takes it at \d+ in 100/);
  assert.equal(answer.bar, Number(printedBar[1]));
  assert.ok(Number.isInteger(answer.bar) && answer.bar! >= 0 && answer.bar! <= 100);

  const personality = bootstrap.system.split('## Personality & Communication Style')[1] ?? '';
  let offset = 0;
  for (const score of answer.scores) {
    if (score.line === null) continue;
    const index = personality.indexOf(score.line, offset);
    assert.ok(index >= offset, `${score.trait} occurs in the wire's directive order`);
    offset = index + score.line.length;
  }
}

function launchActors<T extends { name: string }>(actors: readonly T[]) {
  return actors.map(({ unit: _unit, ...leader }: T & { unit?: string }) => leader);
}

test('both written Mars previews match their own commander at the provider and preserve the daily allowance', async () => {
  await withPromptRuns(async (api, calls) => {
    const visitor = api.cookied(clientAddress(10));
    const limit = () => visitor.json<Limit>('/rate-limit');
    const before = await limit();
    assert.equal(before.allowed, true);
    for (let read = 0; read < 5; read++) await readPrompt(visitor, marsDraft.id);
    assert.deepEqual(await limit(), before);

    const [left, right] = await Promise.all([readPrompt(visitor, marsDraft.id), readPrompt(visitor, marsDraft.id, 2)]);
    assert.equal(calls.length, 0);
    await runTurn(visitor, marsDraft.id, launchActors(marsDraft.presets[0].leaders), marsDraft.setup.defaultSeed);
    const expected = [
      [left, aria, dietrich, 36, ['emotionality', 'extraversion', 'openness']],
      [right, dietrich, aria, 82, ['honesty-humility', 'emotionality', 'extraversion', 'conscientiousness', 'openness']],
    ] as const;
    for (const [index, [preview, leader, other, bar, speaking]] of expected.entries()) {
      assertWireParity(preview, calls, leader.instructions);
      assert.equal(preview.scenarioId, marsDraft.id);
      assert.equal(preview.place, index + 1);
      assert.equal(preview.name, leader.name);
      assert.equal(preview.filled, false);
      assert.ok(preview.parts.system.startsWith(`${GENERAL_AUDIENCE_GUIDANCE}\n\n${leader.instructions}`));
      assert.ok(!preview.parts.system.includes(other.instructions));
      assert.equal(preview.bar, bar);
      assert.deepEqual(preview.speaking, speaking);
      assert.deepEqual(preview.model, { provider: DEMO_PROVIDER, model: hostedRunModels().commander });
      assertSample(preview);
    }

    const spent = await limit();
    assert.deepEqual({ remaining: spent.remaining, limit: spent.limit, allowed: spent.allowed, resetAt: spent.resetAt },
      { remaining: 0, limit: 1, allowed: false, resetAt: before.resetAt });
    const callsAtCompletion = calls.length;
    for (let read = 0; read < 5; read++) assert.deepEqual(await readPrompt(visitor, marsDraft.id), left);
    assert.deepEqual(await limit(), spent);
    assert.equal(calls.length, callsAtCompletion);
  }, { env: trustedAddress, maxSimsPerDay: 1 });
});

function assertSample(answer: LeaderPromptAnswer): void {
  const { sampleTurn } = answer.parts;
  assert.match(sampleTurn, /^TURN 1, Year 2035: \[this turn's event\]/);
  assert.ok(sampleTurn.includes('[the department reports, written during the run]'));
  const start = marsScenario.setup.defaultStartTime;
  const population = Math.min(marsScenario.setup.defaultPopulation, DEMO_EXECUTION.maxPopulation);
  const kernel = new SimulationKernel(marsDraft.setup.defaultSeed, answer.name,
    scenarioKeyPersonnel(marsScenario).slice(0, population), { scenario: marsScenario, startTime: start, initialPopulation: population });
  assert.ok(sampleTurn.includes(`State: ${formatStateLine(kernel.getState().metrics, marsScenario.world)}\n`));
  assert.match(sampleTurn, /^- bold: Try the new approach.*\[RISKY\]$/m);
  assert.match(sampleTurn, /^- safe: Keep the current approach.*$/m);
  assert.match(sampleTurn, new RegExp(`^- Your bar: you take the bold option when it succeeds at least ${answer.bar} times in 100\\.`, 'm'));
  assert.deepEqual([...sampleTurn.matchAll(/^  \((\d)\) /gm)].map(match => match[1]), ['1', '2', '3', '4', '5']);
}

const prefix = 'Supply review starts here.\nPreserve this line break.\n';
const shortOrders = prefix.padEnd(MAX_ORDER_CHARS - 1, 'x');
const longOrders = shortOrders + '🌱 Continue with the full orchard inventory.';
const blankCut = ' '.repeat(MAX_ORDER_CHARS) + 'Only the complete orders mention tidal sensors.';
const middle = {
  honestyHumility: 0.5, emotionality: 0.35, extraversion: 0.65,
  agreeableness: 0.5, conscientiousness: 0.5, openness: 0.5,
};
const longLeader = {
  ...aria, name: 'Research lead', instructions: longOrders, unit: 'Round table',
  hexaco: { ...middle, openness: 0.651, agreeableness: 0.349 },
};
const blankCutLeader = {
  ...dietrich, name: 'Tidal lead', instructions: blankCut, hexaco: middle,
  description: 'Keep a watch on shared equipment.',
};
const { hexaco: _hexaco, ...alternateLeader } = aria;
const agentLeader = {
  ...alternateLeader, name: 'Review lead', instructions: 'Verify readings with the whole crew.',
  traitProfile: { modelId: 'ai-agent', traits: { exploration: 0.9 } },
};
const emptyLeader = { ...dietrich, name: 'Water lead', instructions: '', description: 'Share the water inventory.' };

test('host and visitor projections follow the real launch for long, blank-after-cut and empty orders', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'leader-prompt-scenarios-'));
  const cases = [
    { id: 'prompt-orchard', actors: [longLeader, blankCutLeader] },
    { id: 'prompt-reservoir', actors: [agentLeader, emptyLeader] },
  ];
  try {
    for (const { id, actors } of cases) {
      await writeFile(join(dir, `${id}.json`), JSON.stringify({
        ...marsDraft, id, presets: [{ ...marsDraft.presets[0], leaders: actors }],
      }));
    }
    await withPromptRuns(async (api, calls) => {
      for (const [index, own] of [false, true].entries()) {
        const visitor = api.cookied(clientAddress(20 + index));
        await select(visitor, cases[0].id);
        const mode = own ? 'own' : undefined;
        const long = await readPrompt(visitor, cases[0].id, 1, mode);
        const cut = await readPrompt(visitor, cases[0].id, 2, mode);
        if (own) {
          const hostDefault = await readPrompt(visitor, cases[0].id);
          assert.notEqual(hostDefault.parts.system, long.parts.system);
          assert.deepEqual(await readPrompt(visitor, cases[0].id, 1, 'OWN'), hostDefault);
        }

        const callsBefore = calls.length;
        await runTurn(visitor, cases[0].id, launchActors(cases[0].actors), marsDraft.setup.defaultSeed, own);
        const observed = calls.slice(callsBefore);
        assertWireParity(long, observed, prefix);
        const { bootstrap } = firstCommanderTurn(observed, prefix);
        assert.ok(bootstrap.system.startsWith(`${GENERAL_AUDIENCE_GUIDANCE}\n\n${own ? longOrders : shortOrders}`));
        assert.equal(bootstrap.system.includes('🌱'), own);
        assert.equal(bootstrap.system.includes('Continue with the full orchard inventory.'), own);
        assert.ok(!bootstrap.system.includes('\ufffd'));
        assert.equal(long.filled, false);
        assert.equal(cut.filled, !own);
        assertWireParity(cut, observed, own ? 'Only the complete orders mention tidal sensors.' : 'You are Tidal lead');
        assert.equal(cut.parts.system.includes(blankCut), own);
        assert.equal(cut.parts.system.includes(blankCutLeader.description), !own);
        assert.deepEqual(cut.speaking, []);
        assert.equal(cut.scores.length, 6);
        assert.ok(cut.scores.every(score => score.line === null));
        assert.ok(!cut.parts.system.includes('## Personality & Communication Style'));
        assert.deepEqual(long.speaking, ['agreeableness', 'openness']);
        for (const [trait, rounded] of [['agreeableness', 0.35], ['openness', 0.65]] as const) {
          const score = long.scores.find(score => score.trait === trait);
          assert.equal(score?.value, rounded);
          assert.ok(score?.line && bootstrap.system.includes(score.line));
        }
        assert.deepEqual(long.model, { provider: DEMO_PROVIDER, model: hostedRunModels().commander });
      }

      const visitor = api.cookied(clientAddress(22));
      await select(visitor, cases[1].id);
      const alternate = await readPrompt(visitor, cases[1].id);
      const empty = await readPrompt(visitor, cases[1].id, 2);
      const callsBefore = calls.length;
      await runTurn(visitor, cases[1].id, launchActors(cases[1].actors), marsDraft.setup.defaultSeed);
      assertWireParity(alternate, calls.slice(callsBefore), agentLeader.instructions);
      assert.deepEqual(alternate.speaking, []);
      assert.ok(!alternate.parts.sampleTurn.includes('- Your bar:'));
      assertWireParity(empty, calls.slice(callsBefore), 'You are Water lead');
      assert.equal(empty.filled, true);
      assert.ok(empty.parts.system.includes(emptyLeader.description));
    }, { env: trustedAddress, maxSimsPerDay: 1, scenarioDir: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function storeAndSelect(visit: Visitor, id: string, presets: object[]): Promise<void> {
  const stored = await visit.post('/scenario/store', { scenario: { ...marsScenario, id, presets } });
  assert.equal(stored.status, 200);
  assert.equal((await stored.json() as { switchable: boolean }).switchable, true);
  await select(visit, id);
}

test('visitors read their own stored scenario, including legacy, lone and later written places', async () => {
  await withVisitors(async api => {
    const id = 'private-research-station';
    const a = api.cookied();
    const b = api.cookied();
    const legacy = { ...longLeader, instructions: 'Read the northern station log before deciding.' };
    const other = { ...longLeader, instructions: 'Read the southern station log before deciding.' };
    await storeAndSelect(a, id, [{ id: 'first', label: 'First', actors: [legacy] }]);
    await storeAndSelect(b, id, [{ id: 'first', label: 'First', leaders: [other, dietrich, longLeader] }]);

    const north = await readPrompt(a, id);
    assert.ok(north.parts.system.includes(legacy.instructions));
    assert.ok(!north.parts.system.includes(other.instructions));
    const south = await readPrompt(b, id);
    assert.ok(south.parts.system.includes(other.instructions));
    assert.ok(!south.parts.system.includes(legacy.instructions));
    const third = await readPrompt(b, id, 3);
    assert.equal(third.place, 3);
    assert.equal(third.name, south.name);
    assert.ok(third.parts.system.includes(shortOrders));
    assert.ok(!third.parts.system.includes(other.instructions));
    assert.ok(!third.parts.system.includes('Continue with the full orchard inventory.'));
    assert.equal((await a.get(`/leader-prompt?scenario=${id}&place=2`)).status, 400);
    assert.equal(api.launches.length, 0);
  }, { env: { PARACOSM_HOSTED_DEMO: 'true' } });

  await withVisitors(async api => {
    const visitor = api.cookied();
    const id = 'self-hosted-station';
    await storeAndSelect(visitor, id, [{ leaders: [longLeader] }]);
    const answer = await readPrompt(visitor, id);
    assert.equal(answer.model, null);
    assert.ok(answer.parts.system.includes(longOrders));
    assert.deepEqual(await readPrompt(visitor, id, 1, 'own'), answer);
  });
});

function getWithBody(base: string, path: string, visitor: Visitor, body: object): Promise<unknown> {
  const text = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(path, base), {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(text),
        cookie: [...visitor.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      },
    }, response => {
      response.setEncoding('utf8');
      let answer = '';
      response.on('data', (chunk: string) => { answer += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        try {
          assert.equal(response.statusCode, 200);
          resolve(JSON.parse(answer) as unknown);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.end(text);
  });
}

test('prompt refusals, visitor changes and the minute limit leave the run path untouched', async () => {
  await withProviderWire(async calls => {
    await withVisitors(async api => {
      const visitor = api.cookied(clientAddress(30));
      const initial = await readPrompt(visitor, marsDraft.id);
      assert.deepEqual(await getWithBody(api.base, marsPath, visitor, {
        name: 'Body name', instructions: 'Read the body orders.', hexaco: { openness: 0.01 },
      }), initial);

      for (const query of [
        'place=1', 'scenario=&place=1', 'scenario=mars-genesis&scenario=mars-genesis&place=1',
        'scenario=mars-genesis', 'scenario=mars-genesis&place=1&place=2',
        ...['', '1.5', '-1', '0', 'x', '1e0', '3', '301'].map(place => `scenario=mars-genesis&place=${place}`),
      ]) {
        const response = await visitor.get(`/leader-prompt?${query}`);
        assert.equal(response.status, 400, query);
        assertPromptHeaders(response);
      }
      await select(visitor, lunar.id);
      const changed = await visitor.get(marsPath);
      assert.equal(changed.status, 409);
      assertPromptHeaders(changed);
      assert.deepEqual(await changed.json(), { error: 'scenario_changed' });
      const stalePastEnd = await visitor.get('/leader-prompt?scenario=mars-genesis&place=300');
      assert.equal(stalePastEnd.status, 409);
      assert.equal((await readPrompt(visitor, lunar.id)).name, lunar.presets[0].leaders[0].name);

      await storeAndSelect(visitor, 'empty-prompt-roster', []);
      const empty = await visitor.get('/leader-prompt?scenario=empty-prompt-roster&place=300');
      assert.equal(empty.status, 404);
      assertPromptHeaders(empty);
      assert.equal(api.launches.length, 0);
      assert.equal(calls.length, 0);
    }, { env: trustedAddress });

    await withVisitors(async api => {
      const visitor = api.cookied(clientAddress(31));
      for (let read = 0; read < 60; read++) await readPrompt(visitor, marsDraft.id);
      const limited = await visitor.get(marsPath);
      assert.equal(limited.status, 429);
      assertPromptHeaders(limited);
      assert.equal(limited.headers.get('retry-after'), '60');
      await readPrompt(api.cookied(clientAddress(32)), marsDraft.id);
      assert.equal(api.launches.length, 0);
      assert.equal(calls.length, 0);
    }, { env: trustedAddress });
  });
});
