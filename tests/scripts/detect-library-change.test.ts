import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { changesPackage, shipsInPackage } from '../../scripts/detect-library-change.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { files: string[] };
const files = manifest.files;

test('every compiled source directory publishes', () => {
  // The paths the old path list missed: a change to any of them shipped in no version.
  for (const file of [
    'src/index.ts',
    'src/api/types.ts',
    'src/server/server-app.ts',
    'src/llm/generateValidatedObject.ts',
    'src/engine/core/state.ts',
    'src/runtime/swarm/index.ts',
    'src/cli/actors-resolver.ts',
    'src/engine/presets/example.json',
  ]) {
    assert.equal(shipsInPackage(file, files), true, file);
  }
});

test('the dashboard, tests, docs and workflows publish nothing', () => {
  for (const file of [
    'src/dashboard/src/App.tsx',
    'src/dashboard/landing.html',
    'src/dashboard/package.json',
    'src/engine/core/state.test.ts',
    'src/cli/sim-config.test.ts',
    'tests/engine/kernel.test.ts',
    'docs/ARCHITECTURE.md',
    'README.md',
    'CONTRIBUTING.md',
    'scripts/detect-library-change.mjs',
    '.github/workflows/deploy.yml',
    'package-lock.json',
  ]) {
    assert.equal(shipsInPackage(file, files), false, file);
  }
});

test('the build inputs publish', () => {
  for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json']) {
    assert.equal(shipsInPackage(file, files), true, file);
  }
});

test('a path publishes exactly when the files field ships it', () => {
  assert.equal(shipsInPackage('LICENSE', files), true);
  assert.equal(shipsInPackage('scenarios/mars.json', files), true);
  assert.equal(shipsInPackage('config/actors.example.json', files), true);
  // In the repository, not in the files field.
  assert.equal(shipsInPackage('scenarios/submarine.json', files), false);
  // A directory entry covers what is under it, and only that.
  assert.equal(shipsInPackage('assets/logo.png', ['assets/']), true);
  assert.equal(shipsInPackage('assets/logo.png', ['assets']), true);
  assert.equal(shipsInPackage('assets-old/logo.png', ['assets']), false);
});

test('every files entry beside the build output exists in the repository', () => {
  // The files field named config/leaders.json long after the file became
  // config/actors.json, and npm leaves a missing path out of the tarball silently.
  for (const entry of files) {
    if (entry === 'dist/' || entry === 'dist') continue;
    assert.equal(existsSync(resolve(root, entry)), true, `package.json files names ${entry}, which does not exist`);
  }
});

test('changesPackage is true when any changed path ships', () => {
  assert.equal(changesPackage(['README.md', 'src/dashboard/src/App.tsx'], files), false);
  assert.equal(changesPackage(['README.md', 'src/server/server-app.ts'], files), true);
  assert.equal(changesPackage([], files), false);
});

test('the command reads paths from standard input and prints the verdict', () => {
  const run = (input: string) =>
    execFileSync('node', ['scripts/detect-library-change.mjs'], { cwd: root, input, encoding: 'utf8' }).trim();
  assert.equal(run('src/api/types.ts\nREADME.md\n'), 'true');
  assert.equal(run('docs/COOKBOOK.md\n.github/workflows/deploy.yml\n'), 'false');
  assert.equal(run(''), 'false');
});
