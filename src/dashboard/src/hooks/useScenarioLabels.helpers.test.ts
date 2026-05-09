/**
 * Unit tests for `deriveLabels`, the pure-function core of the
 * `useScenarioLabels` hook. The hook itself is a thin `useMemo`
 * wrapper; testing the derivation logic directly avoids the need for
 * a React renderer + ScenarioContext harness.
 *
 * Covers:
 *  - default (no labels at all) falls back to Mars heritage
 *    (colonists / colony) and time-unit neutral (tick / ticks).
 *  - explicit timeUnitNoun + timeUnitNounPlural populates all four
 *    time variants.
 *  - plural fallback: if timeUnitNounPlural is omitted, `pluralize`
 *    auto-derives (hour -> hours, day -> days).
 *  - capitalization is applied to all four time variants consistently.
 *  - corporate-quarterly style (quarter / quarters) works.
 *  - Mars-style (year / years) works.
 *  - benchmark-arena style (tick / ticks) works.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveLabels, type ScenarioLabelsInput } from './useScenarioLabels.helpers.js';

function mk(labels: ScenarioLabelsInput['labels']): ScenarioLabelsInput {
  return { labels };
}

test('deriveLabels: null scenario falls back to colonists / colony / tick', () => {
  const l = deriveLabels(null);
  assert.equal(l.people, 'colonists');
  assert.equal(l.Place, 'Colony');
  assert.equal(l.time, 'tick');
  assert.equal(l.times, 'ticks');
  assert.equal(l.Time, 'Tick');
  assert.equal(l.Times, 'Ticks');
});

test('deriveLabels: undefined scenario also hits the defaults', () => {
  const l = deriveLabels(undefined);
  assert.equal(l.time, 'tick');
  assert.equal(l.Times, 'Ticks');
});

test('deriveLabels: scenario with no labels object hits the defaults', () => {
  const l = deriveLabels({});
  assert.equal(l.time, 'tick');
  assert.equal(l.Place, 'Colony');
});

test('deriveLabels: corporate-quarterly (quarter / quarters)', () => {
  const l = deriveLabels(mk({
    populationNoun: 'employees',
    settlementNoun: 'company',
    timeUnitNoun: 'quarter',
    timeUnitNounPlural: 'quarters',
  }));
  assert.equal(l.people, 'employees');
  assert.equal(l.Place, 'Company');
  assert.equal(l.time, 'quarter');
  assert.equal(l.times, 'quarters');
  assert.equal(l.Time, 'Quarter');
  assert.equal(l.Times, 'Quarters');
});

test('deriveLabels: Mars heritage (year / years)', () => {
  const l = deriveLabels(mk({
    populationNoun: 'colonists',
    settlementNoun: 'colony',
    timeUnitNoun: 'year',
    timeUnitNounPlural: 'years',
  }));
  assert.equal(l.Time, 'Year');
  assert.equal(l.Times, 'Years');
});

test('deriveLabels: submarine (day / days) derives plural when omitted', () => {
  const l = deriveLabels(mk({
    populationNoun: 'crew',
    settlementNoun: 'habitat',
    timeUnitNoun: 'day',
    // timeUnitNounPlural intentionally omitted; pluralize should handle
  }));
  assert.equal(l.people, 'crew');
  assert.equal(l.place, 'habitat');
  assert.equal(l.time, 'day');
  assert.equal(l.times, 'days');
  assert.equal(l.Time, 'Day');
  assert.equal(l.Times, 'Days');
});

test('deriveLabels: hour falls back to pluralize when plural omitted', () => {
  const l = deriveLabels(mk({ timeUnitNoun: 'hour' }));
  assert.equal(l.time, 'hour');
  assert.equal(l.times, 'hours');
});

test('deriveLabels: timeUnitNounPlural overrides the pluralize fallback', () => {
  const l = deriveLabels(mk({ timeUnitNoun: 'century', timeUnitNounPlural: 'centuries' }));
  assert.equal(l.time, 'century');
  assert.equal(l.times, 'centuries');
  assert.equal(l.Times, 'Centuries');
});

test('deriveLabels: mixed case input is normalized to lowercase singular/plural forms', () => {
  const l = deriveLabels(mk({ timeUnitNoun: 'YEAR', timeUnitNounPlural: 'YEARS' }));
  assert.equal(l.time, 'year');
  assert.equal(l.times, 'years');
  assert.equal(l.Time, 'Year');
  assert.equal(l.Times, 'Years');
});

test('deriveLabels: existing population/settlement behaviour preserved', () => {
  // Regression: ensure the new time-unit fields don't disturb the
  // prior derivation of people/person/place/places variants.
  const l = deriveLabels(mk({ populationNoun: 'citizens', settlementNoun: 'kingdom' }));
  assert.equal(l.people, 'citizens');
  assert.equal(l.person, 'citizen');
  assert.equal(l.People, 'Citizens');
  assert.equal(l.place, 'kingdom');
  assert.equal(l.places, 'kingdoms');
  assert.equal(l.Place, 'Kingdom');
});
