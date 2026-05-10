import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveServerMode } from '../../src/server/server-mode.js';
import {
  createRunRecord,
  hashActorConfig,
} from '../../src/server/services/run-record.js';

test('resolveServerMode prefers platform_api when auth env is enabled', () => {
  const mode = resolveServerMode({
    PARACOSM_PLATFORM_API: 'true',
    PARACOSM_HOSTED_DEMO: 'false',
  } as NodeJS.ProcessEnv);
  assert.equal(mode, 'platform_api');
});

test('createRunRecord emits a stable metadata envelope for every run', () => {
  const record = createRunRecord({
    scenarioId: 'mars-genesis',
    scenarioVersion: '0.4.88',
    actorConfigHash: hashActorConfig({ leaders: ['a', 'b'] }),
    economicsProfile: 'balanced',
    sourceMode: 'local_demo',
    createdBy: 'anonymous',
  });

  assert.equal(record.sourceMode, 'local_demo');
  assert.equal(record.createdBy, 'anonymous');
  assert.equal(record.economicsProfile, 'balanced');
  assert.ok(record.runId.startsWith('run_'));
  assert.ok(record.actorConfigHash.startsWith('leaders:'));
});
