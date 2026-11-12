/**
 * Build the "AVAILABLE STATE SHAPE" block that every state-accessing
 * generator's system prompt includes. Declares the exact flat key list
 * on each runtime state bag so the LLM cannot silently hallucinate
 * nested access patterns.
 *
 * Paracosm's runtime `SimulationState` carries `metrics`, `politics`,
 * `statuses`, `environment`, `agents`, `metadata` at the top level.
 * Scenario-declared keys under `world.metrics` + `world.capacities`
 * both flatten into `state.metrics`. `world.politics` / `world.statuses`
 * / `world.environment` each have their own runtime bag.
 *
 * @module paracosm/engine/compiler/state-shape-block
 */

interface MetricDef { id: string; type?: 'number' | 'string' | 'boolean' }

function keys(bag: Record<string, MetricDef> | undefined): string[] {
  return bag ? Object.keys(bag) : [];
}

function listOrNone(ks: string[]): string {
  return ks.length ? ks.join(', ') : '(none declared)';
}

/** A key a hook can read as `state.<bag>.<key>`. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * One more rule, only for a scenario that declares a key that is not a
 * JavaScript identifier (a scenario compiled from a prompt declares
 * kebab-case keys): `state.metrics.soil-health` is a subtraction that
 * throws. Its example is the first such key, in its own bag. A scenario
 * whose keys are all identifiers gets no line, so its block is unchanged.
 */
function bracketRule(bags: Array<[bag: string, keys: string[]]>): string {
  for (const [bag, ks] of bags) {
    const key = ks.find(k => !IDENTIFIER.test(k));
    if (key === undefined) continue;
    const quoted = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `\n- A key that is not a plain identifier is read with brackets: state.${bag}['${quoted}'].`;
  }
  return '';
}

export function buildStateShapeBlock(scenarioJson: Record<string, unknown>): string {
  const world = (scenarioJson.world ?? {}) as Record<string, Record<string, MetricDef> | undefined>;
  const labels = (scenarioJson.labels ?? {}) as { timeUnitNoun?: string; timeUnitNounPlural?: string };
  const timeUnit = labels.timeUnitNoun ?? 'tick';
  const timeUnitPlural = labels.timeUnitNounPlural ?? 'ticks';

  // world.metrics and world.capacities both flatten into state.metrics at runtime.
  const systemsKeys = Array.from(new Set([...keys(world.metrics), ...keys(world.capacities)]));
  const politicsKeys = keys(world.politics);
  const statusesKeys = keys(world.statuses);
  const environmentKeys = keys(world.environment);

  return `AVAILABLE STATE SHAPE (read-only, flat):

state.metrics = Record<string, number>
  declared keys: ${listOrNone(systemsKeys)}
  (population + morale also present as Mars-heritage defaults; scenario may omit them.)
state.politics = Record<string, number | string | boolean>
  declared keys: ${listOrNone(politicsKeys)}
state.statuses = Record<string, string | boolean>
  declared keys: ${listOrNone(statusesKeys)}
state.environment = Record<string, number | string | boolean>
  declared keys: ${listOrNone(environmentKeys)}
state.agents = Array<{ core, health, career, social, narrative, hexaco, promotion?, hexacoHistory, memory }>
state.metadata = { simulationId, leaderId, seed, startTime, currentTime, currentTurn }

RULES:
- Access pattern is state.<bag>.<key> — flat, never nested. state.metrics.<key> is always a number.${bracketRule([
    ['metrics', systemsKeys],
    ['politics', politicsKeys],
    ['statuses', statusesKeys],
    ['environment', environmentKeys],
  ])}
- Only reference keys in the declared lists above. Unknown keys are undefined and will throw on .toFixed() / nested property access. Defensive access like \`(state.metrics.foo ?? 0)\` is safer than bare \`state.metrics.foo\`.
- Time is measured in ${timeUnit} units (plural: ${timeUnitPlural}). Use that vocabulary in any user-visible strings.`;
}
