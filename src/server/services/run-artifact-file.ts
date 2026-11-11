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
import { createHash, randomBytes } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import { mkdir, open, readlink, realpath, stat, unlink, type FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { resolveOutputDir } from '../../runtime/io/output-writer.js';

/**
 * Open flag that makes an open fail when the last path component is a
 * link. Platforms without it (Windows) get 0; the identity check after
 * the open still applies there.
 */
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/**
 * The directory run artifact files are written to and read from, for
 * the given environment (`process.env` by default).
 */
export function resolveRunsDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveOutputDir(env);
}

/**
 * Whether a file name in the runs directory is run output: the run
 * writer's `v3-<tag>-<timestamp>.json` and the import's
 * `v3-imported-<hash>-<suffix>.json`. The retention sweep and the
 * output wipe remove these names only, so other files in the directory
 * stay.
 */
export function isRunOutputFileName(name: string): boolean {
  return name.startsWith('v3-') && name.endsWith('.json');
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

/**
 * The result of {@link readRunArtifactFile}. The run-history routes
 * answer each failure with its own 410:
 *
 * - `outside_runs_dir`: the path resolves outside the runs directory,
 *   by its text or once links are resolved. Nothing was read. The
 *   routes answer `artifact_outside_runs_dir`.
 * - `unreadable`: the path is inside the runs directory but no regular
 *   file could be read there: it is missing, not a regular file, a link
 *   at the last component when opened, changed between the check and
 *   the read, or the read failed. The routes answer
 *   `artifact_unreadable`.
 */
export type RunArtifactFileRead =
  | { ok: true; text: string }
  | { ok: false; reason: 'outside_runs_dir' | 'unreadable' };

const UNREADABLE: RunArtifactFileRead = { ok: false, reason: 'unreadable' };
const OUTSIDE: RunArtifactFileRead = { ok: false, reason: 'outside_runs_dir' };

/** Linux's per-descriptor links; other platforms have no such directory. */
const FD_LINKS_DIR = '/proc/self/fd';
const HAS_FD_LINKS = existsSync(FD_LINKS_DIR);

/**
 * The path the kernel holds for an open descriptor, read from its
 * `/proc/self/fd` link without resolving anything further, or
 * `undefined` where the platform has no such links. A read that fails
 * there throws, so the caller refuses the file.
 */
async function descriptorPath(handle: FileHandle): Promise<string | undefined> {
  if (!HAS_FD_LINKS) return undefined;
  return readlink(`${FD_LINKS_DIR}/${handle.fd}`);
}

/**
 * Read a run record's artifact file. Refuses a path outside the runs
 * directory, by its text or once links are resolved, without reading it.
 *
 * The file is opened once, without following a link at the last
 * component, and read from that descriptor. After the open, the path is
 * resolved again and must still be inside the runs directory and name
 * the same file (device and inode) as the descriptor; otherwise the
 * entry changed between the check and the read and nothing is returned.
 * On Linux the path the kernel holds for the descriptor
 * (`/proc/self/fd/<n>`) must be inside the runs directory as well, which
 * no later swap of a parent directory can change; elsewhere the two
 * path checks above are the guard.
 */
export async function readRunArtifactFile(
  artifactPath: string,
  runsDir: string = resolveRunsDir(),
): Promise<RunArtifactFileRead> {
  const root = resolve(runsDir);
  const target = resolve(root, artifactPath);
  if (!isInside(root, target)) return OUTSIDE;
  let realRoot: string;
  let realTarget: string;
  try {
    realRoot = await realpath(root);
    realTarget = await realpath(target);
  } catch {
    return UNREADABLE;
  }
  if (!isInside(realRoot, realTarget)) return OUTSIDE;

  let handle: FileHandle;
  try {
    handle = await open(realTarget, constants.O_RDONLY | O_NOFOLLOW);
  } catch {
    return UNREADABLE;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) return UNREADABLE;
    let nowPath: string;
    try {
      nowPath = await realpath(realTarget);
    } catch {
      return UNREADABLE;
    }
    if (!isInside(realRoot, nowPath)) return OUTSIDE;
    const now = await stat(nowPath);
    if (now.dev !== opened.dev || now.ino !== opened.ino) return UNREADABLE;
    // The lookups above go by path, so a parent directory swapped between
    // them can point each one at a different file. Where the descriptor's
    // own path can be read, it must be inside the runs directory too.
    const openedPath = await descriptorPath(handle);
    if (openedPath !== undefined && !isInside(realRoot, openedPath)) return OUTSIDE;
    return { ok: true, text: await handle.readFile('utf-8') };
  } catch {
    return UNREADABLE;
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Write an imported artifact under the runs directory and return the
 * absolute path written. The file name is derived from the run id by
 * hash plus a random suffix, so no text from the request reaches the
 * path and every import writes a file of its own. The file is created
 * exclusively: an existing entry at that name, a link included, makes
 * the write fail rather than being followed or truncated. The file is
 * published when the caller stores a record pointing at it.
 */
export async function writeImportedRunArtifact(
  runId: string,
  artifact: unknown,
  runsDir: string = resolveRunsDir(),
): Promise<string> {
  const root = resolve(runsDir);
  await mkdir(root, { recursive: true });
  const digest = createHash('sha256').update(runId).digest('hex').slice(0, 32);
  const suffix = randomBytes(8).toString('hex');
  const path = resolve(root, `v3-imported-${digest}-${suffix}.json`);
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o644);
  try {
    await handle.writeFile(JSON.stringify(artifact, null, 2));
  } catch (err) {
    await handle.close().catch(() => {});
    await removeImportedRunArtifact(path);
    throw err;
  }
  await handle.close();
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
