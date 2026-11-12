/**
 * Wraps the POST /api/v1/library/import call. One hook for both single
 * + bundle. Caller passes whichever shape; the hook posts the right
 * body. Returns { promoteSingle, promoteBundle, busy, lastResult, error }.
 *
 * A bundle goes in one request when its JSON fits the server's request
 * body limit (5 MiB unless MAX_REQUEST_BODY_BYTES sets another), and
 * otherwise in parts of whole runs, each under the limit, which the
 * server adds to one Library bundle the page names (`addToBundle`). A run
 * saved with snapshots keeps them: no part leaves anything out of a run.
 *
 * @module paracosm/dashboard/studio/useStudioPromote
 */
import * as React from 'react';
import type { RunArtifact } from '../../../../engine/schema/index.js';

export interface PromoteSingleResult {
  kind: 'single';
  runId: string;
  alreadyExisted: boolean;
}

export interface PromoteBundleResult {
  kind: 'bundle';
  bundleId: string;
  runIds: string[];
  alreadyExisted: boolean[];
}

export type PromoteResult = PromoteSingleResult | PromoteBundleResult;

export interface UseStudioPromote {
  promoteSingle: (artifact: RunArtifact) => Promise<PromoteSingleResult | null>;
  promoteBundle: (artifacts: RunArtifact[]) => Promise<PromoteBundleResult | null>;
  busy: boolean;
  lastResult: PromoteResult | null;
  error: string | null;
}

/**
 * The server's request body limit when `MAX_REQUEST_BODY_BYTES` sets
 * none (src/server/server-app.ts). A server that refuses a part states
 * its own limit in the 413 answer, and the parts are made again under it.
 */
export const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 5 * 1024 * 1024;

const IMPORT_URL = '/api/v1/library/import';

const encoder = new TextEncoder();
const utf8Bytes = (text: string): number => encoder.encode(text).length;

/** A part's body around its runs, counted with the longest bundle id the route gives. */
const ENVELOPE_BYTES = utf8Bytes(JSON.stringify({
  addToBundle: 'bundle_00000000-0000-0000-0000-000000000000',
  artifacts: [],
}));

/** One run of the bundle, serialized once. */
interface SizedRun {
  runId: string;
  json: string;
  bytes: number;
}

/** The bytes of a request holding these runs. */
function partBytes(runs: SizedRun[]): number {
  return ENVELOPE_BYTES + runs.reduce((sum, run) => sum + run.bytes, 0) + Math.max(0, runs.length - 1);
}

/** The runs from the start of `runs` that one request under `limit` holds; at least one. */
function nextPart(runs: SizedRun[], limit: number): SizedRun[] {
  let bytes = ENVELOPE_BYTES;
  let count = 0;
  for (const run of runs) {
    const added = run.bytes + (count > 0 ? 1 : 0);
    if (count > 0 && bytes + added > limit) break;
    bytes += added;
    count += 1;
  }
  return runs.slice(0, count);
}

/** The request body for a part: `{ artifacts }`, with the bundle to add the runs to after the first part. */
function partBody(runs: SizedRun[], addToBundle: string | undefined): string {
  const head = addToBundle === undefined
    ? '{"artifacts":['
    : `{"addToBundle":${JSON.stringify(addToBundle)},"artifacts":[`;
  return `${head}${runs.map(run => run.json).join(',')}]}`;
}

/** The limit a 413 answer states: "Request body too large. Maximum N bytes." */
function statedLimit(error: unknown): number | undefined {
  const match = typeof error === 'string' ? /Maximum (\d+) bytes/.exec(error) : null;
  return match ? Number(match[1]) : undefined;
}

/**
 * A new Library bundle id in the form the import route gives: `bundle_`
 * and a random (version 4) UUID. Made from `crypto.getRandomValues`,
 * which a page served from a LAN address has, unlike `randomUUID`.
 */
function newBundleId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `bundle_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const mib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

/** A message as a sentence: with a full stop at its end. */
const sentence = (text: string): string => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** What importing a bundle came to. */
export type BundleImportOutcome =
  | { ok: true; bundleId: string; runIds: string[]; alreadyExisted: boolean[] }
  | {
      ok: false;
      /** The message the Studio shows. */
      error: string;
      /** The Library bundle the runs go in: the one this import named or was given. */
      bundleId: string;
      /** The runs this import put in the Library or found there, in the bundle's order. */
      imported: string[];
      /** The runs after them, which it did not import. */
      notImported: string[];
    };

/**
 * Import a bundle as the Studio sends it. The bundle goes in one request
 * when its JSON fits the limit, else in parts of whole runs in the
 * bundle's order. Every part names the Library bundle in `addToBundle`,
 * the first part included, so a part the server stored but whose reply
 * was lost is in the bundle a later promote adds the rest to. Stops at
 * the first part the server does not take and reports which runs were
 * imported and which were not.
 *
 * A run whose JSON alone passes the default limit is sent with the rest
 * of the bundle in one request until the server states its limit: a
 * server started with a higher `MAX_REQUEST_BODY_BYTES` takes it, and
 * one that refuses it states its limit. A run alone over a stated limit
 * is refused before any request, with nothing imported unless a part
 * before it was.
 *
 * @param artifacts The bundle's runs.
 * @param options.addToBundle A Library bundle an earlier, unfinished
 *   import of this bundle made: the runs are added to it.
 */
export async function importBundle(
  artifacts: RunArtifact[],
  options: { addToBundle?: string } = {},
): Promise<BundleImportOutcome> {
  const runs: SizedRun[] = artifacts.map((artifact) => {
    const json = JSON.stringify(artifact);
    return { runId: artifact.metadata.runId, json, bytes: utf8Bytes(json) };
  });
  const runIds: string[] = [];
  const alreadyExisted: boolean[] = [];
  let bundleId = options.addToBundle ?? newBundleId();
  let next = 0;
  let limit = DEFAULT_REQUEST_BODY_LIMIT_BYTES;
  let limitStated = false;

  const failed = (reason: string): BundleImportOutcome => {
    const notImported = runs.slice(next).map(run => run.runId);
    if (runIds.length === 0) {
      return { ok: false, error: reason, bundleId, imported: [], notImported };
    }
    return {
      ok: false,
      error: `Imported ${runIds.length} of ${runs.length} runs into ${bundleId}: ${runIds.join(', ')}. `
        + `Not imported: ${notImported.join(', ')}. ${sentence(reason)} `
        + 'Promote again to add the rest to the same bundle.',
      bundleId,
      imported: [...runIds],
      notImported,
    };
  };

  while (next < runs.length) {
    const rest = runs.slice(next);
    const overLimit = rest.filter(run => partBytes([run]) > limit);
    if (overLimit.length > 0 && limitStated) {
      const named = overLimit.map(run => `${run.runId} (${mib(run.bytes)})`).join(', ');
      const one = overLimit.length === 1;
      return failed(
        `The server takes at most ${mib(limit)} in one request (MAX_REQUEST_BODY_BYTES), `
        + `and ${one ? 'this run passes' : 'these runs pass'} that on ${one ? 'its' : 'their'} own: ${named}.`
        + (runIds.length === 0 && options.addToBundle === undefined ? ' Nothing was imported.' : ''),
      );
    }
    const part = overLimit.length > 0 ? rest : nextPart(rest, limit);
    let res: Response;
    try {
      res = await fetch(IMPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: partBody(part, bundleId),
      });
    } catch (err) {
      return failed(err instanceof Error ? err.message : String(err));
    }
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      bundleId?: string;
      runIds?: string[];
      alreadyExisted?: boolean[];
      insertedSoFar?: { runIds?: string[]; alreadyExisted?: boolean[] };
    };
    if (res.status === 201 && body.bundleId && body.runIds && body.alreadyExisted) {
      bundleId = body.bundleId;
      runIds.push(...body.runIds);
      alreadyExisted.push(...body.alreadyExisted);
      next += part.length;
      continue;
    }
    if (res.status === 413) {
      const stated = statedLimit(body.error);
      if (stated !== undefined && (!limitStated || stated < limit)) {
        limit = stated;
        limitStated = true;
        continue;
      }
    }
    // A part the store failed on names the runs it inserted before the failure.
    const inserted = body.insertedSoFar?.runIds ?? [];
    if (inserted.length > 0 && body.bundleId) {
      bundleId = body.bundleId;
      runIds.push(...inserted);
      alreadyExisted.push(...(body.insertedSoFar?.alreadyExisted ?? inserted.map(() => false)));
      next += inserted.length;
    }
    return failed(body.error ?? `Promote failed: HTTP ${res.status}`);
  }
  return { ok: true, bundleId, runIds, alreadyExisted };
}

export function useStudioPromote(): UseStudioPromote {
  const [busy, setBusy] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<PromoteResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // A bundle a promote left part way, and the Library bundle its imported
  // runs are in: promoting the same bundle again adds the rest there.
  const unfinished = React.useRef<{ artifacts: RunArtifact[]; bundleId: string } | null>(null);

  const promoteSingle = React.useCallback(async (artifact: RunArtifact): Promise<PromoteSingleResult | null> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(IMPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        setError(body.error ?? `Promote failed: HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { runId: string; alreadyExisted: boolean };
      const result: PromoteSingleResult = { kind: 'single', ...body };
      setLastResult(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const promoteBundle = React.useCallback(async (artifacts: RunArtifact[]): Promise<PromoteBundleResult | null> => {
    setBusy(true);
    setError(null);
    try {
      const addToBundle = unfinished.current?.artifacts === artifacts ? unfinished.current.bundleId : undefined;
      const outcome = await importBundle(artifacts, { addToBundle });
      if (!outcome.ok) {
        unfinished.current = { artifacts, bundleId: outcome.bundleId };
        setError(outcome.error);
        return null;
      }
      unfinished.current = null;
      const result: PromoteBundleResult = {
        kind: 'bundle',
        bundleId: outcome.bundleId,
        runIds: outcome.runIds,
        alreadyExisted: outcome.alreadyExisted,
      };
      setLastResult(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { promoteSingle, promoteBundle, busy, lastResult, error };
}
