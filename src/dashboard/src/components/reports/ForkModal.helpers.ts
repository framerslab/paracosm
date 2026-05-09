/**
 * Pure helpers for the ForkModal (Tier 2 Spec 2B). Unit-tested in
 * isolation; the modal component is a thin wrapper that wires user
 * input to these functions and to the fork-POST to `/setup`.
 *
 * @module reports/ForkModal.helpers
 */
import type { ScenarioPackage, ActorConfig } from '../../../../engine/types.js';

function normalizeHexacoProfile(hexaco: Record<string, number>): NonNullable<ActorConfig['hexaco']> {
  const readTrait = (trait: keyof NonNullable<ActorConfig['hexaco']>) => {
    const value = hexaco[trait];
    return Number.isFinite(value) ? value : 0.5;
  };
  return {
    openness: readTrait('openness'),
    conscientiousness: readTrait('conscientiousness'),
    extraversion: readTrait('extraversion'),
    agreeableness: readTrait('agreeableness'),
    emotionality: readTrait('emotionality'),
    honestyHumility: readTrait('honestyHumility'),
  };
}

/**
 * Build the leader preset list shown in the fork modal's picker.
 * Source order: scenario preset-bundle leaders first, then
 * session-custom leaders passed in by the caller (from Settings
 * panel state, when the user has configured non-preset leaders).
 *
 * Preset leaders lack a `unit` field in the scenario JSON; we fill
 * it with "Forked Branch" so the forked run has a stable display
 * label. Callers can edit or replace the unit before POST if the
 * modal exposes that field.
 *
 * @param scenario Currently-active scenario.
 * @param sessionCustoms Extra leaders the user built this session.
 * @returns Array of {@link ActorConfig}. Empty when scenario has
 *   no presets and no customs were supplied.
 */
export function resolveLeaderPresets(
  scenario: ScenarioPackage,
  sessionCustoms: ActorConfig[] = [],
): ActorConfig[] {
  const presetLeaders = (scenario.presets?.[0]?.leaders ?? []).map(l => ({
    name: l.name,
    archetype: l.archetype,
    unit: 'Forked Branch',
    hexaco: normalizeHexacoProfile(l.hexaco),
    instructions: l.instructions,
  }));
  return [...presetLeaders, ...sessionCustoms];
}

/** Per-turn cost envelope in USD. Rough numbers anchored to the
 *  paracosm README "Cost envelope" table and updated as models shift.
 *  Used only for the fork modal's display-estimate; not billing-grade. */
const PER_TURN_COST: Record<'openai' | 'anthropic', Record<'quality' | 'economy', number>> = {
  openai: { quality: 0.3, economy: 0.03 },
  anthropic: { quality: 0.75, economy: 0.6 },
};

/**
 * Estimate the total LLM cost of running a forked branch from
 * `fromTurn` to `maxTurns`. Resolves per-turn cost against the
 * `PER_TURN_COST` table, rounds up to the nearest dime.
 *
 * @returns Display string like "~$0.60" or "~$4.50". Not a
 *   commitment; real cost depends on events, forged tools,
 *   schema-retry incidents, etc.
 */
export function estimateForkCost(
  fromTurn: number,
  maxTurns: number,
  costPreset: 'quality' | 'economy',
  provider: 'openai' | 'anthropic',
): string {
  const turnsRemaining = Math.max(0, maxTurns - fromTurn);
  const perTurn = PER_TURN_COST[provider][costPreset];
  const total = turnsRemaining * perTurn;
  const rounded = Math.ceil(total * 10) / 10;
  return `~$${rounded.toFixed(2)}`;
}

/**
 * Parse the fork modal's custom-events textarea. One event per line,
 * format: `{turn}: {title}: {description}`. Lines without a turn
 * prefix, empty title, or malformed structure are silently dropped.
 * Shape matches {@link RunOptions.customEvents} so the parsed output
 * can be forwarded directly to `/setup`.
 *
 * @param input Raw textarea value.
 * @returns Array of `{ turn, title, description }`.
 */
export function parseCustomEvents(
  input: string,
): Array<{ turn: number; title: string; description: string }> {
  const events: Array<{ turn: number; title: string; description: string }> = [];
  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^(\d+)\s*:\s*([^:]+?)\s*:\s*(.+)$/.exec(line);
    if (!match) continue;
    const turn = parseInt(match[1], 10);
    const title = match[2].trim();
    const description = match[3].trim();
    if (!title) continue;
    events.push({ turn, title, description });
  }
  return events;
}
