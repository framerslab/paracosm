/**
 * Deterministic JSON serialization with stable key ordering.
 *
 * Used by replay-comparison and any future feature that needs byte-equal
 * output for two equivalent objects regardless of declaration order.
 *
 * Rules:
 *   - Object keys are sorted alphabetically at every nesting level.
 *   - Array order is preserved.
 *   - `undefined` values inside objects are omitted (matches JSON.stringify).
 *   - Circular references throw.
 *   - No special handling for Date / Map / Set: they round-trip through
 *     their default JSON.stringify behavior.
 *
 * @module paracosm/runtime/io/canonical-json
 */

/**
 * Stringify `value` with deterministic key ordering at every level.
 *
 * @param value Any JSON-compatible value.
 * @returns Canonical JSON string.
 * @throws TypeError on circular references.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value, new WeakSet()));
}

function sortDeep(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toJSON();

  if (seen.has(value as object)) {
    throw new TypeError('canonicalJson: circular reference detected');
  }
  seen.add(value as object);

  try {
    if (Array.isArray(value)) {
      return value.map(v => sortDeep(v, seen));
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      out[k] = sortDeep(v, seen);
    }
    return out;
  } finally {
    seen.delete(value as object);
  }
}
