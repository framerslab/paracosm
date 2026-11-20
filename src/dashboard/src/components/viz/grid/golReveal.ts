/**
 * Pure helpers for the Game-of-Life tile reveal fade.
 *
 * On a cached load, a replay or a fast scrub, LivingSwarmGrid receives a
 * snapshot whose turn jumps by more than one in a single update, or its
 * first snapshot after the mount curtain has already lifted. Painted at once,
 * the tile layer's whole steady-state pattern would land in a single frame
 * (the "gray gradient" / "dark wash" read). These helpers drive a short
 * ease-out fade so the tiles stream in instead.
 */

/** Fade duration (ms) for the GoL tile reveal on a jump load. */
export const GOL_REVEAL_MS = 500;

/**
 * True when a turn change should ease the tile layer in: the first seed
 * (`prevTurn < 0`), or a jump of more than one turn, as a cached load, a
 * replay landing on its last turn or a scrub makes. A single-turn step, as a
 * live run or playback advances, reseeds in place.
 */
export function isJumpReveal(prevTurn: number, nextTurn: number): boolean {
  if (prevTurn < 0) return true;
  return Math.abs(nextTurn - prevTurn) > 1;
}

/**
 * Eased alpha for the GoL tile draw, ramping 0 → `baseAlpha` over
 * `durationMs` with an ease-out-cubic curve so the layer builds in
 * front-loaded and settles smoothly.
 *
 * - `reducedMotion` returns `baseAlpha` immediately (no animation).
 * - A non-positive `durationMs` is treated as instant (full alpha).
 * - `elapsedMs` clamps to [0, durationMs], so a fresh fade reads 0 and an
 *   inactive fade (elapsed === +Infinity) reads full alpha.
 */
export function golRevealAlpha(
  baseAlpha: number,
  elapsedMs: number,
  durationMs: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || durationMs <= 0) return baseAlpha;
  const progress = Math.max(0, Math.min(1, elapsedMs / durationMs));
  const eased = 1 - (1 - progress) ** 3; // ease-out cubic
  return baseAlpha * eased;
}
