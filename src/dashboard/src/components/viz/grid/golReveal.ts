/**
 * Pure helpers for the Game-of-Life tile reveal fade.
 *
 * On a cached re-run or a fast scrub, LivingSwarmGrid receives a new
 * snapshot whose turn jumps by more than one in a single update. The
 * grid is not remounted, so the mount-time reveal curtain does not
 * re-fire and the GoL tile layer would otherwise paint its full
 * steady-state pattern in a single frame — the recurring "gray
 * gradient" / "dark wash" complaint on the viz tab. These helpers drive
 * a short ease-out fade so the tiles stream in instead of slamming.
 */

/** Fade duration (ms) for the GoL tile reveal on a jump load. */
export const GOL_REVEAL_MS = 500;

/**
 * True when a turn change is a "jump" load that should trigger the tile
 * fade — a cached re-run reset or a multi-turn scrub — as opposed to a
 * live single-turn advance or the very first seed.
 *
 * The initial seed (`prevTurn < 0`) is excluded because the mount-time
 * reveal curtain already covers it; firing here too would double the
 * fade. A live run advances exactly one turn per update, so a delta of
 * one is excluded and streams in naturally.
 */
export function isJumpReveal(prevTurn: number, nextTurn: number): boolean {
  if (prevTurn < 0) return false;
  return Math.abs(nextTurn - prevTurn) > 1;
}

/**
 * Eased alpha for the GoL tile draw, ramping 0 → `baseAlpha` over
 * `durationMs` with an ease-out-cubic curve so the wash builds in
 * front-loaded and settles smoothly.
 *
 * - `reducedMotion` returns `baseAlpha` immediately (no animation).
 * - A non-positive `durationMs` is treated as instant (full alpha).
 * - `elapsedMs` clamps to [0, durationMs], so a fresh fade reads 0 and
 *   an inactive fade (elapsed === +Infinity) reads full alpha.
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
