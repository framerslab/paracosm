/**
 * The /setup body the dashboard's Run control posts for the active
 * scenario. Pure, so the server's own /scenario answer can be fed through
 * it and posted back to /setup in a test.
 */
import type { ScenarioClientPayload } from './hooks/useScenario';
import { leaderUnit } from './hooks/useScenarioLabels.helpers.js';

/** The two leaders a one-click run starts with: the scenario's default preset, or placeholders where it has none. */
export function defaultRunActors(scenario: ScenarioClientPayload) {
  const defaultPreset = scenario.presets.find(p => p.id === 'default');
  const leaders = (defaultPreset?.leaders ?? defaultPreset?.actors)?.slice(0, 2);
  if (leaders && leaders.length === 2) {
    return leaders.map((a, i) => ({ ...a, unit: a.unit ?? leaderUnit(scenario, i) }));
  }
  return [
    { name: 'Actor A', archetype: 'The Visionary', unit: leaderUnit(scenario, 0), hexaco: { openness: 0.95, conscientiousness: 0.35, extraversion: 0.85, agreeableness: 0.55, emotionality: 0.3, honestyHumility: 0.65 }, instructions: '' },
    { name: 'Actor B', archetype: 'The Engineer', unit: leaderUnit(scenario, 1), hexaco: { openness: 0.25, conscientiousness: 0.97, extraversion: 0.3, agreeableness: 0.6, emotionality: 0.7, honestyHumility: 0.9 }, instructions: '' },
  ];
}

/** The whole /setup body of a one-click run. */
export function defaultRunSetup(scenario: ScenarioClientPayload) {
  return {
    actors: defaultRunActors(scenario),
    provider: 'openai',
    turns: scenario.setup.defaultTurns,
    timePerTurn: scenario.setup.defaultTimePerTurn,
    seed: scenario.setup.defaultSeed,
    startTime: scenario.setup.defaultStartTime,
    population: scenario.setup.defaultPopulation,
    activeDepartments: scenario.departments.map(d => d.id),
    scenarioId: scenario.id,
    // Tier 2 Spec 2B: always capture kernel snapshots on
    // UI-initiated runs so the Reports tab's "Fork at turn N"
    // button is enabled by default.
    captureSnapshots: true,
  };
}
