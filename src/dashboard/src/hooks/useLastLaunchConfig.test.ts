/**
 * Tests for the `paracosm:lastLaunchConfig` + `paracosm:keyOverrides`
 * localStorage contracts. Keeps the key strings + payload shape in
 * one file so callers can't drift from each other.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAST_LAUNCH_KEY,
  KEY_OVERRIDES_KEY,
  readLastLaunchConfig,
  writeLastLaunchConfig,
  readKeyOverrides,
  buildNextRunConfig,
  type KeyOverrides,
} from './useLastLaunchConfig.js';

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

test('keys: LAST_LAUNCH_KEY is the canonical localStorage key', () => {
  assert.equal(LAST_LAUNCH_KEY, 'paracosm:lastLaunchConfig');
});

test('keys: KEY_OVERRIDES_KEY is the canonical localStorage key', () => {
  assert.equal(KEY_OVERRIDES_KEY, 'paracosm:keyOverrides');
});

test('readLastLaunchConfig: empty storage -> null', () => {
  assert.equal(readLastLaunchConfig(fakeStorage()), null);
});

test('readLastLaunchConfig: valid payload -> parsed object', () => {
  const storage = fakeStorage({
    'paracosm:lastLaunchConfig': JSON.stringify({ seed: 950, turns: 6 }),
  });
  const cfg = readLastLaunchConfig(storage);
  assert.deepEqual(cfg, { seed: 950, turns: 6 });
});

test('readLastLaunchConfig: malformed JSON -> null', () => {
  const storage = fakeStorage({ 'paracosm:lastLaunchConfig': 'not json' });
  assert.equal(readLastLaunchConfig(storage), null);
});

test('writeLastLaunchConfig: stores JSON', () => {
  const storage = fakeStorage();
  writeLastLaunchConfig(storage, { seed: 42 });
  assert.equal(
    storage.getItem('paracosm:lastLaunchConfig'),
    JSON.stringify({ seed: 42 }),
  );
});

test('readKeyOverrides: empty storage -> empty object', () => {
  assert.deepEqual(readKeyOverrides(fakeStorage()), {});
});

test('readKeyOverrides: valid payload -> parsed', () => {
  const storage = fakeStorage({
    'paracosm:keyOverrides': JSON.stringify({ openai: 'sk-foo', cohere: 'co-bar' }),
  });
  assert.deepEqual(readKeyOverrides(storage), {
    openai: 'sk-foo',
    cohere: 'co-bar',
  });
});

test('readKeyOverrides: malformed -> empty object', () => {
  const storage = fakeStorage({ 'paracosm:keyOverrides': '{' });
  assert.deepEqual(readKeyOverrides(storage), {});
});

// -- buildNextRunConfig ---------------------------------------------------

test('buildNextRunConfig: bumps seed by 1', () => {
  const next = buildNextRunConfig({ seed: 100, turns: 6 }, {});
  assert.equal(next.seed, 101);
});

test('buildNextRunConfig: missing seed defaults to 950 + 1 = 951', () => {
  const next = buildNextRunConfig({ turns: 6 }, {});
  assert.equal(next.seed, 951);
});

test('buildNextRunConfig: threads each key override into the expected API field name', () => {
  const overrides: KeyOverrides = {
    openai: 'sk-o',
    anthropic: 'sk-a',
    serper: 'srp',
    firecrawl: 'fc',
    tavily: 'tv',
    cohere: 'co',
  };
  const next = buildNextRunConfig({ seed: 1 }, overrides);
  assert.equal(next.apiKey, 'sk-o');
  assert.equal(next.anthropicKey, 'sk-a');
  assert.equal(next.serperKey, 'srp');
  assert.equal(next.firecrawlKey, 'fc');
  assert.equal(next.tavilyKey, 'tv');
  assert.equal(next.cohereKey, 'co');
});

test('buildNextRunConfig: preserves other fields unchanged', () => {
  const prev = { seed: 1, turns: 6, scenarioId: 'mars-genesis' };
  const next = buildNextRunConfig(prev, {});
  assert.equal(next.turns, 6);
  assert.equal(next.scenarioId, 'mars-genesis');
});

test('buildNextRunConfig: missing override keys are not added to output', () => {
  const next = buildNextRunConfig({ seed: 1 }, { openai: 'sk-o' });
  assert.equal(next.apiKey, 'sk-o');
  assert.equal('anthropicKey' in next, false);
  assert.equal('serperKey' in next, false);
});
