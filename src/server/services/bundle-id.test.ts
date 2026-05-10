import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBundleId, BUNDLE_ID_REGEX } from './bundle-id.js';

test('generateBundleId produces a kebab uuid v4', () => {
  const id = generateBundleId();
  assert.match(id, BUNDLE_ID_REGEX);
});

test('generateBundleId is unique across rapid calls', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => generateBundleId()));
  assert.equal(ids.size, 1000);
});

test('BUNDLE_ID_REGEX rejects non-uuid strings', () => {
  assert.equal(BUNDLE_ID_REGEX.test('not-a-uuid'), false);
  assert.equal(BUNDLE_ID_REGEX.test('12345'), false);
  assert.equal(BUNDLE_ID_REGEX.test(''), false);
});
