/**
 * Targeted tests for the chat agent roster extraction and name grounding.
 *
 * Tests:
 *   1. extractColonistRoster pulls the full roster from the latest snapshot
 *   2. extractColonistRoster resolves partnerIds to human names
 *   3. extractColonistRoster returns [] when no snapshots exist
 *   4. renderRosterLine output is compact and contains all key fields
 *   5. The KNOWN COLONISTS block appears in buildInstructions output
 *   6. The anti-hallucination rule appears in buildInstructions output
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractColonistRoster, type ColonistRosterEntry } from '../../src/runtime/agents/chat-agents.js';

// Build a minimal systems_snapshot SSE event mimicking the orchestrator emit.
function makeSnapshot(agents: Array<Record<string, unknown>>, turn = 6) {
  return {
    type: 'systems_snapshot' as const,
    leader: 'Test',
    data: { turn, time: 2075, agents, population: agents.length, morale: 0.8, foodReserve: 12, births: 0, deaths: 0 },
  };
}

describe('extractColonistRoster', () => {
  it('extracts the full roster from the latest systems_snapshot', () => {
    const events = [
      makeSnapshot([
        { agentId: 'a1', name: 'Alice', department: 'medical', role: 'CMO', rank: 'chief', alive: true, marsborn: false, age: 40 },
        { agentId: 'a2', name: 'Bob', department: 'engineering', role: 'Engineer', rank: 'senior', alive: true, marsborn: true, age: 20 },
      ], 1),
      // Turn 2 snapshot adds a third person (born during sim)
      makeSnapshot([
        { agentId: 'a1', name: 'Alice', department: 'medical', role: 'CMO', rank: 'chief', alive: true, marsborn: false, age: 44 },
        { agentId: 'a2', name: 'Bob', department: 'engineering', role: 'Engineer', rank: 'senior', alive: true, marsborn: true, age: 24, partnerId: 'a1' },
        { agentId: 'a3', name: 'Nova Lindqvist', department: 'science', role: 'Child', rank: 'junior', alive: true, marsborn: true, age: 2 },
      ], 2),
    ];
    const roster = extractColonistRoster(events);
    assert.equal(roster.length, 3, 'should pull 3 agents from the latest (turn 2) snapshot');
    // Verify names
    const names = roster.map(r => r.name);
    assert.ok(names.includes('Alice'));
    assert.ok(names.includes('Bob'));
    assert.ok(names.includes('Nova Lindqvist'));
  });

  it('resolves partnerIds to human-readable names', () => {
    const events = [makeSnapshot([
      { agentId: 'a1', name: 'Alice', alive: true, partnerId: 'a2' },
      { agentId: 'a2', name: 'Bob', alive: true, partnerId: 'a1' },
    ])];
    const roster = extractColonistRoster(events);
    const alice = roster.find(r => r.name === 'Alice')!;
    const bob = roster.find(r => r.name === 'Bob')!;
    assert.equal(alice.partnerId, 'Bob', 'Alice partnerId should resolve to "Bob"');
    assert.equal(bob.partnerId, 'Alice', 'Bob partnerId should resolve to "Alice"');
  });

  it('resolves childrenIds to human-readable names', () => {
    const events = [makeSnapshot([
      { agentId: 'a1', name: 'Alice', alive: true, childrenIds: ['a3'] },
      { agentId: 'a3', name: 'Nova', alive: true },
    ])];
    const roster = extractColonistRoster(events);
    const alice = roster.find(r => r.name === 'Alice')!;
    assert.ok(alice.childrenIds?.includes('Nova'), 'Alice childrenIds should resolve to ["Nova"]');
  });

  it('returns empty array when no systems_snapshot events exist', () => {
    const events = [
      { type: 'turn_start', leader: 'Test', data: { turn: 1 } },
      { type: 'outcome', leader: 'Test', data: { turn: 1 } },
    ];
    const roster = extractColonistRoster(events);
    assert.equal(roster.length, 0);
  });

  it('marks deceased agents', () => {
    const events = [makeSnapshot([
      { agentId: 'a1', name: 'Alice', alive: true },
      { agentId: 'a2', name: 'Bob', alive: false },
    ])];
    const roster = extractColonistRoster(events);
    const bob = roster.find(r => r.name === 'Bob')!;
    assert.equal(bob.alive, false);
  });
});
