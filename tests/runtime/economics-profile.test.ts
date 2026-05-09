import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODELS } from '../../src/cli/sim-config.js';
import {
  buildEconomicsEnvelope,
  resolveEconomicsProfile,
} from '../../src/runtime/economics/economics-profile.js';

test('balanced profile preserves the default model mix', () => {
  const profile = resolveEconomicsProfile({
    profileId: 'balanced',
    provider: 'openai',
    baseModels: DEFAULT_MODELS.openai,
  });

  assert.equal(profile.id, 'balanced');
  assert.equal(profile.models.departments, 'gpt-5.4');
  assert.equal(profile.models.commander, 'gpt-4o');
  assert.equal(profile.models.judge, 'gpt-5.4-mini');
  assert.equal(profile.verdict.mode, 'balanced');
  assert.equal(profile.search.mode, 'adaptive');
  // Default cohort batch concurrency. Sized so a 300-actor run lands
  // as ~38 batches of 8 within OpenAI tier-1 RPM. Bumped up from 1
  // alongside runBatchSimulations gaining a real worker pool.
  assert.equal(profile.batch.maxConcurrency, 8);
});

test('economy profile lowers expensive paths and exposes an envelope preview', () => {
  const profile = resolveEconomicsProfile({
    profileId: 'economy',
    provider: 'openai',
    baseModels: DEFAULT_MODELS.openai,
  });

  assert.equal(profile.models.departments, 'gpt-5.4-mini');
  assert.equal(profile.models.commander, 'gpt-5.4-nano');
  assert.equal(profile.verdict.mode, 'cheap');
  assert.equal(profile.search.mode, 'gated');
  // Cheap-model profile rides on the same 8-actor pool as balanced;
  // smaller models tolerate the same concurrency budget without
  // tripping rate limits more aggressively.
  assert.equal(profile.batch.maxConcurrency, 8);

  const envelope = buildEconomicsEnvelope(profile, { turns: 6, population: 30, departments: 3 });
  assert.equal(envelope.profileId, 'economy');
  assert.match(envelope.summary, /cheap verdict/i);
  assert.equal(envelope.estimatedPeakConcurrency, 8);
});
