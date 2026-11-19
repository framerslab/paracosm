/**
 * The stream of one finished Mars Genesis pair run, as the orchestrator emits
 * it for two leaders over two turns. Importing this file starts nothing: the
 * shared-run server stores these frames, and unit tests read them.
 *
 * Twelve tools from thirteen forges, nine passed and four did not pass:
 *
 *   Aria Chen (5 tools from 6 forges)
 *     engineering 1   mars_landing_site_score     passed 0.98, used again in turn 2
 *     agriculture 1   greenhouse_yield_forecast   passed 0.95
 *     agriculture 1   water_ration_index          did not pass (its reason is cut at 240 characters)
 *     engineering 2   habitat_pressure_check      passed 0.94
 *     engineering 2   dust_storm_shelter_plan     did not pass, and no report lists it
 *     agriculture 2   water_ration_index          forged again, passed 0.91
 *   Dietrich Voss (7 tools from 7 forges)
 *     medical 1       perchlorate_water_response_score   passed 0.97
 *     medical 1       radiation_dose_budget       did not pass; it has input and output schemas
 *     engineering 1   oxygen_reserve_days         passed 0.96, declares no fields, used again in turn 2
 *     medical 2       a name of 120 characters    passed 0.90
 *     psychology 2    crew_morale_index           did not pass, with no reason recorded
 *     engineering 2   habitat_pressure_check      passed 0.92 (the name Aria Chen forged too)
 *     governance 2    rover_route_planner         passed 0.93
 *
 * A department reports once for a turn's event, and the page keeps one
 * report for an actor, turn, event and department. So a tool forged in a
 * department and turn the run already reports (engineering 2 of Aria Chen,
 * medical 1 and 2 of Dietrich Voss) is forged inside that report; every other
 * added tool rides in a report of its own after its turn's frames. Each turn
 * ends with each leader's population, which the Viz tab's living grid draws.
 */
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { crewOf, departmentReport, forge, frame, leaderTurn, systemsSnapshot, tool } from './run-frames.js';

export const SCENARIO = { id: marsScenario.id, name: marsScenario.labels.name };
/** The scenario's five departments: medical, engineering, agriculture, psychology, governance. */
export const DEPARTMENTS: string[] = marsScenario.departments.map(d => d.id);

export const ARIA = { name: 'Aria Chen', archetype: 'The Visionary' };
export const DIETRICH = { name: 'Dietrich Voss', archetype: 'The Engineer' };

export const LANDING = 'mars_landing_site_score';
export const LANDING_TEXT = 'Scores a landing site on radiation and subsurface ice.';
export const WATER = 'perchlorate_water_response_score';
export const WATER_TEXT = 'Scores the water supply response to a perchlorate reading.';

export const GREENHOUSE = 'greenhouse_yield_forecast';
export const HABITAT = 'habitat_pressure_check';
export const SHELTER = 'dust_storm_shelter_plan';
export const RATION = 'water_ration_index';
export const RADIATION = 'radiation_dose_budget';
export const MORALE = 'crew_morale_index';
export const OXYGEN = 'oxygen_reserve_days';
/** 120 characters with no break. */
export const LONG_NAME = 'solar_flare_shelter_time_'.repeat(5).slice(0, 120);
export const ROVER = 'rover_route_planner';

/** The guidance the forge returns for code that is not a plain synchronous function. */
export const SHELTER_REASON = 'Forged code here is synchronous: define a plain `function execute(input) { ... }` that returns its result directly.';
/** A reason longer than the record holds, cut at 240 characters as the orchestrator cuts it. */
export const RATION_REASON = (
  'Execution error: the forged code read input.reserve_litres before checking that the field is present, so the first test case, '
  + 'which leaves it out, threw a TypeError; the second test case returned NaN where the output schema declares a number between 0 and 1, '
  + 'and the third never ran.'
).slice(0, 240);
export const RADIATION_REASON = 'The output did not match the declared output schema: "budget_msv" is required.';

const RADIATION_INPUT = {
  type: 'object',
  properties: {
    dose_msv_per_day: { type: 'number', description: 'Measured dose a day, in millisieverts.' },
    mission_days: { type: 'integer' },
  },
  required: ['dose_msv_per_day'],
};
const RADIATION_OUTPUT = {
  type: 'object',
  properties: { budget_msv: { type: 'number', description: 'Dose left before the career limit.' } },
  required: ['budget_msv'],
};
const NO_FIELDS = { type: 'object', properties: {} };

const timeOf = (turn: number): number => 2035 + (turn - 1) * 8;
/** The population each stored turn reports. */
const POPULATION = 30;
const titleOf = (turn: number): string => (turn === 1 ? 'Landfall' : 'Dust Season');

/** One row of a tool's history: the department call that forged it or used it. */
function historyRow(turn: number, department: string, output: string | null, isReforge: boolean, rejected: boolean, confidence: number) {
  return { turn, time: timeOf(turn), eventIndex: 0, eventTitle: titleOf(turn), department, output, isReforge, rejected, confidence };
}

const SCORE = JSON.stringify({ score: 82 });
/** A forge frame's time of its own: the stored two keep theirs, at second 10. */
const at = (second: number): string => `2026-11-16T01:52:${String(second).padStart(2, '0')}.000Z`;

export function pairRunFrames(): string[] {
  const A = ARIA.name;
  const D = DIETRICH.name;

  const landingForged = historyRow(1, 'engineering', SCORE, true, false, 0.98);
  const landingUsed = historyRow(2, 'engineering', SCORE, false, false, 0.98);
  const rationRejected = historyRow(1, 'agriculture', null, true, true, 0);
  const rationForged = historyRow(2, 'agriculture', SCORE, true, false, 0.91);
  const oxygenForged = historyRow(1, 'engineering', '41', true, false, 0.96);
  const oxygenUsed = historyRow(2, 'engineering', '41', false, false, 0.96);

  const failed = (reason?: string) => ({ approved: false, confidence: 0, ...(reason ? { errorReason: reason } : {}) });
  const oxygenFields = { inputFields: [], outputFields: [], inputSchema: NO_FIELDS, outputSchema: NO_FIELDS, output: '41' };
  const radiationFields = {
    inputFields: Object.keys(RADIATION_INPUT.properties), outputFields: Object.keys(RADIATION_OUTPUT.properties),
    inputSchema: RADIATION_INPUT, outputSchema: RADIATION_OUTPUT,
  };

  return [
    frame('active_scenario', { id: SCENARIO.id, name: SCENARIO.name, runKey: 'a-shared-pair-run', forkedFrom: null }),
    frame('status', { phase: 'starting', maxTurns: 2, customEvents: [] }),
    frame('status', { phase: 'parallel', actors: [ARIA, DIETRICH] }),

    // Turn 1.
    ...leaderTurn(A, 1, 'engineering',
      [forge(A, 1, 2035, 'engineering', LANDING, LANDING_TEXT, 0.98)],
      [tool(LANDING, LANDING_TEXT, 'engineering', 1, true, 0.98, { history: [landingForged] })]),
    ...leaderTurn(D, 1, 'medical',
      [
        forge(D, 1, 2035, 'medical', WATER, WATER_TEXT, 0.97),
        forge(D, 1, 2035, 'medical', RADIATION, 'Budgets the radiation dose left for a crew member.', 0, {
          ...failed(RADIATION_REASON), inputFields: radiationFields.inputFields, outputFields: radiationFields.outputFields, timestamp: at(14),
        }),
      ],
      [
        tool(WATER, WATER_TEXT, 'medical', 1, true, 0.97, { history: [historyRow(1, 'medical', SCORE, true, false, 0.97)] }),
        tool(RADIATION, 'Budgets the radiation dose left for a crew member.', 'medical', 1, true, 0, {
          ...failed(RADIATION_REASON), ...radiationFields, output: null, history: [historyRow(1, 'medical', null, true, true, 0)],
        }),
      ]),
    ...departmentReport(A, 1, 'agriculture',
      [
        forge(A, 1, 2035, 'agriculture', GREENHOUSE, 'Forecasts the greenhouse yield for the next harvest.', 0.95, { timestamp: at(18) }),
        forge(A, 1, 2035, 'agriculture', RATION, 'Indexes the water ration against the reserve.', 0, { ...failed(RATION_REASON), timestamp: at(22) }),
      ],
      [
        tool(GREENHOUSE, 'Forecasts the greenhouse yield for the next harvest.', 'agriculture', 1, true, 0.95, { history: [historyRow(1, 'agriculture', SCORE, true, false, 0.95)] }),
        tool(RATION, 'Indexes the water ration against the reserve.', 'agriculture', 1, true, 0, { ...failed(RATION_REASON), output: null, history: [rationRejected] }),
      ]),
    ...departmentReport(D, 1, 'engineering',
      [forge(D, 1, 2035, 'engineering', OXYGEN, 'Counts the days the oxygen reserve lasts.', 0.96, { inputFields: [], outputFields: [], timestamp: at(26) })],
      [tool(OXYGEN, 'Counts the days the oxygen reserve lasts.', 'engineering', 1, true, 0.96, { ...oxygenFields, history: [oxygenForged] })]),
    systemsSnapshot(A, 1, timeOf(1), crewOf(A, 1, DEPARTMENTS, POPULATION)),
    systemsSnapshot(D, 1, timeOf(1), crewOf(D, 1, DEPARTMENTS, POPULATION)),

    // Turn 2.
    ...leaderTurn(A, 2, 'engineering',
      [
        forge(A, 2, 2043, 'engineering', HABITAT, 'Checks the habitat pressure against its safe range.', 0.94, { timestamp: at(30) }),
        // Its only forge did not pass, and the report below does not list it.
        forge(A, 2, 2043, 'engineering', SHELTER, 'Plans where the crew shelters in a dust storm.', 0, { ...failed(SHELTER_REASON), timestamp: at(34) }),
      ],
      [
        tool(LANDING, LANDING_TEXT, 'engineering', 1, false, 0.98, { history: [landingForged, landingUsed] }),
        tool(HABITAT, 'Checks the habitat pressure against its safe range.', 'engineering', 2, true, 0.94, { history: [historyRow(2, 'engineering', SCORE, true, false, 0.94)] }),
      ]),
    ...leaderTurn(D, 2, 'medical',
      [forge(D, 2, 2043, 'medical', LONG_NAME, 'Times the walk to shelter when a solar flare is forecast.', 0.9, { timestamp: at(38) })],
      [tool(LONG_NAME, 'Times the walk to shelter when a solar flare is forecast.', 'medical', 2, true, 0.9, { history: [historyRow(2, 'medical', SCORE, true, false, 0.9)] })]),
    ...departmentReport(A, 2, 'agriculture',
      [forge(A, 2, 2043, 'agriculture', RATION, 'Indexes the water ration against the reserve.', 0.91, { timestamp: at(42) })],
      [tool(RATION, 'Indexes the water ration against the reserve.', 'agriculture', 1, false, 0.91, { history: [rationRejected, rationForged] })]),
    ...departmentReport(D, 2, 'psychology',
      [forge(D, 2, 2043, 'psychology', MORALE, 'Indexes crew morale from the week\'s check-ins.', 0, { ...failed(), timestamp: at(46) })],
      [tool(MORALE, 'Indexes crew morale from the week\'s check-ins.', 'psychology', 2, true, 0, { ...failed(), output: null, history: [historyRow(2, 'psychology', null, true, true, 0)] })]),
    ...departmentReport(D, 2, 'engineering',
      [forge(D, 2, 2043, 'engineering', HABITAT, 'Checks the habitat pressure against its safe range.', 0.92, { timestamp: at(50) })],
      [
        tool(OXYGEN, 'Counts the days the oxygen reserve lasts.', 'engineering', 1, false, 0.96, { ...oxygenFields, history: [oxygenForged, oxygenUsed] }),
        tool(HABITAT, 'Checks the habitat pressure against its safe range.', 'engineering', 2, true, 0.92, { history: [historyRow(2, 'engineering', SCORE, true, false, 0.92)] }),
      ]),
    ...departmentReport(D, 2, 'governance',
      [forge(D, 2, 2043, 'governance', ROVER, 'Plans a rover route between two sites.', 0.93, { timestamp: at(54) })],
      [tool(ROVER, 'Plans a rover route between two sites.', 'governance', 2, true, 0.93, { history: [historyRow(2, 'governance', SCORE, true, false, 0.93)] })]),
    systemsSnapshot(A, 2, timeOf(2), crewOf(A, 2, DEPARTMENTS, POPULATION)),
    systemsSnapshot(D, 2, timeOf(2), crewOf(D, 2, DEPARTMENTS, POPULATION)),

    frame('complete', { timestamp: '2026-11-16T01:55:39.000Z' }),
  ];
}
