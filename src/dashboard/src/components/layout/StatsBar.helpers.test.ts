/**
 * Unit tests for `formatBagTooltip`, the pure helper that renders
 * scenario-declared `statuses` / `environment` bags as multi-line
 * tooltip strings for StatsBar's compact pills. Covers:
 *
 *  - undefined / empty bag returns empty string (so callers can
 *    short-circuit the pill entirely).
 *  - boolean values render as "yes" / "no" (not "true" / "false")
 *    since the bag is user-facing.
 *  - numeric values stringify; string values pass through.
 *  - multiple entries separate by newlines for tooltip line-wrap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { formatBagTooltip } from './StatsBar.helpers.js';

test('formatBagTooltip: undefined -> empty string', () => {
  assert.equal(formatBagTooltip(undefined), '');
});

test('formatBagTooltip: empty object -> empty string', () => {
  assert.equal(formatBagTooltip({}), '');
});

test('formatBagTooltip: boolean true renders as "yes"', () => {
  assert.equal(formatBagTooltip({ publicListed: true }), 'publicListed: yes');
});

test('formatBagTooltip: boolean false renders as "no"', () => {
  assert.equal(formatBagTooltip({ publicListed: false }), 'publicListed: no');
});

test('formatBagTooltip: number values stringify', () => {
  assert.equal(formatBagTooltip({ marketGrowthPct: 12 }), 'marketGrowthPct: 12');
});

test('formatBagTooltip: string values pass through', () => {
  assert.equal(formatBagTooltip({ fundingRound: 'seed' }), 'fundingRound: seed');
});

test('formatBagTooltip: multiple entries join with newlines', () => {
  const out = formatBagTooltip({ fundingRound: 'series-a', publicListed: false, employeeCount: 120 });
  const parts = out.split('\n');
  assert.equal(parts.length, 3);
  assert.ok(parts.includes('fundingRound: series-a'));
  assert.ok(parts.includes('publicListed: no'));
  assert.ok(parts.includes('employeeCount: 120'));
});

test('formatBagTooltip: mixed-type bag round-trips', () => {
  // Regression: ensure a realistic corporate-quarterly statuses bag
  // renders cleanly for the tooltip.
  const bag = {
    fundingRound: 'series-b',
    ipoReady: false,
    runwayMonths: 18,
  };
  const out = formatBagTooltip(bag);
  assert.ok(out.includes('fundingRound: series-b'));
  assert.ok(out.includes('ipoReady: no'));
  assert.ok(out.includes('runwayMonths: 18'));
});
