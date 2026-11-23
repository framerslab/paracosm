/**
 * Build a runtime-accurate `SimulationState`-shaped fixture derived
 * from a scenario's own `world.*` declarations. Used by every compiler
 * generator's smokeTest so validation runs against the shape the hook
 * will actually see at runtime — not a hardcoded Mars fixture that
 * produces false positives and false negatives for non-Mars scenarios.
 *
 * Runtime `SimulationState` has `metrics`, `politics`, `statuses`,
 * `environment`, `agents`, `metadata` at the top level. `world.metrics`
 * AND `world.capacities` both flatten into `state.metrics`;
 * `world.politics` / `world.statuses` / `world.environment` each map
 * to their own runtime bag. The fixture mirrors that shape exactly.
 *
 * @module paracosm/engine/compiler/scenario-fixture
 */
import type { Agent } from '../core/state.js';

interface MetricDefinition {
  id: string;
  label?: string;
  unit?: string;
  type?: 'number' | 'string' | 'boolean';
  initial?: number | string | boolean;
  category?: string;
}

export interface ScenarioFixture {
  metrics: Record<string, number>;
  politics: Record<string, number | string | boolean>;
  statuses: Record<string, string | boolean>;
  environment: Record<string, number | string | boolean>;
  metadata: {
    simulationId: string;
    leaderId: string;
    seed: number;
    startTime: number;
    currentTime: number;
    currentTurn: number;
  };
  agents: Agent[];
  eventLog: never[];
}

function coerceInitial(def: MetricDefinition): number | string | boolean {
  if (def.initial !== undefined) return def.initial;
  switch (def.type) {
    case 'number': return 0;
    case 'string': return '';
    case 'boolean': return false;
    default: return 0;
  }
}

function coerceNumeric(def: MetricDefinition): number {
  const v = coerceInitial(def);
  return typeof v === 'number' ? v : 0;
}

function coerceAny(def: MetricDefinition): number | string | boolean {
  return coerceInitial(def);
}

function mergeBagsNumeric(
  ...bags: Array<Record<string, MetricDefinition> | undefined>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const bag of bags) {
    if (!bag) continue;
    for (const [key, def] of Object.entries(bag)) {
      out[key] = coerceNumeric(def);
    }
  }
  return out;
}

function buildPoliticsBag(
  bag: Record<string, MetricDefinition> | undefined,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  if (!bag) return out;
  for (const [key, def] of Object.entries(bag)) {
    out[key] = coerceAny(def);
  }
  return out;
}

function buildStatusesBag(
  bag: Record<string, MetricDefinition> | undefined,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (!bag) return out;
  for (const [key, def] of Object.entries(bag)) {
    const v = coerceInitial(def);
    out[key] = typeof v === 'boolean' ? v : String(v);
  }
  return out;
}

function buildEnvironmentBag(
  bag: Record<string, MetricDefinition> | undefined,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  if (!bag) return out;
  for (const [key, def] of Object.entries(bag)) {
    out[key] = coerceAny(def);
  }
  return out;
}

function buildSyntheticAgent(startTime: number): Agent {
  return {
    core: {
      id: 'fixture-agent-001',
      name: 'Fixture Agent',
      birthTime: startTime - 30,
      marsborn: false,
      department: 'engineering',
      role: 'engineer',
    },
    health: {
      alive: true,
      psychScore: 0.7,
      conditions: [],
    },
    career: {
      specialization: 'general',
      yearsExperience: 5,
      rank: 'senior',
      achievements: [],
    },
    social: {
      partnerId: undefined,
      childrenIds: [],
      friendIds: [],
      earthContacts: 3,
    },
    narrative: {
      lifeEvents: [],
      featured: false,
    },
    hexaco: {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      emotionality: 0.5,
      honestyHumility: 0.5,
    },
    hexacoHistory: [],
    memory: { shortTerm: [], longTerm: [], stances: {}, relationships: {} },
  } satisfies Agent;
}

/**
 * Build a runtime-accurate `SimulationState`-shaped fixture from a
 * scenario JSON. `state.metrics` is a FLAT bag merged from the scenario's
 * `world.metrics` AND `world.capacities` declarations (both map to
 * runtime numbers under `state.metrics`). `state.politics` carries
 * `world.politics`. Mars-heritage defaults (population, morale) are
 * overlaid so hooks that reference those still validate.
 *
 * A draft with no `world`, or a `world` with no `metrics`, reads as the
 * empty bags `compileScenario` gives that draft: a run of it holds the
 * head count and morale, so its fixture holds those two values (and
 * any declared capacity) and the hooks are tried on that state.
 */
export function buildScenarioFixture(scenarioJson: Record<string, unknown>): ScenarioFixture {
  const world = (scenarioJson.world ?? {}) as {
    metrics?: Record<string, MetricDefinition>;
    capacities?: Record<string, MetricDefinition>;
    statuses?: Record<string, MetricDefinition>;
    politics?: Record<string, MetricDefinition>;
    environment?: Record<string, MetricDefinition>;
  };

  const setup = (scenarioJson.setup ?? {}) as { defaultStartTime?: number };
  const startTime = typeof setup.defaultStartTime === 'number' ? setup.defaultStartTime : 0;
  const scenarioId = (scenarioJson.id as string) ?? 'fixture-scenario';

  // Mars-heritage defaults the kernel always populates, so hooks that
  // read these continue to pass smokeTest even when the scenario doesn't
  // declare them. Scenario-declared metrics and capacities overlay on
  // top to populate the scenario's own keys.
  const marsHeritageSystems: Record<string, number> = {
    population: 100,
    morale: 0.75,
  };
  const metrics = { ...marsHeritageSystems, ...mergeBagsNumeric(world.metrics, world.capacities) };

  return {
    metrics,
    politics: buildPoliticsBag(world.politics),
    statuses: buildStatusesBag(world.statuses),
    environment: buildEnvironmentBag(world.environment),
    metadata: {
      simulationId: `fixture-${scenarioId}`,
      leaderId: 'fixture-leader',
      seed: 42,
      startTime,
      currentTime: startTime,
      currentTurn: 0,
    },
    agents: [buildSyntheticAgent(startTime)],
    eventLog: [],
  };
}
