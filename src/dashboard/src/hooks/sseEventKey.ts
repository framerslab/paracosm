import type { SimEvent } from './useSSE';

/**
 * The key that identifies one logical event of the run's stream. The stream
 * hook drops a frame whose key it has already seen, so a buffer replay after
 * a reconnect does not add an event twice.
 *
 * IMPORTANT: the orchestrator emits events with turn nested in
 * `e.data.turn`, not the top-level `e.turn` field. Earlier versions
 * of this key only looked at `e.turn` (always undefined in practice)
 * and relied on eventIndex/department/title as the real
 * discriminators. That silently ate every turn after turn 1 for
 * event types that have no other discriminator in their payload:
 * systems_snapshot, turn_done, personality_drift, bulletin, agent_reactions.
 *
 * The user-visible symptom was the viz tab stuck showing T1 while
 * the sim tab correctly counted up to T3+ (because the only
 * replacement systems_snapshot events for T2/T3 were filtered as
 * "already seen"). Falling back to `e.data?.turn` when the top-level
 * field is missing restores a monotonic key across turns for every
 * emit path.
 */
export function eventKey(e: SimEvent): string {
  const turnId = (e.turn ?? (e.data?.turn as number | undefined) ?? '');
  const eventIndex = (e.data?.eventIndex ?? '');
  const department = (e.data?.department ?? '');
  const title = (e.data?.title ?? '');
  // Some per-agent / per-tool payloads need extra discriminators
  // too, so they don't collapse across different agents/tools in
  // the same turn. Forge attempts carry `name`; agent reactions
  // roll up into a single per-turn event so the turn suffices.
  const forgeName = (e.data?.name ?? '');
  // A department may forge one tool more than once in one call: a re-forge
  // after a forge that did not pass. Each forge_attempt frame carries the
  // time its forge ended, so the two keep two keys, and a buffer replay sends
  // the same frame with the same time, so its repeat is still dropped.
  const forgeEnded = e.type === 'forge_attempt' ? `|${String(e.data?.timestamp ?? '')}` : '';
  // A `validation_fallback` event carries no turn, event or department
  // of its own: its call site names them (`dept:engineering:turn1:event1`),
  // and a salvage is told apart from a fallback. Without them every such
  // event of a leader after the first was taken for a repeat and dropped.
  const schemaCall = e.type === 'validation_fallback'
    ? `|${String(e.data?.site ?? '')}|${String(e.data?.schemaName ?? '')}|${e.data?.salvaged === true ? 'salvaged' : ''}`
    : '';
  return `${e.type}|${e.leader || ''}|${turnId}|${eventIndex}|${department}|${title}|${forgeName}${forgeEnded}${schemaCall}`;
}
