#!/usr/bin/env node
/**
 * Decides whether a commit changes what the npm package ships, so the
 * publish job can skip a commit that only touches the docs, the tests or
 * the workflows.
 *
 * The package ships four kinds of file:
 *   1. `dist/`, which `tsc -p tsconfig.build.json` compiles from the
 *      source under `src/`, the dashboard and the test files excluded;
 *   2. `dist/dashboard/`, the dashboard's Vite build and landing page,
 *      which `scripts/pack-dashboard.mjs` copies from `src/dashboard/`
 *      when the package is packed;
 *   3. the paths the `files` field of `package.json` names beside
 *      `dist/`: scenarios, the actor configuration, the landing page's
 *      assets, the license;
 *   4. `package.json` itself.
 * A change to a `tsconfig` build file changes the first kind, and any
 * change under `src/` other than a test changes the first or the second.
 *
 * The README is in the tarball too, and a change to it alone publishes
 * nothing: a version that differs only in its README is noise.
 *
 * Usage: git diff --name-only HEAD~1 HEAD | node scripts/detect-library-change.mjs
 * Prints `true` or `false`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Files outside `src/` whose change alters the built package. */
const BUILD_INPUTS = new Set(['package.json', 'tsconfig.json', 'tsconfig.build.json']);

/** `files` entries that are in the tarball and decide no publish here. */
const IGNORED_FILES_ENTRIES = new Set(['dist', 'dist/', 'README.md']);

const TEST_FILE = /\.test\.tsx?$/;

/**
 * @param {string} file A path relative to the repository root.
 * @param {string[]} shippedPaths The `files` field of `package.json`.
 * @returns {boolean} True when a change to `file` changes the published package.
 */
export function shipsInPackage(file, shippedPaths) {
  if (BUILD_INPUTS.has(file)) return true;
  if (file.startsWith('src/')) {
    return !TEST_FILE.test(file);
  }
  return shippedPaths.some((entry) => {
    if (IGNORED_FILES_ENTRIES.has(entry)) return false;
    const directory = entry.endsWith('/') ? entry : `${entry}/`;
    return file === entry || file.startsWith(directory);
  });
}

/**
 * @param {string[]} changedFiles The paths a commit changed.
 * @param {string[]} shippedPaths The `files` field of `package.json`.
 * @returns {boolean} True when at least one changed path ships in the package.
 */
export function changesPackage(changedFiles, shippedPaths) {
  return changedFiles.some((file) => shipsInPackage(file, shippedPaths));
}

/** Reads changed paths from standard input, one per line, and prints the verdict. */
export function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const shippedPaths = Array.isArray(manifest.files) ? manifest.files : [];
  const changedFiles = readFileSync(0, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  process.stdout.write(`${changesPackage(changedFiles, shippedPaths)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
