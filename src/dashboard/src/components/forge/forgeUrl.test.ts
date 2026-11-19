/**
 * The forge view in the page's address: a link names one actor's tool by its
 * number in the run's list, with its attempt and its open stations, and reads
 * back to that tool once the run is complete. The tools are the dashboard's
 * own reading of a run's events: the events go through the game state
 * reducer and the registry is built from that state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SimEvent } from '../../hooks/useSSE';
import { computeGameState } from '../../hooks/useGameState';
import { buildToolRegistry } from '../../hooks/toolRegistry.helpers';
import { LOG_FILTER_PARAMS } from '../log/EventLogPanel.helpers';
import { parseForgeUrl, toolLink, withForgeState, withoutForgeParams } from './forgeUrl';

const ARIA = { name: 'Aria Chen', archetype: 'The Visionary' };
const DIETRICH = { name: 'Dietrich Voss', archetype: 'The Engineer' };
const ORIGIN = 'https://paracosm.agentos.sh';
const SESSION = '5f0c2a9e-run';

const LANDING = 'mars_landing_site_score';
const RATION = 'water_ration_index';
const ROVER = 'rover_route_planner';

/** The run's roster, as the parallel status frame sends it: Aria Chen first, Dietrich Voss second. */
const roster: SimEvent = { type: 'status', leader: '', data: { phase: 'parallel', actors: [ARIA, DIETRICH] } };

/** One department's report in a turn: its start, the forge of one tool, and the report listing it. */
function forged(leader: string, turn: number, department: string, name: string, approved: boolean, second: number): SimEvent[] {
  const at = { turn, time: 2035 + (turn - 1) * 8 };
  return [
    { type: 'specialist_start', leader, data: { ...at, department, eventIndex: 0 } },
    {
      type: 'forge_attempt',
      leader,
      data: {
        ...at, eventIndex: 0, department, name, description: `Forged by ${department}.`, mode: 'sandbox',
        approved, confidence: approved ? 0.95 : 0, inputFields: ['reserve_litres'], outputFields: ['index'],
        timestamp: `2026-11-16T01:5${turn}:${String(second).padStart(2, '0')}.000Z`,
        ...(approved ? {} : { errorReason: 'The output did not match the declared output schema.' }),
      },
    },
    {
      type: 'specialist_done',
      leader,
      data: {
        ...at, department, summary: `${department} report for turn ${turn}.`, eventIndex: 0, citations: 0, citationList: [], risks: [],
        forgedTools: [{
          name, description: `Forged by ${department}.`, mode: 'sandbox', approved, confidence: approved ? 0.95 : 0,
          inputFields: ['reserve_litres'], outputFields: ['index'], output: approved ? JSON.stringify({ index: 0.7 }) : null,
          department, isNew: turn === 1, firstForgedTurn: 1, firstForgedDepartment: department,
        }],
        recommendedActions: [],
      },
    },
  ];
}

const registryOf = (events: SimEvent[], complete = true) => buildToolRegistry(computeGameState(events, complete));

/** Dietrich Voss's tool, then Aria Chen's two: her first forge of the ration index did not pass, her second did. */
const run = registryOf([
  roster,
  ...forged(DIETRICH.name, 1, 'governance', ROVER, true, 5),
  ...forged(ARIA.name, 1, 'engineering', LANDING, true, 10),
  ...forged(ARIA.name, 1, 'agriculture', RATION, false, 20),
  ...forged(ARIA.name, 2, 'agriculture', RATION, true, 30),
]);

const replay = (params: Record<string, string>) => {
  const url = new URL('/sim', ORIGIN);
  url.searchParams.set('replay', SESSION);
  url.searchParams.set('tab', 'sim');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

test('a link names an actor\'s tool by its number and reads back to that tool with its open stations', () => {
  // The list is in actor order: Aria Chen's two tools, then Dietrich Voss's.
  assert.deepEqual(run.list.map((e) => [e.n, e.actorIndex, e.name]), [[1, 0, LANDING], [2, 0, RATION], [3, 1, ROVER]]);
  const link = toolLink(ORIGIN, SESSION, 'sim', { actorIndex: 1, toolName: ROVER, open: ['added', 'request'] }, run);
  const url = new URL(link);
  assert.equal(url.pathname, '/sim');
  assert.equal(url.searchParams.get('replay'), SESSION);
  assert.equal(url.searchParams.get('tab'), 'sim');
  assert.equal(url.searchParams.get('tool'), '3');
  assert.equal(url.searchParams.get('open'), 'request,added');
  assert.equal(url.searchParams.has('attempt'), false);

  const { state, dangling } = parseForgeUrl(link, run, true);
  assert.deepEqual(state.trace, { actorIndex: 1, toolName: ROVER, open: ['request', 'added'] });
  assert.deepEqual(dangling, []);
});

test('an earlier attempt is written and read back, and the latest is left out', () => {
  const ration = run.getEntryFor(0, RATION)!;
  assert.equal(ration.attempts.length, 2);
  const first = new URL(toolLink(ORIGIN, SESSION, 'sim', { actorIndex: 0, toolName: RATION, attempt: 1 }, run));
  assert.equal(first.searchParams.get('tool'), '2');
  assert.equal(first.searchParams.get('attempt'), '1');
  assert.deepEqual(parseForgeUrl(first.toString(), run, true).state.trace, { actorIndex: 0, toolName: RATION, attempt: 1 });
  const latest = new URL(toolLink(ORIGIN, SESSION, 'sim', { actorIndex: 0, toolName: RATION, attempt: 2 }, run));
  assert.equal(latest.searchParams.has('attempt'), false);
});

test('a tool number or an attempt the run lacks comes back dangling, with no trace', () => {
  const lacks = parseForgeUrl(replay({ tool: '999', open: 'request,judge' }), run, true);
  assert.equal(lacks.state.trace, null);
  assert.deepEqual(lacks.dangling, ['tool', 'open']);

  // The ration index was forged twice: a third attempt names nothing, so the link names no trace.
  const pastAttempts = parseForgeUrl(replay({ tool: '2', attempt: '3' }), run, true);
  assert.equal(pastAttempts.state.trace, null);
  assert.deepEqual(pastAttempts.dangling, ['tool', 'attempt']);

  // A tool forged once has no attempt to name but its only one, and a number that is not a count names nothing.
  assert.deepEqual(parseForgeUrl(replay({ tool: '1', attempt: '2' }), run, true).dangling, ['tool', 'attempt']);
  assert.deepEqual(parseForgeUrl(replay({ tool: '1', attempt: '0' }), run, true).dangling, ['tool', 'attempt']);
  assert.deepEqual(parseForgeUrl(replay({ tool: 'abc' }), run, true).dangling, ['tool']);
  assert.deepEqual(parseForgeUrl(replay({ tool: '0' }), run, true).dangling, ['tool']);
  assert.deepEqual(parseForgeUrl(replay({ tool: '-3' }), run, true).dangling, ['tool']);
  // An attempt or open stations with no tool point at nothing.
  assert.deepEqual(parseForgeUrl(replay({ attempt: '1', open: 'judge' }), run, true).dangling, ['attempt', 'open']);
  // An address with no forge parameter has nothing dangling and no trace.
  assert.deepEqual(parseForgeUrl(replay({}), run, true), { state: { trace: null, toolbox: { open: false } }, dangling: [] });
});

test('unknown station names, Record among them, are dropped and repeats folded', () => {
  const { state, dangling } = parseForgeUrl(replay({ tool: '1', open: 'added,record,Request, judge,added,bogus' }), run, true);
  assert.deepEqual(state.trace, { actorIndex: 0, toolName: LANDING, open: ['request', 'judge', 'added'] });
  assert.deepEqual(dangling, []);
  // An open list that names no station opens the tool and leaves the address.
  const none = parseForgeUrl(replay({ tool: '1', open: 'record' }), run, true);
  assert.deepEqual(none.state.trace, { actorIndex: 0, toolName: LANDING });
  assert.deepEqual(none.dangling, ['open']);
});

test('withForgeState keeps the replay, the tab, the sub-tab and the Event Log\'s filters', () => {
  const url = new URL('/sim', ORIGIN);
  url.searchParams.set('replay', SESSION);
  url.searchParams.set('tab', 'settings');
  url.searchParams.set('sub', 'log');
  for (const key of LOG_FILTER_PARAMS) url.searchParams.set(key, `${key}-value`);
  // A forge state written earlier is replaced, never added to.
  url.searchParams.set('tool', '9');
  url.searchParams.set('attempt', '1');
  url.hash = 'log=habitat_pressure_check&logExact=1';
  const before = url.toString();

  const written = new URL(withForgeState(before, { trace: { actorIndex: 0, toolName: LANDING, open: ['judge'] }, toolbox: { open: false } }, run));
  assert.equal(written.searchParams.get('replay'), SESSION);
  assert.equal(written.searchParams.get('tab'), 'settings');
  assert.equal(written.searchParams.get('sub'), 'log');
  for (const key of LOG_FILTER_PARAMS) assert.equal(written.searchParams.get(key), `${key}-value`);
  assert.equal(written.hash, '#log=habitat_pressure_check&logExact=1');
  assert.deepEqual(written.searchParams.getAll('tool'), ['1']);
  assert.equal(written.searchParams.has('attempt'), false);
  assert.equal(written.searchParams.get('open'), 'judge');

  // Taking the forge state off leaves every other parameter, and an address with none comes back as it was.
  const cleared = new URL(withoutForgeParams(written.toString()));
  assert.equal(cleared.searchParams.has('tool'), false);
  assert.equal(cleared.searchParams.has('open'), false);
  assert.equal(cleared.searchParams.get('sub'), 'log');
  assert.equal(cleared.hash, '#log=habitat_pressure_check&logExact=1');
  const plain = `${ORIGIN}/sim?replay=${SESSION}&tab=sim`;
  assert.equal(withoutForgeParams(plain), plain);
  // Named parameters alone leave.
  assert.equal(new URL(withoutForgeParams(written.toString(), ['open'])).searchParams.get('tool'), '1');
});

test('a tool held by actor and name is written as its number in the registry given, so the link follows it when an earlier actor\'s first forge moves it', () => {
  // While the run plays in, Dietrich Voss's tool is the list's first; Aria Chen has forged nothing yet.
  const early = registryOf([roster, ...forged(DIETRICH.name, 1, 'governance', ROVER, true, 5)], false);
  const target = { actorIndex: 1, toolName: ROVER };
  assert.equal(new URL(toolLink(ORIGIN, SESSION, 'sim', target, early)).searchParams.get('tool'), '1');
  // Aria Chen's first forge comes before his tool in the list, and the same target now writes its new number.
  const later = registryOf([
    roster,
    ...forged(DIETRICH.name, 1, 'governance', ROVER, true, 5),
    ...forged(ARIA.name, 1, 'engineering', LANDING, true, 10),
  ], false);
  const link = toolLink(ORIGIN, SESSION, 'sim', target, later);
  assert.equal(new URL(link).searchParams.get('tool'), '2');
  // On the complete run Aria Chen holds two tools, so his tool is the third, and the link written then reads back to it.
  const complete = toolLink(ORIGIN, SESSION, 'sim', target, run);
  assert.equal(new URL(complete).searchParams.get('tool'), '3');
  assert.deepEqual(parseForgeUrl(complete, run, true).state.trace, target);
  // A target the registry lacks writes no tool.
  assert.equal(new URL(toolLink(ORIGIN, SESSION, 'sim', { actorIndex: 1, toolName: 'no_such_tool' }, run)).searchParams.has('tool'), false);
});

test('a run still playing in resolves no trace and calls nothing dangling', () => {
  // A registry built from part of the run's frames: Dietrich Voss's tool alone, numbered 1 for now.
  const partial = registryOf([roster, ...forged(DIETRICH.name, 1, 'governance', ROVER, true, 5)], false);
  const links: Array<Record<string, string>> = [{ tool: '1', open: 'judge' }, { tool: '999' }, { tool: '1', attempt: '9' }, { attempt: '1' }];
  for (const params of links) {
    const { state, dangling } = parseForgeUrl(replay(params), partial, false);
    assert.equal(state.trace, null);
    assert.deepEqual(dangling, []);
  }
});
