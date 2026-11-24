/**
 * The shared test server keeps its run files in its own folder. An output
 * folder set in the shell is never where it writes or where its start-up
 * retention sweep removes old run files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withVisitors } from './helpers/run-server.js';

test('a test server leaves an output folder set in the shell untouched', async () => {
  const shellDir = mkdtempSync(join(tmpdir(), 'paracosm-shell-output-'));
  const oldRun = join(shellDir, 'v3-kept-run.json');
  writeFileSync(oldRun, '{}');
  const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  utimesSync(oldRun, longAgo, longAgo);
  const ambient = process.env.PARACOSM_OUTPUT_DIR;
  process.env.PARACOSM_OUTPUT_DIR = shellDir;
  try {
    await withVisitors(async () => {
      assert.ok(existsSync(oldRun), 'the start-up sweep left the shell folder alone');
    });
    assert.ok(existsSync(oldRun), 'the old run file is still there after the server closed');
  } finally {
    if (ambient !== undefined) process.env.PARACOSM_OUTPUT_DIR = ambient;
    else delete process.env.PARACOSM_OUTPUT_DIR;
    rmSync(shellDir, { recursive: true, force: true });
  }
});
