import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ECONOMICS_PROFILE_OPTIONS,
  describeServerMode,
} from './economicsProfiles.js';

test('economics profile options stay ordered from cheapest to most expensive', () => {
  assert.deepEqual(
    ECONOMICS_PROFILE_OPTIONS.map(option => option.value),
    ['economy', 'balanced', 'quality', 'deterministic_first'],
  );
});

test('describeServerMode distinguishes local demo from platform API', () => {
  assert.equal(describeServerMode('local_demo').label, 'Local demo');
  assert.equal(describeServerMode('platform_api').label, 'Platform API');
});
