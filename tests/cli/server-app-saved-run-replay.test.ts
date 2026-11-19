/**
 * A hosted-demo visitor's finished run, from the run to its replay.
 *
 * - A pair run of six turns that finishes is listed in its visitor's saved
 *   runs (the list the Sim tab's "Replay from cache", Load Prior Run and the
 *   Quickstart "Replay last run" link read), and `/sessions/:id/replay`
 *   streams it back without starting a run or calling a model. A second
 *   visitor's list does not hold it.
 * - Other visitors' finished runs do not push a visitor's saved run out of
 *   that visitor's list.
 *
 * Every test goes through createMarsServer over HTTP with a stub runner and
 * a stub title call, so no model is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openSessionStore, type SessionStore } from '../../src/server/stores/session.js';
import {
  mars, readReplay, settingsBody, waitFor, withVisitors,
  type Frame, type Runner,
} from './helpers/run-server.js';
import type { Visitor } from './helpers/visitor.js';

const HOSTED = { PARACOSM_HOSTED_DEMO: 'true' };
const TURNS = 6;

interface SessionRow { id: string; turnCount?: number; title?: string }

const memoryStore = (max = 10): SessionStore => openSessionStore(':memory:', max, { databaseOptions: { type: 'memory' } });

/** Stands in for the title a saved run gets from a model, and counts the calls. */
function titleStub() {
  const calls = { n: 0 };
  return { calls, generateText: async () => { calls.n += 1; return { text: 'A saved run' }; } };
}

/**
 * A pair runner that plays every turn the run asks for: a `turn_start` and a
 * `turn_done` per actor each turn, a `result` per actor, the verdict and
 * `complete`, the frames the pair runner writes for a finished run.
 */
const pairOfSixTurns: Runner = async (config, broadcast) => {
  broadcast('status', { phase: 'parallel', maxTurns: config.turns, actors: config.actors.map(a => ({ name: a.name, archetype: a.archetype })) });
  for (let turn = 1; turn <= config.turns; turn++) {
    for (const actor of config.actors) {
      broadcast('sim', { type: 'turn_start', leader: actor.name, data: { turn, time: turn, title: `${actor.name} turn ${turn}` } }, actor.name);
      broadcast('sim', { type: 'turn_done', leader: actor.name, data: { turn, time: turn } }, actor.name);
    }
  }
  for (const actor of config.actors) {
    broadcast('result', { leader: actor.name, summary: { population: 10 } }, actor.name);
  }
  const [a, b] = config.actors;
  broadcast('verdict', {
    winner: 'A',
    winnerName: a.name,
    headline: `${a.name} wins`,
    summary: 'The bolder leader grew the settlement faster.',
    leaderA: { name: a.name, archetype: a.archetype },
    leaderB: { name: b.name, archetype: b.archetype },
  });
  broadcast('complete', { timestamp: new Date().toISOString() });
};

async function listSessions(v: Visitor): Promise<SessionRow[]> {
  const res = await v.get('/sessions');
  assert.equal(res.status, 200);
  return (await res.json() as { sessions: SessionRow[] }).sessions;
}

/** Starts a six-turn pair run as `v` and waits for the server's save decision on it. */
async function finishRun(v: Visitor): Promise<Record<string, unknown>> {
  const res = await v.post('/setup', { ...settingsBody(mars), turns: TURNS });
  assert.equal(res.status, 200, await res.text());
  const saved = await waitFor(async () => (await readReplay(v)).find(f => f.event === 'sim_saved'), 'the save decision', 5000);
  return saved.data;
}

function parseFrames(text: string): Frame[] {
  return text.split('\n\n').filter(frame => frame.startsWith('event: ')).map(frame => {
    const [eventLine, dataLine = 'data: {}'] = frame.split('\n');
    return { event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown> };
  });
}

test("on the hosted demo a finished six-turn pair run is in its visitor's saved runs and replays without a model call", async () => {
  const titles = titleStub();
  await withVisitors(async ({ cookied, launches }) => {
    const a = cookied();
    const saved = await finishRun(a);
    assert.equal(saved.status, 'saved', JSON.stringify(saved));
    assert.equal(launches.length, 1);
    assert.equal(launches[0].config.turns, TURNS, 'the hosted demo ran all six turns');

    const own = await listSessions(a);
    assert.deepEqual(own.map(s => s.id), [saved.id], 'the run is in its visitor\'s saved runs');
    assert.equal(own[0].turnCount, TURNS);
    // The title call lands after the save; wait for it so the replay below
    // is the only thing that could call the stub.
    await waitFor(async () => (await listSessions(a))[0]?.title === 'A saved run', 'the saved run\'s title');
    const callsBeforeReplay = titles.calls.n;

    const replay = await a.get(`/sessions/${String(saved.id)}/replay`);
    assert.equal(replay.status, 200);
    const frames = parseFrames(await replay.text());
    const turnsDone = frames.filter(f => f.event === 'sim' && f.data.type === 'turn_done');
    assert.equal(turnsDone.length, 2 * TURNS, 'every turn of both leaders replays');
    assert.ok(frames.some(f => f.event === 'verdict'), 'the verdict replays');
    assert.ok(frames.some(f => f.event === 'complete'), 'the replay ends complete');
    assert.equal(launches.length, 1, 'the replay starts no run');
    assert.equal(titles.calls.n, callsBeforeReplay, 'the replay calls no model');

    const b = cookied();
    assert.deepEqual(await listSessions(b), [], "a second visitor's list holds none of the first visitor's runs");
  }, { runner: pairOfSixTurns, env: HOSTED, extra: { generateText: titles.generateText, sessionStore: memoryStore() } });
});

test("on the hosted demo other visitors' finished runs leave a visitor's saved run in their list", async () => {
  const titles = titleStub();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const saved = await finishRun(a);
    assert.equal(saved.status, 'saved', JSON.stringify(saved));

    // More visitors finish runs than the store keeps for one visitor.
    for (let i = 0; i < 3; i++) {
      const other = cookied();
      const theirs = await finishRun(other);
      assert.equal(theirs.status, 'saved', JSON.stringify(theirs));
      assert.deepEqual((await listSessions(other)).map(s => s.id), [theirs.id], `visitor ${i + 2} sees their own run alone`);
    }

    assert.deepEqual((await listSessions(a)).map(s => s.id), [saved.id], "the first visitor's run is still in their list");
    const replay = await a.get(`/sessions/${String(saved.id)}/replay`);
    assert.equal(replay.status, 200, 'and still replays');
    await replay.body?.cancel();
  }, { runner: pairOfSixTurns, env: HOSTED, extra: { generateText: titles.generateText, sessionStore: memoryStore(2) } });
});
