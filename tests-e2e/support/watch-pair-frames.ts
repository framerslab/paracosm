import { crewOf, framesToSimEvents, leaderTurn, systemsSnapshot } from './run-frames.js';

const departments = ['medical', 'engineering', 'agriculture'];
const choices = ['Ration the water for the greenhouse.', 'Keep a reserve of water.'];
const outcomes = ['risky_success', 'conservative_success', 'risky_failure', 'conservative_failure'];

export function watchPairFrames(names: string[], phase: 'crisis' | 'departments' | 'decisions', turn: number) {
  const time = 2035 + (turn - 1) * 8;
  const count = turn === 1 ? 3 : 1;
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
      if (phase === 'crisis') return [{ ...event, data: { ...event.data, ...fields, title, description: 'Choose a site with enough water to support the colony.', aiWrittenFields: ['title', 'description'] } }];
      if (phase === 'departments') return [department, report, pending].map(frame => ({ ...frame, data: { ...frame.data, ...fields } }));
      return [
        { ...decision, data: { ...decision.data, ...fields, decision: choices[place], aiWrittenFields: fallback ? [] : ['decision', 'rationale', 'reasoning'], selectedPolicies: ['Retain a reserve'] } },
        { ...outcome, data: {
          ...outcome.data, ...fields, outcome: outcomes[slot % outcomes.length], systemDeltas: { morale: 0.02, population: -1 },
          ...(bar === undefined ? {} : { barCheck: { bar, boldChance, clearsBar, choseBold, departs: clearsBar !== choseBold, departureFact, unexplained: false } }),
        } },
      ];
    }).flat();
    if (phase === 'crisis') return [{ ...start, data: { ...start.data, ...at, title, totalEvents: count } }, ...indexed];
    if (phase === 'departments') return indexed;
    const [snapshot] = framesToSimEvents([systemsSnapshot(name, turn, time, crewOf(name, turn, departments, 8 + turn + place))]);
    return [...indexed, snapshot, { ...done, data: { ...done.data, ...at, metrics: { morale: 0.87, population: 8 + turn + place } } }];
  });
}
