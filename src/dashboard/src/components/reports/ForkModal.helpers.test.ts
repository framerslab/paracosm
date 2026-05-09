/**
 * Unit tests for ForkModal.helpers (Tier 2 Spec 2B).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveLeaderPresets, estimateForkCost, parseCustomEvents } from './ForkModal.helpers.js';
import { marsScenario } from '../../../../engine/scenarios/index.js';
import type { ActorConfig } from '../../../../engine/types.js';

function fakeCustom(name: string): ActorConfig {
  return {
    name,
    archetype: 'Session',
    unit: 'Session Unit',
    hexaco: {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      emotionality: 0.5,
      honestyHumility: 0.5,
    },
    instructions: '',
  };
}

test('resolveLeaderPresets: Mars scenario exposes at least one well-formed preset leader', () => {
  const presets = resolveLeaderPresets(marsScenario);
  assert.ok(presets.length > 0, 'Mars ships with preset leaders');
  for (const p of presets) {
    assert.ok(p.name && p.archetype, 'leader has name + archetype');
    assert.ok(p.hexaco && typeof p.hexaco.openness === 'number', 'leader has HEXACO profile');
    assert.equal(p.unit, 'Forked Branch', 'unit filled in with fork-branch label');
  }
});

test('resolveLeaderPresets: scenario with no presets and no customs returns []', () => {
  const empty = { ...marsScenario, presets: [] } as typeof marsScenario;
  const presets = resolveLeaderPresets(empty);
  assert.deepEqual(presets, []);
});

test('resolveLeaderPresets: incomplete HEXACO records are normalized with neutral defaults', () => {
  const scenario = {
    ...marsScenario,
    presets: [{
      id: 'partial',
      label: 'Partial',
      leaders: [{
        name: 'Partial Leader',
        archetype: 'Partial',
        hexaco: { openness: 0.9 },
        instructions: '',
      }],
    }],
  } as typeof marsScenario;
  const [leader] = resolveLeaderPresets(scenario);
  assert.equal(leader.hexaco?.openness, 0.9);
  assert.equal(leader.hexaco?.conscientiousness, 0.5);
  assert.equal(leader.hexaco?.honestyHumility, 0.5);
});

test('resolveLeaderPresets: session customs are appended after presets', () => {
  const custom = fakeCustom('Custom Leader');
  const presets = resolveLeaderPresets(marsScenario, [custom]);
  assert.equal(presets[presets.length - 1].name, 'Custom Leader');
});

test('estimateForkCost: 3 turns remaining on OpenAI economy', () => {
  const cost = estimateForkCost(3, 6, 'economy', 'openai');
  assert.match(cost, /^~\$0\.\d{2}$/, `expected "~$0.xx", got ${cost}`);
});

test('estimateForkCost: 6 turns remaining on Anthropic quality rounds up cleanly', () => {
  const cost = estimateForkCost(0, 6, 'quality', 'anthropic');
  assert.match(cost, /^~\$4\.\d{2}$/, `expected ~$4.xx, got ${cost}`);
});

test('estimateForkCost: zero-turn fork at max reports near-zero', () => {
  const cost = estimateForkCost(6, 6, 'quality', 'anthropic');
  assert.equal(cost, '~$0.00');
});

test('parseCustomEvents: valid lines produce structured events', () => {
  const input = '3: Dust storm: A 72-hour storm cuts solar output.\n5: Supply drop: Relief arrives.';
  const events = parseCustomEvents(input);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    turn: 3,
    title: 'Dust storm',
    description: 'A 72-hour storm cuts solar output.',
  });
  assert.equal(events[1].turn, 5);
  assert.equal(events[1].title, 'Supply drop');
});

test('parseCustomEvents: empty, whitespace, and malformed lines are dropped', () => {
  const input = '\n  \nnot a valid line\n: missing turn: x\n4: valid: yes';
  const events = parseCustomEvents(input);
  assert.equal(events.length, 1);
  assert.equal(events[0].turn, 4);
  assert.equal(events[0].title, 'valid');
  assert.equal(events[0].description, 'yes');
});
