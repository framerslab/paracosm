/**
 * A finished Mars Genesis pair run over the scenario's six turns, in the
 * stream's own frame shape (tests-e2e/support/run-frames.ts).
 *
 * Aria Chen's engineering department forges mars_landing_site_score in turn 1
 * and its report uses the tool again in every turn after, and Dietrich Voss's
 * medical department does the same with perchlorate_water_response_score, as a
 * run's departments reuse a tool turn after turn. Each turn ends with each
 * actor's systems_snapshot. So the Event Log on Aria Chen's tool holds seven
 * events (the forge and six reports) under a filter bar with every type, the
 * leader picker and the turns range, as on a full run of the hosted demo.
 */
import { crewOf, forge, frame, framesToSimEvents, leaderTurn, systemsSnapshot, tool } from './run-frames.js';
import { ARIA, DEPARTMENTS, DIETRICH, LANDING, LANDING_TEXT, SCENARIO, WATER, WATER_TEXT } from './pair-run.js';

/** Mars Genesis's own number of turns. */
export const SIX_TURNS = 6;
/** The population each stored turn reports. */
const POPULATION = 30;

const timeOf = (turn: number): number => 2035 + (turn - 1) * 8;
const titleOf = (turn: number): string => (turn === 1 ? 'Landfall' : 'Dust Season');

/** A department's tool as its report in `turn` lists it: forged in turn 1, used in every turn since. */
function toolInTurn(name: string, description: string, department: string, turn: number, confidence: number) {
  const history = Array.from({ length: turn }, (_, i) => ({
    turn: i + 1,
    time: timeOf(i + 1),
    eventIndex: 0,
    eventTitle: titleOf(i + 1),
    department,
    output: JSON.stringify({ score: 82 }),
    isReforge: i === 0,
    rejected: false,
    confidence,
  }));
  return tool(name, description, department, 1, turn === 1, confidence, { history });
}

export function sixTurnPairRunFrames(): string[] {
  const A = ARIA.name;
  const D = DIETRICH.name;
  const frames = [
    frame('active_scenario', { id: SCENARIO.id, name: SCENARIO.name, runKey: 'a-six-turn-pair-run', forkedFrom: null }),
    frame('status', { phase: 'starting', maxTurns: SIX_TURNS, customEvents: [] }),
    frame('status', { phase: 'parallel', actors: [ARIA, DIETRICH] }),
  ];
  for (let turn = 1; turn <= SIX_TURNS; turn++) {
    const time = timeOf(turn);
    frames.push(
      ...leaderTurn(A, turn, 'engineering',
        turn === 1 ? [forge(A, 1, time, 'engineering', LANDING, LANDING_TEXT, 0.98)] : [],
        [toolInTurn(LANDING, LANDING_TEXT, 'engineering', turn, 0.98)]),
      ...leaderTurn(D, turn, 'medical',
        turn === 1 ? [forge(D, 1, time, 'medical', WATER, WATER_TEXT, 0.97)] : [],
        [toolInTurn(WATER, WATER_TEXT, 'medical', turn, 0.97)]),
      systemsSnapshot(A, turn, time, crewOf(A, turn, DEPARTMENTS, POPULATION)),
      systemsSnapshot(D, turn, time, crewOf(D, turn, DEPARTMENTS, POPULATION)),
    );
  }
  frames.push(frame('complete', { timestamp: '2026-11-16T03:05:00.000Z' }));
  return frames;
}

/** The number of events the dashboard's Event Log holds once the run has played. */
export const SIX_TURN_EVENTS = framesToSimEvents(sixTurnPairRunFrames()).length;
