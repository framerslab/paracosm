import test from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveRunRegistry } from '../../src/server/live-runs.js';

test('a held run restored after a restart replays result artifacts without outputPath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-held-artifacts-'));
  const result = `event: result\ndata: ${JSON.stringify({
    leader: 'a', artifact: { scenarioExtensions: { outputPath: '/tmp/held-output.json', label: 'kept' } },
  })}\n\n`;
  const complete = 'event: complete\ndata: {}\n\n';
  writeFileSync(join(dir, 'held.json'), JSON.stringify({
    version: 1, key: 'held', visitorId: 'anonymous', kind: 'pair',
    events: [result, complete], timestamps: [Date.now(), Date.now()], actorIds: [null, null],
  }));
  const registry = new LiveRunRegistry({
    dir, maxRuns: 2, maxHeldRuns: 10, maxHeldRunBytes: 100000,
    staleMs: 60000, disconnectGraceMs: 60000, bufferMaxEntries: 100,
  });
  try {
    const run = registry.get('held');
    assert.ok(run);
    const frames: string[] = [];
    registry.replay({ write: (frame: string) => { frames.push(frame); return true; } } as ServerResponse, run, null);
    const data = JSON.parse(frames[0].split('\n')[1].slice(6));
    assert.deepEqual(data.artifact.scenarioExtensions, { label: 'kept' });
    assert.equal(frames[1], complete);
  } finally {
    registry.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
