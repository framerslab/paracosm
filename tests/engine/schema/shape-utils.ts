/**
 * Helpers for the schema breaking-change gate test (T6.2). Produce a
 * stable JSON-friendly serialization of a Zod object schema's shape so
 * a snapshot fixture can be diffed against the live schema.
 *
 * Captures: top-level keys, top-level Zod kind for each value, and one
 * level of inner-object descriptors. Does NOT capture refinements,
 * descriptions, defaults, or validations beyond shape; those are
 * intentionally out of scope so the gate produces minimal false positives.
 *
 * @module tests/engine/schema/shape-utils
 */
import type { z } from 'zod';

export interface ShapeSnapshot {
  schemaVersion: number;
  shape: Record<string, string>;
}

/**
 * Convert a single Zod schema descriptor to a stable string. Recursive
 * but bounded to depth 4 so deeply nested schemas stay readable.
 */
function zodKindToString(schema: z.ZodTypeAny, depth = 0): string {
  if (depth > 4) return 'deep(...)';
  const def = (schema as unknown as { _def: { typeName?: string; type?: string } })._def;
  const kind = (def?.typeName ?? def?.type ?? 'unknown').toString();
  const normalized = kind.replace(/^Zod/, '').toLowerCase();

  // Recurse into common wrappers via canonical inner-type field.
  const innerWrapperFields: Record<string, string[]> = {
    optional: ['innerType'],
    nullable: ['innerType'],
    default: ['innerType'],
    readonly: ['innerType'],
    pipeline: ['in'],
    array: ['type', 'element'],
  };
  if (normalized in innerWrapperFields) {
    for (const field of innerWrapperFields[normalized]) {
      const inner = (def as Record<string, unknown>)[field];
      if (inner && typeof inner === 'object') {
        return `${normalized}(${zodKindToString(inner as z.ZodTypeAny, depth + 1)})`;
      }
    }
    return `${normalized}(?)`;
  }

  if (normalized === 'object') {
    const shape = ((schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape ?? (def as { shape?: Record<string, z.ZodTypeAny> }).shape ?? {}) as Record<string, z.ZodTypeAny>;
    if (depth >= 2) return 'object(...)';
    const childEntries = Object.entries(shape).sort(([a], [b]) => (a < b ? -1 : 1));
    const inner = childEntries.map(([k, v]) => `${k}:${zodKindToString(v, depth + 1)}`).join(';');
    return `object{${inner}}`;
  }

  if (normalized === 'union' || normalized === 'discriminatedunion') {
    const options = ((def as { options?: z.ZodTypeAny[] }).options ?? []) as z.ZodTypeAny[];
    return `${normalized}(${options.map(o => zodKindToString(o, depth + 1)).join('|')})`;
  }

  return normalized;
}

/**
 * Serialize a top-level Zod object schema's shape to a stable
 * snapshot-shaped object. Pass the RUN_ARTIFACT_SCHEMA_VERSION constant
 * for `schemaVersion`.
 */
export function serializeShape(schema: z.ZodObject<z.ZodRawShape>, schemaVersion: number): ShapeSnapshot {
  const shape = ((schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape ?? {}) as Record<string, z.ZodTypeAny>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(shape).sort(([a], [b]) => (a < b ? -1 : 1))) {
    out[k] = zodKindToString(v);
  }
  return { schemaVersion, shape: out };
}

/**
 * Produce a human-readable diff between two shape snapshots. Lists
 * added (`+`), removed (`-`), and changed (`~`) keys with the old and
 * new descriptors inline. Returns empty string when shapes match.
 */
export function describeShapeDiff(
  expected: Record<string, string>,
  actual: Record<string, string>,
): string {
  const expKeys = Object.keys(expected);
  const actKeys = Object.keys(actual);
  const lines: string[] = [];
  const allKeys = [...new Set([...expKeys, ...actKeys])].sort();
  for (const k of allKeys) {
    const inExp = k in expected;
    const inAct = k in actual;
    if (inExp && inAct) {
      if (expected[k] !== actual[k]) {
        lines.push(`  ~ ${k}: ${expected[k]} -> ${actual[k]}`);
      }
    } else if (inExp) {
      lines.push(`  - ${k}: ${expected[k]}`);
    } else {
      lines.push(`  + ${k}: ${actual[k]}`);
    }
  }
  return lines.join('\n');
}
