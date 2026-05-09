/**
 * Pure helpers for the Quickstart tab (Tier 5 onboarding).
 *
 * @module paracosm/dashboard/quickstart/helpers
 */
import type { RunArtifact } from '../../../../engine/schema/index.js';
import type { BranchDelta } from '../branches/BranchesTab.helpers.js';

export interface SeedUrlValidation {
  ok: true;
  url: URL;
}
export interface SeedUrlValidationError {
  ok: false;
  error: string;
}

/**
 * Validate a seed URL string: non-empty, reachable-shape URL, http/https
 * only. Trim leading/trailing whitespace before parsing so users can
 * paste URLs with stray spaces.
 */
export function validateSeedUrl(raw: string): SeedUrlValidation | SeedUrlValidationError {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'URL is empty.' };
  if (trimmed.length > 2048) return { ok: false, error: 'URL exceeds 2048 characters.' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Not a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: `Unsupported scheme ${url.protocol}. Use http or https.` };
  }
  return { ok: true, url };
}

export interface SeedTextValidation {
  ok: true;
}
export interface SeedTextValidationError {
  ok: false;
  reason: 'too-short' | 'too-long' | 'empty';
}

/** Validate paste-text seed input: in-range character count, non-empty after trim. */
export function validateSeedText(
  raw: string,
  minChars = 200,
  maxChars = 50_000,
): SeedTextValidation | SeedTextValidationError {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (trimmed.length < minChars) return { ok: false, reason: 'too-short' };
  if (trimmed.length > maxChars) return { ok: false, reason: 'too-long' };
  return { ok: true };
}

/**
 * Compute per-bag deltas between one artifact and the median of its
 * peer group (the other artifacts in the Quickstart trio). Numeric
 * metrics compare against the peer median; non-numeric values compare
 * against whichever peer value differs.
 *
 * @returns Same {@link BranchDelta} shape as Spec 2B's
 *   `computeBranchDeltas`, sorted by absolute magnitude descending
 *   for numerics first.
 */
export function computeMedianDeltas(artifact: RunArtifact, peers: RunArtifact[]): BranchDelta[] {
  const bags: Array<BranchDelta['bag']> = ['metrics', 'capacities', 'statuses', 'environment', 'politics'];
  const artifactFinal = (artifact.finalState as unknown as Record<string, Record<string, number | string | boolean> | undefined> | undefined);
  if (!artifactFinal || peers.length === 0) return [];

  const results: BranchDelta[] = [];
  for (const bag of bags) {
    const mine = artifactFinal[bag];
    if (!mine) continue;
    for (const key of Object.keys(mine)) {
      const mv = mine[key];
      const peerValues = peers
        .map(p => (p.finalState as unknown as Record<string, Record<string, number | string | boolean> | undefined> | undefined)?.[bag]?.[key])
        .filter(v => v !== undefined) as Array<number | string | boolean>;
      if (peerValues.length === 0) continue;
      if (typeof mv === 'number' && peerValues.every(v => typeof v === 'number')) {
        const nums = peerValues as number[];
        const sorted = [...nums].sort((a, b) => a - b);
        const median = sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[(sorted.length - 1) / 2];
        const delta = mv - median;
        if (delta === 0) continue;
        results.push({
          bag, key, parentValue: median, branchValue: mv, delta,
          direction: delta > 0 ? 'up' : 'down',
        });
      } else {
        const distinctOther = peerValues.find(v => v !== mv);
        if (distinctOther === undefined) continue;
        results.push({
          bag, key, parentValue: distinctOther, branchValue: mv,
          direction: 'changed',
        });
      }
    }
  }

  return results.sort((a, b) => {
    if (a.delta !== undefined && b.delta !== undefined) return Math.abs(b.delta) - Math.abs(a.delta);
    if (a.delta !== undefined) return -1;
    if (b.delta !== undefined) return 1;
    return 0;
  });
}

/** Build the shareable replay URL for a completed Quickstart session. */
export function buildQuickstartShareUrl(origin: string, sessionId: string): string {
  const url = new URL('/sim', origin);
  url.searchParams.set('replay', sessionId);
  url.searchParams.set('view', 'quickstart');
  return url.toString();
}

/**
 * Trigger a browser download of a RunArtifact as JSON. Uses a
 * synthetic `<a download>` click; call from a user-gesture handler
 * (browsers require a direct event for Save-As style downloads).
 */
export function downloadArtifactJson(artifact: RunArtifact, filename: string): void {
  const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
