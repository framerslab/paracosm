import test from 'node:test';
import assert from 'node:assert/strict';

import { StreamEventSchema, STREAM_EVENT_TYPES } from '../../../src/engine/schema/index.js';

// ---------------------------------------------------------------------------
// Minimal valid fixture per event type
// ---------------------------------------------------------------------------

const baseEnvelope = { leader: 'Captain Reyes', turn: 2, time: 2037 };

const validFixtures: Record<string, unknown> = {
  turn_start: { ...baseEnvelope, type: 'turn_start', data: { title: 'Turn 3', summary: 'turn starting' } },
  event_start: {
    ...baseEnvelope,
    type: 'event_start',
    data: { eventIndex: 0, totalEvents: 3, title: 'Dust storm', category: 'environment' },
  },
  specialist_start: {
    ...baseEnvelope,
    type: 'specialist_start',
    data: { department: 'medical', eventIndex: 0 },
  },
  specialist_done: {
    ...baseEnvelope,
    type: 'specialist_done',
    data: {
      department: 'medical',
      eventIndex: 0,
      citations: 2,
      citationList: [{ text: 'NASA', url: 'https://x.example' }],
      risks: ['two crew near limit'],
      forgedTools: [],
    },
  },
  forge_attempt: {
    ...baseEnvelope,
    type: 'forge_attempt',
    data: {
      department: 'medical',
      name: 'radiation_calc',
      approved: true,
      confidence: 0.9,
      inputFields: ['dose', 'duration'],
      outputFields: ['cumulativeMsv'],
      timestamp: '2026-04-22T10:00:00Z',
    },
  },
  decision_pending: {
    ...baseEnvelope,
    type: 'decision_pending',
    data: { eventIndex: 0 },
  },
  decision_made: {
    ...baseEnvelope,
    type: 'decision_made',
    data: {
      decision: 'Reinforce from inside',
      rationale: 'Safer under storm conditions.',
      reasoning: '1. Storm makes exterior unsafe...',
      selectedPolicies: [],
      eventIndex: 0,
    },
  },
  outcome: {
    ...baseEnvelope,
    type: 'outcome',
    data: {
      outcome: 'conservative_success',
      category: 'environment',
      emergent: false,
      systemDeltas: { morale: -0.05, powerKw: -10 },
      eventIndex: 0,
    },
  },
  personality_drift: {
    ...baseEnvelope,
    type: 'personality_drift',
    data: { agents: {}, commander: null },
  },
  agent_reactions: {
    ...baseEnvelope,
    type: 'agent_reactions',
    data: { reactions: [] },
  },
  bulletin: {
    ...baseEnvelope,
    type: 'bulletin',
    data: { posts: [] },
  },
  turn_done: {
    ...baseEnvelope,
    type: 'turn_done',
    data: { metrics: { population: 130, morale: 0.65 }, toolsForged: 2 },
  },
  promotion: {
    ...baseEnvelope,
    type: 'promotion',
    data: { agentId: 'agent-12', department: 'medical', role: 'Chief Medical Officer' },
  },
  systems_snapshot: {
    ...baseEnvelope,
    type: 'systems_snapshot',
    data: { agents: [], population: 130, morale: 0.65, foodReserve: 12, births: 0, deaths: 0 },
  },
  provider_error: {
    ...baseEnvelope,
    type: 'provider_error',
    data: { kind: 'quota', provider: 'anthropic', message: 'quota exceeded' },
  },
  validation_fallback: {
    ...baseEnvelope,
    type: 'validation_fallback',
    data: { site: 'departments', rawTextPreview: '{"dept', error: 'JSON parse error' },
  },
  sim_aborted: {
    ...baseEnvelope,
    type: 'sim_aborted',
    data: { reason: 'user cancelled', completedTurns: 3, metrics: { population: 130 }, toolsForged: 2 },
  },
};

// ---------------------------------------------------------------------------
// Per-variant acceptance
// ---------------------------------------------------------------------------

for (const type of STREAM_EVENT_TYPES) {
  test(`StreamEventSchema accepts valid ${type}`, () => {
    const fixture = validFixtures[type];
    const result = StreamEventSchema.safeParse(fixture);
    assert.equal(
      result.success,
      true,
      result.success ? '' : `${type} failed:\n${JSON.stringify(result.error.issues, null, 2)}`,
    );
  });
}

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

test('StreamEventSchema rejects unknown type', () => {
  const bad = { ...baseEnvelope, type: 'hypergalactic_event', data: {} };
  assert.equal(StreamEventSchema.safeParse(bad).success, false);
});

test('StreamEventSchema rejects missing discriminator', () => {
  const bad = { ...baseEnvelope, data: {} };
  assert.equal(StreamEventSchema.safeParse(bad).success, false);
});

test('StreamEventSchema rejects missing leader', () => {
  const bad = { type: 'turn_done', turn: 0, data: { metrics: {}, toolsForged: 0 } };
  assert.equal(StreamEventSchema.safeParse(bad).success, false);
});

test('StreamEventSchema rejects legacy turn_done metrics-key payloads', () => {
  const bad = {
    ...baseEnvelope,
    type: 'turn_done',
    data: { ['sys' + 'tems']: {}, toolsForged: 0 },
  };
  assert.equal(StreamEventSchema.safeParse(bad).success, false);
});

// ---------------------------------------------------------------------------
// turn + time optional on envelope
// ---------------------------------------------------------------------------

test('StreamEventSchema accepts event without turn or time (pre-turn phase)', () => {
  const envelope = {
    type: 'provider_error',
    leader: 'Captain Reyes',
    data: { kind: 'auth', provider: 'anthropic', message: 'invalid key' },
  };
  assert.equal(StreamEventSchema.safeParse(envelope).success, true);
});

// ---------------------------------------------------------------------------
// All 17 types present in STREAM_EVENT_TYPES
// ---------------------------------------------------------------------------

test('STREAM_EVENT_TYPES has exactly 17 entries matching the spec', () => {
  assert.equal(STREAM_EVENT_TYPES.length, 17);
});

test('an outcome retains its optional recorded bar check through validation', () => {
  const outcome = validFixtures.outcome as { data: Record<string, unknown> };
  const barCheck = {
    boldChance: 62, bar: 81, clearsBar: false, choseBold: true,
    departs: true, departureFact: 'the water reserve was empty', unexplained: false,
  };
  const parsed = StreamEventSchema.parse({ ...outcome, data: { ...outcome.data, barCheck } });
  assert.equal(parsed.type, 'outcome');
  assert.deepEqual(Reflect.get(parsed.data, 'barCheck'), barCheck);
  assert.equal(StreamEventSchema.safeParse({
    ...outcome, data: { ...outcome.data, barCheck: { ...barCheck, departs: 'yes' } },
  }).success, false);
});
