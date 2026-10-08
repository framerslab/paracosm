import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dirname, '..', '..', 'scripts', 'pack-dashboard.mjs');

/** What Vite writes into the built index.html for a bundle of one script and one stylesheet. */
const BUILT_PAGE = [
  '<link rel="icon" href="/favicon.png" sizes="32x32" />',
  '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
  '<link rel="stylesheet" crossorigin href="/assets/index-abc.css">',
].join('\n');

/**
 * A package tree with a built server, a landing page and a dashboard build
 * holding `page` as its index.html and `assets` under assets/. The script finds
 * the tree from its own location, so a copy of it runs inside the tree.
 */
function makeTree(page: string, assets: string[]): string {
  const tree = mkdtempSync(join(tmpdir(), 'pack-dashboard-'));
  mkdirSync(join(tree, 'scripts'));
  copyFileSync(script, join(tree, 'scripts', 'pack-dashboard.mjs'));
  mkdirSync(join(tree, 'dist', 'server'), { recursive: true });
  writeFileSync(join(tree, 'dist', 'server', 'server-app.js'), '');
  mkdirSync(join(tree, 'src', 'dashboard', 'dist', 'assets'), { recursive: true });
  writeFileSync(join(tree, 'src', 'dashboard', 'landing.html'), '<title>Paracosm</title>');
  writeFileSync(join(tree, 'src', 'dashboard', 'dist', 'index.html'), page);
  for (const asset of assets) writeFileSync(join(tree, 'src', 'dashboard', 'dist', 'assets', asset), '');
  return tree;
}

function pack(tree: string) {
  return spawnSync(process.execPath, [join(tree, 'scripts', 'pack-dashboard.mjs')], { cwd: tree, encoding: 'utf8' });
}

test('packs a dashboard build whose page finds its bundle', () => {
  const tree = makeTree(BUILT_PAGE, ['index-abc.js', 'index-abc.css']);
  try {
    const run = pack(tree);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(existsSync(join(tree, 'dist', 'dashboard', 'dist', 'assets', 'index-abc.js')));
    assert.ok(existsSync(join(tree, 'dist', 'dashboard', 'dist', 'index.html')));
    assert.ok(existsSync(join(tree, 'dist', 'dashboard', 'landing.html')));
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
});

test('stops when the page loads a bundle file the build lacks, as an index.html left from another build does', () => {
  const tree = makeTree(BUILT_PAGE, ['index-abc.css']);
  try {
    const run = pack(tree);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /loads \/assets\/index-abc\.js, which the build lacks/);
    assert.equal(existsSync(join(tree, 'dist', 'dashboard')), false);
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
});

test('stops when the page loads no script bundle', () => {
  const tree = makeTree('<div id="root"></div>', []);
  try {
    const run = pack(tree);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /loads no \/assets\/\*\.js bundle/);
    assert.equal(existsSync(join(tree, 'dist', 'dashboard')), false);
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
});
