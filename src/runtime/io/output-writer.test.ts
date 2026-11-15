/**
 * writeRunOutput writes one file directly in the runs directory, whatever
 * the leader's archetype holds. The archetype gives the file name its tag,
 * so it is reduced to letters, digits and hyphens before it names a file.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { RunArtifact } from '../../engine/schema/index.js';
import { writeRunOutput } from './output-writer.js';

const artifact = {} as RunArtifact;

function withRunsDir(body: (root: string, runsDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'paracosm-output-writer-'));
  const runsDir = join(root, 'runs');
  mkdirSync(runsDir);
  const log = console.log;
  console.log = () => {};
  try {
    body(root, runsDir);
  } finally {
    console.log = log;
    rmSync(root, { recursive: true, force: true });
  }
}

for (const archetype of ['x/../../escape', '/../../escape', '../escape', 'a\\..\\..\\escape', '..']) {
  test(`an archetype of ${JSON.stringify(archetype)} writes one file directly in the runs directory`, () => {
    withRunsDir((root, runsDir) => {
      const path = writeRunOutput(artifact, {
        actorName: 'A',
        actorArchetype: archetype,
        turns: 1,
        toolRegs: {},
        outputDir: runsDir,
      });
      assert.equal(dirname(path), runsDir, `wrote ${path}`);
      assert.match(basename(path), /^v3-[a-z0-9-]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}\.json$/, `the name ${basename(path)} is a run output name`);
      assert.deepEqual(readdirSync(root), ['runs'], 'nothing was written beside the runs directory');
      assert.deepEqual(readdirSync(runsDir), [basename(path)]);
    });
  });
}

test('an ordinary archetype keeps its words in the file name', () => {
  withRunsDir((_root, runsDir) => {
    const path = writeRunOutput(artifact, {
      actorName: 'A',
      actorArchetype: 'The Engineer',
      turns: 1,
      toolRegs: {},
      outputDir: runsDir,
    });
    assert.match(basename(path), /^v3-the-engineer-\d{4}-/);
  });
});

test('two runs written in one millisecond, whose archetypes differ only past the tag\'s 48 characters, keep a file each', () => {
  withRunsDir((_root, runsDir) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 14, 12, 0, 0) });
    try {
      const write = (archetype: string, run: number) => writeRunOutput({ run } as unknown as RunArtifact, {
        actorName: 'A',
        actorArchetype: archetype,
        turns: 1,
        toolRegs: {},
        outputDir: runsDir,
      });
      const first = write(`${'a'.repeat(48)} one`, 1);
      const second = write(`${'a'.repeat(48)} two`, 2);
      assert.notEqual(first, second);
      assert.equal(readdirSync(runsDir).length, 2, readdirSync(runsDir).join(', '));
      assert.deepEqual(JSON.parse(readFileSync(first, 'utf-8')), { run: 1 });
      assert.deepEqual(JSON.parse(readFileSync(second, 'utf-8')), { run: 2 });
    } finally {
      mock.timers.reset();
    }
  });
});
