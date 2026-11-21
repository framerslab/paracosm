/**
 * The forged toolbox's registry: one entry for each actor's tool, with every
 * forge of it in stream order, counted for the run and for each actor. Each
 * actor runs its own simulation with its own tool registry, so a name two
 * actors forged is two entries, each with its own uses.
 *
 * Every state here is the dashboard's own reading of a run's frames: the
 * frames go through the stream hook's parsing and the game state reducer,
 * then the registry is built from that state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolRegistry } from '../../src/dashboard/src/hooks/toolRegistry.helpers.js';
import { computeGameState } from '../../src/dashboard/src/hooks/useGameState.js';
import { forge, frame, framesToSimEvents, leaderTurn, tool } from '../../tests-e2e/support/run-frames.js';
import {
  ARIA,
  DIETRICH,
  GREENHOUSE,
  HABITAT,
  LANDING,
  RATION,
  RATION_REASON,
  SHELTER,
  SHELTER_REASON,
  WATER,
  pairRunFrames,
} from '../../tests-e2e/support/pair-run.js';
import {
  DOZENS,
  DOZENS_A7_UNREADABLE,
  MAXIMUM,
  REPORT_ONLY_PAIR,
  generateCohortRun,
} from '../../tests-e2e/support/forge-fixtures.js';

const stateOf = (frames: string[], complete = true) => computeGameState(framesToSimEvents(frames), complete);

const HABITAT_TEXT = 'Checks the habitat pressure against its safe range.';
const SCORE = JSON.stringify({ score: 82 });

/** One row of a tool's history, as the orchestrator sends it. */
function historyRow(turn: number, isReforge: boolean, confidence: number) {
  return {
    turn, time: 2035 + (turn - 1) * 8, eventIndex: 0, eventTitle: turn === 1 ? 'Landfall' : 'Dust Season',
    department: 'engineering', output: SCORE, isReforge, rejected: false, confidence,
  };
}

test('two actors\' tools of one name stay two rows, each with its own uses', () => {
  // A1 forges habitat_pressure_check in turn 1 and uses it in turn 2; A2 forges it in turn 2.
  const a1Forged = historyRow(1, true, 0.94);
  const a1Used = historyRow(2, false, 0.94);
  const a2Forged = historyRow(2, true, 0.92);
  const state = stateOf([
    frame('status', { phase: 'starting', maxTurns: 2, customEvents: [] }),
    frame('status', { phase: 'parallel', actors: [ARIA, DIETRICH] }),
    ...leaderTurn(ARIA.name, 1, 'engineering',
      [forge(ARIA.name, 1, 2035, 'engineering', HABITAT, HABITAT_TEXT, 0.94)],
      [tool(HABITAT, HABITAT_TEXT, 'engineering', 1, true, 0.94, { history: [a1Forged] })]),
    ...leaderTurn(DIETRICH.name, 1, 'medical', [], []),
    ...leaderTurn(ARIA.name, 2, 'engineering', [],
      [tool(HABITAT, HABITAT_TEXT, 'engineering', 1, false, 0.94, { history: [a1Forged, a1Used] })]),
    ...leaderTurn(DIETRICH.name, 2, 'engineering',
      [forge(DIETRICH.name, 2, 2043, 'engineering', HABITAT, HABITAT_TEXT, 0.92, { timestamp: '2026-11-16T01:52:30.000Z' })],
      [tool(HABITAT, HABITAT_TEXT, 'engineering', 2, true, 0.92, { history: [a2Forged] })]),
  ]);

  const r = buildToolRegistry(state);
  const a = r.getEntryFor(0, HABITAT)!, b = r.getEntryFor(1, HABITAT)!;
  assert.ok(a && b, 'each actor holds its own habitat_pressure_check');
  assert.notEqual(a.n, b.n);
  assert.deepEqual([a.actorIndex, a.actorName, b.actorIndex, b.actorName], [0, ARIA.name, 1, DIETRICH.name]);
  // On master the merged row held A2's history alone (useToolRegistry.ts:156-157).
  assert.deepEqual(a.history.map((h) => h.turn), [1, 2]);
  assert.deepEqual(b.history.map((h) => h.turn), [2]);
  assert.ok(a.history.every((h) => h.actorName === ARIA.name));
  assert.ok(b.history.every((h) => h.actorName === DIETRICH.name));
  assert.deepEqual([a.sameNameActors, b.sameNameActors], [[1], [0]]);
  // The name alone answers the lowest-numbered entry, for the callers that still look up by name.
  assert.equal(r.getEntry(HABITAT), a);
  assert.equal(r.getNumber(HABITAT), a.n);
  assert.equal(r.getEntryByNumber(b.n), b);
});

test('attempts follow the stream: a re-forge that passed after one that did not', () => {
  const state = stateOf(pairRunFrames());
  const r = buildToolRegistry(state);
  const e = r.getEntryFor(0, RATION)!;
  assert.deepEqual(e.attempts.map((x) => [x.attempt, x.approved, x.turn]), [[1, false, 1], [2, true, 2]]);
  assert.equal(e.outcome, 'passed');
  assert.deepEqual(e.attempts.map((x) => [x.department, x.eventTitle, x.errorReason]), [
    ['agriculture', 'Landfall', RATION_REASON],
    ['agriculture', 'Dust Season', null],
  ]);
  assert.deepEqual(e.attempts.map((x) => x.confidence), [0, 0.91]);
  // Each attempt points at its own forge_attempt event of Aria Chen's stream.
  const events = state.actors[ARIA.name].events;
  for (const x of e.attempts) {
    const evt = events.find((ev) => ev.id === x.eventId);
    assert.equal(evt?.type, 'forge_attempt');
    assert.equal(evt?.data.name, RATION);
    assert.equal(evt?.data.turn, x.turn);
  }
});

test('a tool whose only forge did not pass is a row of its actor', () => {
  const r = buildToolRegistry(stateOf(pairRunFrames()));
  const e = r.getEntryFor(0, SHELTER)!;
  assert.ok(e, 'dust_storm_shelter_plan is a row, though no report lists it');
  assert.equal(e.outcome, 'did_not_pass');
  assert.equal(e.attempts.length, 1);
  assert.deepEqual([e.actorIndex, e.actorName], [0, ARIA.name]);
  assert.equal(e.attempts[0].errorReason, SHELTER_REASON);
  assert.equal(e.errorReason, SHELTER_REASON);
  assert.deepEqual([e.attempts[0].turn, e.attempts[0].department], [2, 'engineering']);
  assert.equal(r.getEntryFor(1, SHELTER), undefined);
});

test('a report-only run gives each tool its report\'s outcome and no attempt', () => {
  const r = buildToolRegistry(stateOf(generateCohortRun(REPORT_ONLY_PAIR)));
  assert.equal(r.list.length, 2);
  for (const e of r.list) {
    assert.deepEqual(e.attempts, []);
    assert.equal(e.outcome, 'passed');
  }
  assert.deepEqual(r.list.map((e) => [e.actorIndex, e.name]), [[0, LANDING], [1, WATER]]);
  assert.equal(r.counts.tools, 2);
  assert.equal(r.counts.forges, 0);
  assert.equal(r.counts.reforges, 0);
  assert.deepEqual(r.actors.map((a) => a.strip), [[], []]);
});

test('the pair run counts 12 tools from 13 forges, 9 passed, by actor 5 and 7', () => {
  const r = buildToolRegistry(stateOf(pairRunFrames()));
  assert.deepEqual(r.counts, { tools: 12, forges: 13, reforges: 1, passed: 9, didNotPass: 4 });
  assert.deepEqual(r.actors.map((a) => a.counts.tools), [5, 7]);
  assert.deepEqual(r.actors.map((a) => a.counts.forges), [6, 7]);
  assert.deepEqual(r.actors.map((a) => [a.index, a.label, a.name, a.archetype]), [
    [0, 'A1', ARIA.name, ARIA.archetype],
    [1, 'A2', DIETRICH.name, DIETRICH.archetype],
  ]);
  // The list runs actor by actor, each actor's tools in the order they first appear in its stream.
  assert.deepEqual(r.list.map((e) => e.n), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepEqual(r.list.slice(0, 5).map((e) => e.name), [LANDING, GREENHOUSE, RATION, HABITAT, SHELTER]);
  assert.ok(r.list.slice(5).every((e) => e.actorIndex === 1));
  assert.equal(r.getNumber(LANDING), 1);
  // A1's forges in turn order: one entry a forge.
  assert.deepEqual(r.actors[0].strip, ['passed', 'passed', 'did_not_pass', 'passed', 'did_not_pass', 'passed']);
  assert.equal(r.actors[1].strip.length, 7);
});

test('an actor whose reports cannot be read is marked, and the others are whole', () => {
  const dozens = buildToolRegistry(stateOf(generateCohortRun(DOZENS)));
  const r = buildToolRegistry(stateOf(generateCohortRun(DOZENS_A7_UNREADABLE)));
  assert.equal(r.actors[6].unreadable, true);
  assert.equal(r.actors[6].label, 'A7');
  assert.equal(r.list.filter((e) => e.actorIndex === 6).length, 0, 'its forge_attempt frames add no row either');
  assert.deepEqual(r.actors[6].counts, { tools: 0, forges: 0, reforges: 0, passed: 0, didNotPass: 0 });
  assert.deepEqual(r.actors[6].strip, []);
  assert.ok(dozens.actors[6].counts.tools > 0);
  r.actors.forEach((a, i) => {
    if (i === 6) return;
    assert.equal(a.unreadable, false);
    assert.deepEqual(a.counts, dozens.actors[i].counts, `${a.label}'s counts`);
  });
});

test('an actor with no event waits, and every actor is done once the run is complete', () => {
  const frames = [
    frame('status', { phase: 'starting', maxTurns: 2, customEvents: [] }),
    frame('status', { phase: 'parallel', actors: [ARIA, DIETRICH] }),
    ...leaderTurn(ARIA.name, 1, 'engineering', [], []),
  ];
  const live = buildToolRegistry(stateOf(frames, false));
  assert.deepEqual(live.actors.map((a) => a.status), ['running', 'waiting']);
  const done = buildToolRegistry(stateOf(frames, true));
  assert.deepEqual(done.actors.map((a) => a.status), ['done', 'done']);
});

test('the dozens run\'s registry holds 286 tools from 331 forges in 24 actors', () => {
  const r = buildToolRegistry(stateOf(generateCohortRun(DOZENS)));
  assert.deepEqual(r.counts, { tools: 286, forges: 331, reforges: 45, passed: 268, didNotPass: 63 });
  assert.equal(r.actors.length, 24);
  assert.equal(r.actors.reduce((sum, a) => sum + a.counts.tools, 0), 286);
  assert.equal(r.list.length, 286);
  assert.deepEqual(r.actors.map((a) => a.label), Array.from({ length: 24 }, (_, i) => `A${i + 1}`));
  assert.equal(r.actors[6].name, 'Ines Duarte');
  // The shared name is three rows, one an actor, each naming the other two.
  const shared = r.list.filter((e) => e.name === DOZENS.sharedName!.name);
  assert.equal(shared.length, 3);
  assert.equal(new Set(shared.map((e) => e.actorIndex)).size, 3);
  assert.ok(shared.every((e) => e.sameNameActors.length === 2 && !e.sameNameActors.includes(e.actorIndex)));
  // A1 holds a tool forged twice, its first forge not passing.
  assert.ok(r.list.some((e) => e.actorIndex === 0 && e.attempts.length >= 2 && e.attempts[0].approved === false));
});

test('the maximum run\'s registry holds 3,612 tools in 300 actors, A299\'s 50 and one name in 40 actors', () => {
  const r = buildToolRegistry(stateOf(generateCohortRun(MAXIMUM)));
  assert.deepEqual(r.counts, { tools: 3612, forges: 4207, reforges: 595, passed: 3301, didNotPass: 906 });
  assert.equal(r.actors.length, 300);
  assert.equal(r.actors[298].counts.tools, 50);
  assert.ok(r.actors.every((a) => a.counts.tools <= 50));
  const shared = r.list.filter((e) => e.name === MAXIMUM.sharedName!.name);
  assert.equal(shared.length, 40);
  assert.ok(shared.every((e) => e.sameNameActors.length === 39));
  assert.equal(r.getEntryByNumber(3612), r.list[3611]);
  assert.equal(r.getEntryByNumber(3613), undefined);
});
