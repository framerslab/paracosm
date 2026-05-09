import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrajectoryCue } from './trajectory.js';
import type { HexacoProfile, HexacoSnapshot } from '../../../../engine/core/state.js';

const baseline: HexacoProfile = {
  openness: 0.5, conscientiousness: 0.5, extraversion: 0.5,
  agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5,
};

test('buildTrajectoryCue returns empty string when history has no baseline', () => {
  assert.equal(buildTrajectoryCue([], baseline), '');
});

test('buildTrajectoryCue returns empty string when drift below threshold', () => {
  const history: HexacoSnapshot[] = [{ turn: 0, time: 2040, hexaco: baseline }];
  const current = { ...baseline, openness: 0.52 };
  assert.equal(buildTrajectoryCue(history, current), '');
});

test('buildTrajectoryCue fires "measurably" when drift >= 0.05 and < 0.15', () => {
  const history: HexacoSnapshot[] = [{ turn: 0, time: 2040, hexaco: baseline }];
  const current = { ...baseline, openness: 0.58 };
  const cue = buildTrajectoryCue(history, current);
  assert.match(cue, /measurably/);
  assert.match(cue, /toward higher openness/);
  assert.doesNotMatch(cue, /substantially/);
});

test('buildTrajectoryCue fires "substantially" when drift >= 0.15', () => {
  const history: HexacoSnapshot[] = [{ turn: 0, time: 2040, hexaco: baseline }];
  const current = { ...baseline, openness: 0.70 };
  const cue = buildTrajectoryCue(history, current);
  assert.match(cue, /substantially/);
  assert.match(cue, /toward higher openness/);
});

test('buildTrajectoryCue fires "away from" on negative drift', () => {
  const history: HexacoSnapshot[] = [{ turn: 0, time: 2040, hexaco: baseline }];
  const current = { ...baseline, conscientiousness: 0.35 };
  const cue = buildTrajectoryCue(history, current);
  assert.match(cue, /away from higher conscientiousness/);
});

test('buildTrajectoryCue joins multiple drifted traits with "and"', () => {
  const history: HexacoSnapshot[] = [{ turn: 0, time: 2040, hexaco: baseline }];
  const current = { ...baseline, openness: 0.70, conscientiousness: 0.35 };
  const cue = buildTrajectoryCue(history, current);
  assert.match(cue, /openness/);
  assert.match(cue, /conscientiousness/);
  assert.match(cue, / and /);
});

test('buildTrajectoryCue renames honestyHumility to honesty-humility', () => {
  const history: HexacoSnapshot[] = [{ turn: 0, time: 2040, hexaco: baseline }];
  const current = { ...baseline, honestyHumility: 0.70 };
  const cue = buildTrajectoryCue(history, current);
  assert.match(cue, /honesty-humility/);
  assert.doesNotMatch(cue, /honestyHumility/);
});
