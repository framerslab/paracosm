import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAvailability } from './aboutStatus.js';

test('describeAvailability keeps available surfaces separate from roadmap surfaces', () => {
  assert.equal(describeAvailability('available_now').group, 'available');
  assert.equal(describeAvailability('local_build').group, 'available');
  assert.equal(describeAvailability('design_partners').group, 'roadmap');
  assert.equal(describeAvailability('future_roadmap').group, 'roadmap');
});

test('describeAvailability keeps limited-access states explicit', () => {
  const earlyAccess = describeAvailability('early_access');

  assert.equal(earlyAccess.label, 'Early access');
  assert.match(earlyAccess.detail, /not generally available/i);
});
