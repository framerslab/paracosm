import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReactionCues } from './translation.js';
import type { HexacoProfile } from '../../../../engine/core/state.js';

const neutral: HexacoProfile = {
  openness: 0.5, conscientiousness: 0.5, extraversion: 0.5,
  agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5,
};

test('buildReactionCues returns empty string for all-neutral HEXACO', () => {
  assert.equal(buildReactionCues(neutral), '');
});

test('buildReactionCues fires high-pole cue above 0.7', () => {
  const cue = buildReactionCues({ ...neutral, emotionality: 0.85 });
  assert.match(cue, /you feel events/);
});

test('buildReactionCues fires low-pole cue below 0.3', () => {
  const cue = buildReactionCues({ ...neutral, emotionality: 0.2 });
  assert.match(cue, /stay flat/);
});

test('buildReactionCues does not fire cue between thresholds', () => {
  const cue = buildReactionCues({ ...neutral, emotionality: 0.5 });
  assert.doesNotMatch(cue, /feel events/);
  assert.doesNotMatch(cue, /stay flat/);
});

test('buildReactionCues caps output at the axis count (6) even when all axes are polarized', () => {
  // Previously capped at 3, which silently dropped half of a heavily-
  // polarized agent's trait voice. Raised to 6 to cover every axis
  // because the per-batch token cost is negligible (~$0.02/run on
  // haiku) against the quality win of full trait expression.
  const allHigh: HexacoProfile = {
    openness: 0.9, conscientiousness: 0.9, extraversion: 0.9,
    agreeableness: 0.9, emotionality: 0.9, honestyHumility: 0.9,
  };
  const cue = buildReactionCues(allHigh);
  const cueCount = cue.split(';').length;
  assert.ok(cueCount <= 6, `expected <= 6 cues, got ${cueCount}: ${cue}`);
  // All six HEXACO traits should be represented on an all-high agent.
  assert.equal(cueCount, 6, 'all-high HEXACO should surface all six trait cues');
});

test('buildReactionCues covers each of the six axes at both poles', () => {
  for (const trait of ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'emotionality', 'honestyHumility'] as const) {
    const high = { ...neutral, [trait]: 0.85 };
    const low = { ...neutral, [trait]: 0.15 };
    assert.notEqual(buildReactionCues(high), '', `${trait} high should fire`);
    assert.notEqual(buildReactionCues(low), '', `${trait} low should fire`);
  }
});
