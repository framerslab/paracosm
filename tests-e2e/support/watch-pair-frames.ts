import { readFileSync } from 'node:fs';
import type { RunArtifact } from '../../src/engine/schema/index.js';
import { crewOf, framesToSimEvents, leaderTurn, systemsSnapshot } from './run-frames.js';

export const watchPhases = ['crisis', 'departments', 'decisions', 'result-first', 'result-second', 'verdict'] as const;
export type WatchPhase = typeof watchPhases[number];

const artifact = JSON.parse(readFileSync(
  new URL('../../tests/fixtures/runArtifact-v0.8-turn-loop.json', import.meta.url), 'utf8',
)) as RunArtifact;

export const legacyBar = { bar: 44, boldChance: 70, clearsBar: true, choseBold: true, departs: false, departureFact: '', unexplained: false };

export function watchPairResult(leader: string) {
  return {
    leader,
    summary: { morale: 0.87, population: 10 },
    artifact: {
      ...artifact,
      scenarioExtensions: {
        ...artifact.scenarioExtensions,
        paracosmInternal: {
          leader: { name: leader },
          commanderDecisions: [1, 2].map(turn => ({ turn, eventIndex: 0, barCheck: legacyBar })),
        },
      },
    },
  };
}

export function watchPairVerdict(names: string[]) {
  const score = { survival: 7, prosperity: 8, morale: 7, innovation: 8 };
  const stats = { population: 10, morale: 0.87, food: 14, power: 410, modules: 7, science: 46, tools: 0 };
  return {
    winner: 'B',
    winnerName: names[1],
    leaderA: { name: names[0] }, leaderB: { name: names[1] },
    verdictModel: 'fixture-judge',
    headline: 'Stored water protected the colony.',
    summary: 'The second colony kept more water available.',
    keyDivergence: 'The reserve supplied the wells through the dust season.',
    scores: { a: score, b: score },
    finalStats: { a: stats, b: stats },
  };
}

const departments = ['medical', 'engineering', 'agriculture'];
const choices = ['Ration the water for the greenhouse.', 'Keep a reserve of water.'];
const replayNames = ['Aria Chen', 'Dietrich Voss'];
const outcomes = ['risky_success', 'conservative_success', 'risky_failure', 'conservative_failure'];

export function watchPairFrames(names: string[], phase: 'crisis' | 'departments' | 'decisions', turn: number) {
  const time = 2035 + (turn - 1) * 8;
  const count = turn === 1 ? 3 : turn === 2 ? 2 : 1;
  return names.flatMap((name, place) => {
    const [start, event, department, report, pending, decision, outcome, done] =
      framesToSimEvents(leaderTurn(name, turn, departments[place], [], []));
    const title = turn === 1 ? 'Landfall' : place === 0 ? 'Dust Season' : 'Water Shortage';
    const at = { turn, time };
    const indexed = Array.from({ length: count }, (_, eventIndex) => {
      const slot = 2 * eventIndex + place;
      const bar = [36, 57, 81][slot];
      const choseBold = slot % 2 === 0;
      const boldChance = slot === 2 ? 62 : 80;
      const clearsBar = boldChance >= bar;
      const departureFact = slot === 2 ? 'the water reserve was empty' : slot === 1 ? 'the greenhouse was secure' : '';
      const fallback = slot === 5;
      const fields = { ...at, eventIndex, totalEvents: count };
      if (phase === 'crisis') return [{ ...event, data: { ...event.data, ...fields, title, description: 'Choose a site with enough water to support the colony. The nearest site has deep ice but very little power. Another site has more room for panels and fewer places to drill. Both colonies must decide before the next storm.', aiWrittenFields: ['title', 'description'] } }];
      if (phase === 'departments') return [department, report, pending].map(frame => ({ ...frame, data: { ...frame.data, ...fields } }));
      return [
        { ...decision, data: { ...decision.data, ...fields, decision: turn <= 2 ? choices[place] : `Turn ${turn}: ${choices[place]}`, selectedPolicies: ['Retain a reserve'], aiWrittenFields: fallback ? [] : ['decision', 'rationale', 'reasoning', 'selectedPolicies'] } },
        { ...outcome, data: {
          ...outcome.data, ...fields, outcome: outcomes[slot % outcomes.length], systemDeltas: { morale: 0.02, population: -1 },
          ...(bar === undefined || turn === 2 ? {} : { barCheck: { bar, boldChance, clearsBar, choseBold, departs: clearsBar !== choseBold, departureFact, unexplained: false } }),
        } },
      ];
    }).flat();
    if (phase === 'crisis') return [{ ...start, data: { ...start.data, ...at, title, totalEvents: count } }, ...indexed];
    if (phase === 'departments') return indexed;
    const [snapshot] = framesToSimEvents([systemsSnapshot(name, turn, time, crewOf(name, turn, departments, 8 + turn + place))]);
    return [...indexed, ...(turn === 4 && place === 1 ? [] : [snapshot]), { ...done, data: { ...done.data, ...at, metrics: { morale: 0.87, population: 8 + turn + place, ...(turn === 4 && place === 1 ? {} : { powerKw: 400 + turn * 10 + place }) } } }];
  });
}

/** A saved pair made from the same recorded frames as the live fixture. */
export function watchPairReplay(turns: number, stopped = false) {
  const events = Array.from({ length: turns }, (_, i) =>
    (['crisis', 'departments', 'decisions'] as const).flatMap(phase => watchPairFrames(replayNames, phase, i + 1)),
  ).flat();
  return {
    schemaVersion: 3,
    events: stopped
      ? [...events, { type: 'sim_aborted', data: { reason: 'user_aborted', completedTurns: turns } }]
      : events,
    ...(stopped ? {} : { verdict: watchPairVerdict(replayNames) }),
  };
}
