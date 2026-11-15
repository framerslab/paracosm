import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { writeRunOutput } from '../../src/runtime/io/output-writer.js';
import type { WorldModel } from '../../src/runtime/world-model/index.js';
import type { RunArtifact } from '../../src/engine/schema/index.js';

test('a digital-twin run leaves the runs directory empty', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-twin-output-'));
  const runsDir = join(appDir, 'runs');
  mkdirSync(runsDir);
  const world = {
    scenario: marsScenario,
    intervene: async (opts: { writeOutputFile?: boolean; outputDir?: string }) => {
      const artifact = { metadata: { runId: 'twin-output' }, finalState: { metrics: {} } } as RunArtifact;
      if (opts.writeOutputFile !== false) {
        const outputPath = writeRunOutput(artifact, {
          actorName: 'Evaluator', actorArchetype: 'Evaluator', turns: 1, toolRegs: {}, outputDir: opts.outputDir,
        });
        artifact.scenarioExtensions = { outputPath };
      }
      return artifact;
    },
  } as unknown as WorldModel;
  const server = createMarsServer({
    env: { ...process.env, APP_DIR: appDir, PARACOSM_OUTPUT_DIR: runsDir, PARACOSM_HOSTED_DEMO: '' },
    maxSimsPerDay: 0,
    runHistoryStore: createNoopRunHistoryStore(),
    getDigitalTwinWorld: async () => world,
  });
  try {
    server.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/api/quickstart/simulate-intervention`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: { id: 'sample', name: 'Sample subject' },
        intervention: { id: 'sample-change', name: 'Sample change', description: 'Compare the next step.' },
      }),
    });
    assert.equal(res.status, 200);
    const answer = await res.json() as { artifact: RunArtifact };
    assert.ok(answer.artifact.metadata.runId);
    assert.deepEqual(readdirSync(runsDir), []);
    assert.equal(answer.artifact.scenarioExtensions?.outputPath, undefined);
  } finally {
    if (server.listening) {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
    rmSync(appDir, { recursive: true, force: true });
  }
});
