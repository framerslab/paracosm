/**
 * The commander's bar check on a run's outcome cards.
 *
 * The dashboard's game state joins each decision's `barCheck` from the
 * leader's result onto the outcome event of the same turn and event, and the
 * outcome card writes it as one line. A run's `sim` events carry the leader's
 * name ("Aria Chen"). The pair runner's `result` event names the leader by
 * its tag (`leaderTag`: "visionary"), and the artifact it carries keeps the
 * name under `scenarioExtensions.paracosmInternal.leader`. The join looked
 * the result's tag up among the names the events carry, found no leader, and
 * no outcome card of a run showed its check.
 *
 * The run here is the real turn loop on Mars Genesis with the stub model
 * (helpers/stub-model-mars-run.ts): its events as the orchestrator emits
 * them and its artifact as the run saved it, both read through JSON as the
 * stream carries them, and the result frame as `runPairSimulations` and
 * `runForkSimulation` write it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { leaderTag } from '../../src/cli/pair-runner.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { RunArtifact } from '../../src/engine/schema/index.js';
import { runMarsWithStubModel } from './helpers/stub-model-mars-run.js';

/** The leader the stubbed run plays: Mars Genesis's first preset. */
const LEADER = marsScenario.presets[0].leaders[0];
/** What the runners name that leader in a `result` event. */
const TAG = leaderTag(LEADER, 0);

interface BarCheck {
  boldChance: number;
  bar: number;
  clearsBar: boolean;
  choseBold: boolean;
  departs: boolean;
  departureFact: string;
  unexplained: boolean;
}
interface DecisionRecord { turn: number; eventIndex: number; barCheck?: BarCheck }
interface Internal { leader?: { name?: string }; commanderDecisions?: DecisionRecord[] }
interface StreamEvent { type: string; leader: string; data: Record<string, unknown> }

const throughJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const internalOf = (artifact: RunArtifact): Internal =>
  ((artifact.scenarioExtensions ?? {}) as { paracosmInternal?: Internal }).paracosmInternal ?? {};

/** One stubbed run for the file: the turn loop is the expensive part. */
let pending: Promise<{ events: StreamEvent[]; artifact: RunArtifact }> | undefined;
const stubbedRun = () => (pending ??= (async () => {
  const emitted: unknown[] = [];
  const { artifact } = await runMarsWithStubModel({ onEvent: event => { emitted.push(event); } });
  return { events: throughJson(emitted) as StreamEvent[], artifact: throughJson(artifact) };
})());

/** A leader's `result` event as the pair runner writes it: the leader by its tag, the artifact whole. */
const resultFrame = (artifact: RunArtifact) => ({
  leader: TAG,
  summary: {},
  fingerprint: artifact.fingerprint ?? null,
  artifact,
});

/** The outcome events the game state holds for the leader, by `turn:eventIndex`. */
async function outcomeCards(events: StreamEvent[], results: unknown[]): Promise<Map<string, Record<string, unknown>>> {
  const { computeGameState } = await import('../../src/dashboard/src/hooks/useGameState.js');
  const game = computeGameState(events as never, true, results as never);
  const side = game.actors[LEADER.name];
  assert.ok(side, `the run's events carry the leader's name: ${Object.keys(game.actors).join(', ')}`);
  return new Map(side.events
    .filter(e => e.type === 'outcome')
    .map(e => [`${e.turn}:${Number(e.data.eventIndex ?? 0)}`, e.data]));
}

test('each decision the turn loop checked against its bar is on its outcome card, from the result as the pair runner writes it', async () => {
  const { events, artifact } = await stubbedRun();
  const internal = internalOf(artifact);
  const checked = (internal.commanderDecisions ?? []).filter(d => d.barCheck);
  assert.ok(checked.length > 0, 'the run checked its decisions against the bar their prompts stated');
  assert.equal(internal.leader?.name, LEADER.name, 'the artifact keeps the name the events carry');
  assert.notEqual(TAG, LEADER.name, 'the result names the leader by its tag, not that name');
  assert.ok(events.some(e => e.type === 'outcome' && e.leader === LEADER.name), 'the outcome events carry the name');

  const cards = await outcomeCards(events, [resultFrame(artifact)]);
  for (const d of checked) {
    const card = cards.get(`${d.turn}:${d.eventIndex}`);
    assert.ok(card, `turn ${d.turn} event ${d.eventIndex} has an outcome card: ${[...cards.keys()].join(', ')}`);
    assert.deepEqual(card._barCheck, d.barCheck, `turn ${d.turn} event ${d.eventIndex}: the card carries the decision's check`);
  }
});

test('a fork under the same leader leaves the checks of the run it forked from on that run\'s outcome cards', async () => {
  const { events, artifact } = await stubbedRun();
  const internal = internalOf(artifact);
  const last = (internal.commanderDecisions ?? []).filter(d => d.barCheck).at(-1);
  assert.ok(last?.barCheck, 'the run checked a decision against its bar');

  // A fork picks its leader from the scenario's presets, so it runs under a
  // name the page already holds, and decides the turns after the one it
  // forked at again. The page keeps the first outcome event it saw for a
  // leader, turn and event (the forked-from run's), so the fork's check for
  // that turn does not belong on that card. Here the fork made the other
  // choice on the last checked turn.
  const forkCheck: BarCheck = {
    ...last.barCheck,
    choseBold: !last.barCheck.choseBold,
    departs: !last.barCheck.departs,
    departureFact: '',
    unexplained: !last.barCheck.departs,
  };
  const forkedFrom = { parentRunId: artifact.metadata.runId, atTurn: last.turn - 1 };
  const forkArtifact = throughJson(artifact) as RunArtifact;
  (forkArtifact.metadata as Record<string, unknown>).runId = `${artifact.metadata.runId}-fork`;
  (forkArtifact.metadata as Record<string, unknown>).forkedFrom = forkedFrom;
  internalOf(forkArtifact).commanderDecisions = [{ ...last, barCheck: forkCheck }];
  // The fork runner's `result` event: the same tag, with what it forked from.
  const forkFrame = { ...resultFrame(forkArtifact), forkedFrom };

  const cards = await outcomeCards(events, [resultFrame(artifact), forkFrame]);
  assert.deepEqual(
    cards.get(`${last.turn}:${last.eventIndex}`)?._barCheck,
    last.barCheck,
    'the card of the run forked from keeps that run\'s check',
  );
});

/**
 * The run forked from, as its result carries it, with its decision at the
 * last checked turn and event either recorded with no check (a reply that
 * resolved no option the event offers is recorded, with no `barCheck`) or
 * not recorded at all (the run never reached it); and a fork that decided
 * that turn and event again with a check of its own.
 */
async function forkOverLastCheckedDecision(parentRecord: 'unchecked' | 'absent') {
  const { events, artifact } = await stubbedRun();
  const decisions = (internalOf(artifact).commanderDecisions ?? []).filter(d => d.barCheck);
  const last = decisions.at(-1);
  assert.ok(last?.barCheck, 'the run checked a decision against its bar');
  const key = `${last.turn}:${last.eventIndex}`;

  const parent = throughJson(artifact) as RunArtifact;
  const parentInternal = internalOf(parent);
  parentInternal.commanderDecisions = (parentInternal.commanderDecisions ?? []).flatMap(d => {
    if (`${d.turn}:${d.eventIndex}` !== key) return [d];
    if (parentRecord === 'absent') return [];
    const unchecked: DecisionRecord = { ...d };
    delete unchecked.barCheck;
    return [unchecked];
  });

  const forkedFrom = { parentRunId: artifact.metadata.runId, atTurn: last.turn - 1 };
  const fork = throughJson(artifact) as RunArtifact;
  (fork.metadata as Record<string, unknown>).runId = `${artifact.metadata.runId}-fork`;
  (fork.metadata as Record<string, unknown>).forkedFrom = forkedFrom;
  internalOf(fork).commanderDecisions = [last];

  const cards = await outcomeCards(events, [resultFrame(parent), { ...resultFrame(fork), forkedFrom }]);
  return { card: cards.get(key), forkCheck: last.barCheck };
}

test('a fork\'s check stays off an outcome of the run it forked from that the run recorded with no check', async () => {
  const { card } = await forkOverLastCheckedDecision('unchecked');
  assert.ok(card, 'the run forked from has an outcome card for the decision');
  assert.equal(card._barCheck, undefined, 'the card shows the run forked from, whose decision had no check');
});

test('a fork\'s check reaches an outcome the run it forked from recorded no decision for', async () => {
  const { card, forkCheck } = await forkOverLastCheckedDecision('absent');
  assert.ok(card, 'the outcome card is on the page');
  assert.deepEqual(card._barCheck, forkCheck, 'the fork\'s check is the only one for the card');
});
