/**
 * The run artifact files the server reads and writes live under one
 * runs directory: the directory run output is written to
 * (`PARACOSM_OUTPUT_DIR`, else `<cwd>/output`). A run record's
 * `artifactPath` is read only when it resolves inside that directory,
 * links resolved; anything else is refused without being read. That
 * covers a record stored before imports wrote their own copy, when the
 * path came from the imported artifact.
 *
 * @module paracosm/cli/server/run-artifact-file
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { resolveOutputDir } from '../../runtime/io/output-writer.js';

/** The directory run artifact files are written to and read from. */
export function resolveRunsDir(): string {
  return resolveOutputDir();
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Whether a stored artifact path names a file inside the runs
 * directory, by its text alone (no file system access). Links are
 * checked by {@link readRunArtifactFile}.
 */
export function artifactPathInsideRunsDir(artifactPath: string, runsDir: string = resolveRunsDir()): boolean {
  const root = resolve(runsDir);
  return isInside(root, resolve(root, artifactPath));
}

export type RunArtifactFileRead =
  | { ok: true; text: string }
  | { ok: false; reason: 'outside_runs_dir' | 'unreadable' };

/**
 * Read a run record's artifact file. Refuses a path outside the runs
 * directory, by its text or once links are resolved, without reading it.
 */
export async function readRunArtifactFile(
  artifactPath: string,
  runsDir: string = resolveRunsDir(),
): Promise<RunArtifactFileRead> {
  const root = resolve(runsDir);
  const target = resolve(root, artifactPath);
  if (!isInside(root, target)) return { ok: false, reason: 'outside_runs_dir' };
  let realTarget: string;
  let realRoot: string;
  try {
    realTarget = await realpath(target);
    realRoot = await realpath(root);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!isInside(realRoot, realTarget)) return { ok: false, reason: 'outside_runs_dir' };
  try {
    return { ok: true, text: await readFile(realTarget, 'utf-8') };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

/**
 * Write an imported artifact under the runs directory and return the
 * absolute path written. The file name is derived from the run id by
 * hash, so no text from the request reaches the path.
 */
export async function writeImportedRunArtifact(
  runId: string,
  artifact: unknown,
  runsDir: string = resolveRunsDir(),
): Promise<string> {
  const root = resolve(runsDir);
  await mkdir(root, { recursive: true });
  const digest = createHash('sha256').update(runId).digest('hex').slice(0, 32);
  const path = resolve(root, `v3-imported-${digest}.json`);
  await writeFile(path, JSON.stringify(artifact, null, 2));
  return path;
}

/** Remove a file {@link writeImportedRunArtifact} wrote; best effort. */
export async function removeImportedRunArtifact(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Already gone or never written; nothing to undo.
  }
}
