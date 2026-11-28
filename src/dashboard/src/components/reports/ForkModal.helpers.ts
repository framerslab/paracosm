/**
 * Pure helpers for the ForkModal (Tier 2 Spec 2B). Unit-tested in
 * isolation; the modal component is a thin wrapper that wires user
 * input to these functions and to the fork-POST to `/setup`.
 *
 * @module reports/ForkModal.helpers
 */
import type { ScenarioPackage, ActorInput } from '../../../../engine/types.js';
import { actorForLaunch } from '../../run-payload.js';

function normalizeHexacoProfile(hexaco: Record<string, number>): NonNullable<ActorInput['hexaco']> {
  const readTrait = (trait: keyof NonNullable<ActorInput['hexaco']>) => {
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
 * @returns Array of {@link ActorInput}. Empty when scenario has
 *   no presets and no customs were supplied.
 */
export function resolveLeaderPresets(
  scenario: ScenarioPackage,
  sessionCustoms: ActorInput[] = [],
): ActorInput[] {
  const presetLeaders = (scenario.presets?.[0]?.leaders ?? []).map(leader => ({
    ...leader,
    unit: 'Forked Branch',
    hexaco: normalizeHexacoProfile(leader.hexaco),
    ...(leader.aiAuthorship ? { aiAuthorship: { ...leader.aiAuthorship, fields: leader.aiAuthorship.fields.filter(field => field !== 'unit') } } : {}),
  }));
  return [...presetLeaders, ...sessionCustoms].map(actorForLaunch);
}

/** Per-turn cost envelope in USD. Rough numbers anchored to the
 *  paracosm README "Cost envelope" table and updated as models shift;
 *  OpenAI economy is the mean of the four hosted demo runs measured on
 *  30 October and 1 November 2026 (0.59 USD over 6 turns).
 *  Used only for the fork modal's display-estimate; not billing-grade. */
const PER_TURN_COST: Record<'openai' | 'anthropic', Record<'quality' | 'economy', number>> = {
  openai: { quality: 0.3, economy: 0.1 },
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

type CustomEvent = { turn: number; title: string; description: string };

/** Whether a non-empty custom-event line will be used by the fork. */
export type CustomEventLine =
  | { lineNumber: number; status: 'used'; event: CustomEvent }
  | { lineNumber: number; status: 'before-fork' | 'after-fork'; turn: number }
  | { lineNumber: number; status: 'same-turn'; turn: number; firstLineNumber: number }
  | { lineNumber: number; status: 'malformed' };

function parseCustomEventLine(line: string): CustomEvent | undefined {
  const match = /^(\d+)\s*:\s*([^:]+?)\s*:\s*(.+)$/.exec(line);
  if (!match) return undefined;
  const title = match[2].trim();
  if (!title) return undefined;
  return { turn: parseInt(match[1], 10), title, description: match[3].trim() };
}

/**
 * Parse lines in `turn: title: description` form into the event payload for
 * `/setup`. Use {@link inspectCustomEventLines} for line-by-line feedback
 * and the playable turn range.
 */
export function parseCustomEvents(input: string): CustomEvent[] {
  return input.split('\n').flatMap(rawLine => {
    const event = parseCustomEventLine(rawLine.trim());
    return event ? [event] : [];
  });
}

/**
 * Inspect each non-empty line against the turns the fork will play,
 * from the turn after its snapshot through the final turn, inclusive.
 * With `onePerTurn` (a fork on the hosted demo's keys, see
 * {@link forkRunLimits}), a later line for a turn that an earlier usable
 * line already holds is `same-turn`: the run keeps the first.
 */
export function inspectCustomEventLines(
  input: string,
  atTurn: number,
  maxTurns: number,
  { onePerTurn = false }: { onePerTurn?: boolean } = {},
): CustomEventLine[] {
  const lines: CustomEventLine[] = [];
  const firstLineOfTurn = new Map<number, number>();
  for (const [index, rawLine] of input.split('\n').entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const lineNumber = index + 1;
    const event = parseCustomEventLine(line);
    if (!event) {
      lines.push({ lineNumber, status: 'malformed' });
    } else if (event.turn <= atTurn) {
      lines.push({ lineNumber, status: 'before-fork', turn: event.turn });
    } else if (event.turn > maxTurns) {
      lines.push({ lineNumber, status: 'after-fork', turn: event.turn });
    } else if (onePerTurn && firstLineOfTurn.has(event.turn)) {
      const firstLineNumber = firstLineOfTurn.get(event.turn) ?? lineNumber;
      lines.push({ lineNumber, status: 'same-turn', turn: event.turn, firstLineNumber });
    } else {
      firstLineOfTurn.set(event.turn, lineNumber);
      lines.push({ lineNumber, status: 'used', event });
    }
  }
  return lines;
}

/** The snapshots a saved run holds for replay alone (#235); a fork branches from `kernelSnapshotsPerTurn`. */
const REPLAY_ONLY_SNAPSHOTS = new Set(['kernelSnapshotAtStart', 'kernelSnapshotsAfterProgression']);

/**
 * The parent run as the fork posts it to `/setup`: without the snapshots
 * only replay reads. They hold one more kernel snapshot than the turns,
 * each about the size of an end-of-turn one, and the server refuses a
 * request body over its limit (5 MiB unless `MAX_REQUEST_BODY_BYTES` sets
 * another). The run the page holds keeps them.
 */
export function forkParentForPost<T extends { scenarioExtensions?: unknown }>(parent: T): T {
  const ext = parent.scenarioExtensions;
  if (!ext || typeof ext !== 'object') return parent;
  const kept = Object.fromEntries(Object.entries(ext as Record<string, unknown>).filter(([key]) => !REPLAY_ONLY_SNAPSHOTS.has(key)));
  return { ...parent, scenarioExtensions: kept };
}

/** The parts of a parent run the fork controls read. */
export interface ForkParent {
  trajectory?: { timepoints?: unknown[] };
  scenarioExtensions?: unknown;
}

function snapshotTurns(parent: ForkParent): number[] {
  const snaps = (parent.scenarioExtensions as { kernelSnapshotsPerTurn?: Array<{ turn?: unknown }> } | undefined)
    ?.kernelSnapshotsPerTurn;
  return Array.isArray(snaps)
    ? snaps.map(s => s?.turn).filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
    : [];
}

/**
 * The parent run's final turn: the absolute turn a fork posts to
 * `/setup` as `turns`. Snapshots carry absolute turn numbers, so the
 * last snapshot's turn decides; the trajectory's timepoint count only
 * when it is larger, then 6. A forked run's trajectory holds only the
 * turns it ran (turns 4 to 6 of a fork at turn 3 give 3 timepoints), so
 * the count alone put its final turn at 3.
 */
export function forkFinalTurn(parent: ForkParent): number {
  const points = parent.trajectory?.timepoints?.length ?? 0;
  const turns = snapshotTurns(parent);
  const last = Math.max(points, ...turns);
  return last > 0 ? last : 6;
}

/** What the server's `/admin-config` says about who pays for a fork and its turn cap. */
export interface ForkServer {
  hostedDemo?: boolean;
  demoCaps?: { maxTurns?: number };
}

/**
 * The last turn a fork plays and whether a turn keeps one custom event.
 * Reports posts a fork with no provider key, so on the hosted demo the host
 * pays and `/setup` applies the demo caps (`applyDemoCaps`): the fork ends
 * at the smaller of the parent's final turn and the turn cap, and each turn
 * keeps its first custom event. Elsewhere the fork plays through the
 * parent's final turn and keeps every event.
 */
export function forkRunLimits(parent: ForkParent, server?: ForkServer): { finalTurn: number; onePerTurn: boolean } {
  const finalTurn = forkFinalTurn(parent);
  if (server?.hostedDemo !== true) return { finalTurn, onePerTurn: false };
  const cap = server.demoCaps?.maxTurns;
  const capped = typeof cap === 'number' && Number.isInteger(cap) && cap > 0 ? Math.min(finalTurn, cap) : finalTurn;
  return { finalTurn: capped, onePerTurn: true };
}

/**
 * Whether the Reports tab offers a fork at `turn`: the parent holds a
 * snapshot for it, and a turn is left to run after it. A fork at the
 * final turn posts `turns` equal to its fork turn, which `/setup`
 * refuses, so the control is not shown there; on the hosted demo the
 * final turn is the one {@link forkRunLimits} gives.
 */
export function canForkAtTurn(parent: ForkParent, turn: number, server?: ForkServer): boolean {
  return snapshotTurns(parent).includes(turn) && turn < forkRunLimits(parent, server).finalTurn;
}
