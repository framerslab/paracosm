/**
 * The provider keys the dashboard holds in Settings, read as the server
 * reads them.
 *
 * Settings unlocks the provider and the models on the hosted demo when the
 * visitor holds a provider key, and the launch posts that key. A masked
 * value the page kept (`sk-...`) or a blank one is no key to the server
 * (`normalizeCredential`), which runs such a launch on the host's keys, so
 * the page reads it as no key too: the lock stays on and nothing is posted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSessionProviderKey, sessionProviderKeys } from '../../src/dashboard/src/components/settings/sessionProviderKeys.js';
import { hasProviderCredentials } from '../../src/engine/provider/credentials.js';

test('a masked or blank provider key in Settings is no key, as the server reads it', () => {
  for (const value of ['sk-...', 'sk-ab...cd', '   ', '']) {
    const overrides = { openai: value, anthropic: value };
    assert.equal(hasProviderCredentials({ apiKey: value, anthropicKey: value }), false, `the server reads ${JSON.stringify(value)} as no key`);
    assert.equal(hasSessionProviderKey(overrides), false, `Settings stays locked on ${JSON.stringify(value)}`);
    assert.deepEqual(sessionProviderKeys(overrides), {}, `the launch posts no key for ${JSON.stringify(value)}`);
  }
});

test('a real provider key in Settings unlocks it and is posted as the server reads it', () => {
  assert.equal(hasSessionProviderKey({ anthropic: ' sk-ant-real ' }), true);
  assert.deepEqual(sessionProviderKeys({ openai: 'sk-...', anthropic: ' sk-ant-real ' }), { anthropicKey: 'sk-ant-real' });
  assert.deepEqual(sessionProviderKeys({ openai: 'sk-real' }), { apiKey: 'sk-real' });
});
