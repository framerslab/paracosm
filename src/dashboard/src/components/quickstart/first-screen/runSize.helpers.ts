/**
 * The run's size, the number of leaders a run takes: its bounds, what a
 * typed number becomes, and how the size reads from and writes to the
 * page's address.
 *
 * @module paracosm/dashboard/quickstart/first-screen/runSize.helpers
 */

/** The fewest and the most leaders a run takes (normalizeSimulationConfig refuses under 2 and over 300). */
export const RUN_SIZE_BOUNDS = { min: 2, max: 300 } as const;

/** The pair a run on the host's keys takes. */
export const FREE_SIZE = 2;

export interface SizeBounds {
  min: number;
  max: number;
}

/**
 * What a typed size becomes. A whole number in range is taken. A whole
 * number out of range is refused and goes to the nearest bound. Anything
 * else (a fraction, a word, nothing) is refused and keeps the last good
 * size.
 */
export function clampSize(raw: string, bounds: SizeBounds = RUN_SIZE_BOUNDS, last: number = FREE_SIZE): { value: number; refused: boolean } {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { value: last, refused: true };
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n > bounds.max) return { value: bounds.max, refused: true };
  if (n < bounds.min) return { value: bounds.min, refused: true };
  return { value: n, refused: false };
}

/** A size moved by a step, held inside the bounds. */
export function stepSize(size: number, by: number, bounds: SizeBounds = RUN_SIZE_BOUNDS): number {
  return Math.min(bounds.max, Math.max(bounds.min, size + by));
}

/**
 * The size the address names in ?size=. A value that is not a whole number
 * in range reads as the fallback, with no error.
 */
export function sizeFromSearch(search: string, bounds: SizeBounds = RUN_SIZE_BOUNDS, fallback: number = FREE_SIZE): number {
  const raw = new URLSearchParams(search).get('size');
  if (raw === null) return fallback;
  const { value, refused } = clampSize(raw, bounds, fallback);
  return refused ? fallback : value;
}

/** The address's query with the size written into it. A pair, the size every run starts at, is left out. */
export function searchWithSize(search: string, size: number): string {
  const params = new URLSearchParams(search);
  if (size === FREE_SIZE) params.delete('size');
  else params.set('size', String(size));
  const out = params.toString();
  return out ? `?${out}` : '';
}

/** How the size shows: as the free pair in words, as words while the server has not answered, or as the control. */
export type SizeMode = 'pair' | 'waiting' | 'control';

/**
 * Whether the size is the visitor's to choose. A run on the host's keys is
 * a pair. So is a visitor with no key on a server that has not said, or
 * could not say, whether it is the hosted demo. Otherwise the size is a
 * control, shown once the server's settings and the day's count have both
 * answered, so a control never shows and then goes.
 */
export function sizeMode(o: {
  payer: 'host' | 'own' | 'server';
  adminConfig: 'loading' | 'ready' | 'error';
  rateLimit: 'loading' | 'ready' | 'unlimited' | 'error';
}): SizeMode {
  if (o.payer === 'host') return 'pair';
  if (o.payer === 'server' && o.adminConfig !== 'ready') return 'pair';
  if (o.adminConfig === 'loading' || o.rateLimit === 'loading') return 'waiting';
  return 'control';
}
