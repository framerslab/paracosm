/**
 * The /setup body the dashboard's Run control posts for the active
 * scenario. Pure, so the server's own /scenario answer can be fed through
 * it and posted back to /setup in a test.
 */
import type { ScenarioClientPayload } from './hooks/useScenario';
import { leaderUnit } from './hooks/useScenarioLabels.helpers.js';

interface RunActor {
  name: string;
  archetype: string;
  unit?: string;
  hexaco: Record<string, number>;
  instructions: string;
}

const PLACEHOLDER_ACTORS: RunActor[] = [
  { name: 'Actor A', archetype: 'The Visionary', hexaco: { openness: 0.95, conscientiousness: 0.35, extraversion: 0.85, agreeableness: 0.55, emotionality: 0.3, honestyHumility: 0.65 }, instructions: '' },
  { name: 'Actor B', archetype: 'The Engineer', hexaco: { openness: 0.25, conscientiousness: 0.97, extraversion: 0.3, agreeableness: 0.6, emotionality: 0.7, honestyHumility: 0.9 }, instructions: '' },
];

/** The two leaders a one-click run starts with: the scenario's default preset, with a placeholder in a slot it leaves empty. */
export function defaultRunActors(scenario: ScenarioClientPayload): RunActor[] {
  const defaultPreset = scenario.presets.find(p => p.id === 'default');
  const leaders = defaultPreset?.leaders ?? defaultPreset?.actors ?? [];
  return PLACEHOLDER_ACTORS.map((placeholder, i) => {
    const actor = leaders[i] ?? placeholder;
    return { ...actor, unit: actor.unit ?? leaderUnit(scenario, i) };
  });
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
