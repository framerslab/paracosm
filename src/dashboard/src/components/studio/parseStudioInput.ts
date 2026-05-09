/**
 * Pure parser for Studio drop-zone input. Text → discriminated union of
 * single artifact, bundle, or error. No I/O, no React. Validation runs
 * via `RunArtifactSchema` from the engine package.
 *
 * @module paracosm/dashboard/studio/parseStudioInput
 */
import { RunArtifactSchema } from '../../../../engine/schema/artifact.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

export type StudioInput =
  | { kind: 'single'; artifact: RunArtifact }
  | { kind: 'bundle'; artifacts: RunArtifact[]; bundleId?: string }
  | { kind: 'error'; message: string; hint?: string };

const MAX_BUNDLE_SIZE = 50;

/**
 * Detect a legacy artifact shape that v0.8 RunArtifactSchema rejects.
 * The 0.7→0.8 rename was internal (types, CLI flags, SQL columns); the
 * on-disk artifact JSON kept the same Zod-validated shape, so a v0.7
 * artifact that validates against `RunArtifactSchema` is fine to
 * render. The only artifacts that need a friendly v0.7 hint are ones
 * shaped like very early paracosm prototypes (pre-RunArtifactSchema)
 * that lack the universal `metadata.scenario` envelope. Rather than
 * hand-crafting that detector, we just let Zod fail and surface a
 * generic error — accurate enough, and the user can read the issue
 * path to see what's missing.
 */
function validateOne(raw: unknown): { ok: true; artifact: RunArtifact } | { ok: false; issues: string[] } {
  const parsed = RunArtifactSchema.safeParse(raw);
  if (parsed.success) {
    // Zod strips non-schema fields by default; downstream renderers
    // read `artifact.leader` and `artifact.cost` which aren't in the
    // schema, so we forward the raw input — schema acts as a gate,
    // not a transformer.
    return { ok: true, artifact: raw as RunArtifact };
  }
  const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`);
  return { ok: false, issues };
}

export function parseStudioInput(text: string): StudioInput {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      kind: 'error',
      message: 'File is not valid JSON',
      hint: err instanceof Error ? err.message : String(err),
    };
  }

  // Bundle as wrapped object: { bundleId, artifacts: [...] }
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    Array.isArray((raw as { artifacts?: unknown }).artifacts)
  ) {
    const wrapper = raw as { bundleId?: string; artifacts: unknown[] };
    return parseBundleArray(wrapper.artifacts, wrapper.bundleId);
  }

  // Bundle as bare array
  if (Array.isArray(raw)) {
    return parseBundleArray(raw, undefined);
  }

  // Single artifact
  const result = validateOne(raw);
  if (!result.ok) {
    return {
      kind: 'error',
      message: `Not a paracosm RunArtifact: ${result.issues[0] ?? 'invalid shape'}`,
      hint: result.issues.slice(1).join('; ') || undefined,
    };
  }
  return { kind: 'single', artifact: result.artifact };
}

function parseBundleArray(items: unknown[], bundleId: string | undefined): StudioInput {
  if (items.length === 0) {
    return { kind: 'error', message: 'Bundle is empty' };
  }
  if (items.length > MAX_BUNDLE_SIZE) {
    return {
      kind: 'error',
      message: `Bundle exceeds the ${MAX_BUNDLE_SIZE}-artifact cap (got ${items.length})`,
    };
  }
  const artifacts: RunArtifact[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const result = validateOne(item);
    if (!result.ok) {
      return {
        kind: 'error',
        message: `Bundle item ${i}: ${result.issues[0] ?? 'invalid shape'}`,
        hint: result.issues.slice(1).join('; ') || undefined,
      };
    }
    artifacts.push(result.artifact);
  }
  const out: StudioInput = { kind: 'bundle', artifacts };
  if (bundleId) out.bundleId = bundleId;
  return out;
}
