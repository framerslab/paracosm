import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recordReactionMemory, consolidateMemory, updateRelationshipsFromReactions, buildMemoryContext } from '../../src/runtime/agents/agent-memory.js';
import type { Agent } from '../../src/engine/core/state.js';
import type { AgentReaction } from '../../src/runtime/agents/agent-reactions.js';

function makeAgent(id: string, name: string): Agent {
  return {
    core: { id, name, birthTime: 2010, marsborn: false, department: 'engineering' as any, role: 'engineer' },
    health: { alive: true, boneDensityPct: 90, cumulativeRadiationMsv: 100, psychScore: 0.7, conditions: [] },
    career: { specialization: 'Structural', yearsExperience: 5, rank: 'senior', achievements: [] },
    social: { childrenIds: [], friendIds: [], earthContacts: 3 },
    narrative: { lifeEvents: [], featured: false },
    hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
    hexacoHistory: [],
    memory: { shortTerm: [], longTerm: [], stances: {}, relationships: {} },
  };
}

function makeReaction(agentId: string, name: string, mood: AgentReaction['mood'], intensity: number): AgentReaction {
  return {
    agentId, name, age: 35, department: 'engineering', role: 'engineer',
    specialization: 'Structural', marsborn: false,
    quote: 'Test reaction quote.',
    mood, intensity,
    hexaco: { O: 0.5, C: 0.5, E: 0.5, A: 0.5, Em: 0.5, HH: 0.5 },
    psychScore: 0.7, boneDensity: 90, radiation: 100,
  };
}

describe('Agent persistent memory', () => {
  it('recordReactionMemory adds a short-term entry', () => {
    const c = makeAgent('col-alice', 'Alice');
    const r = makeReaction('col-alice', 'Alice', 'anxious', 0.8);
    recordReactionMemory(c, r, 'Dust Storm', 'environmental', 'risky_success', 1, 2035);

    assert.equal(c.memory.shortTerm.length, 1);
    assert.equal(c.memory.shortTerm[0].turn, 1);
    assert.equal(c.memory.shortTerm[0].valence, 'negative');
    assert.ok(c.memory.shortTerm[0].content.includes('Dust Storm'));
  });

  it('recordReactionMemory updates stances', () => {
    const c = makeAgent('col-bob', 'Bob');
    const r = makeReaction('col-bob', 'Bob', 'positive', 0.7);
    recordReactionMemory(c, r, 'Power Surge', 'infrastructure', 'risky_success', 1, 2035);

    assert.ok(c.memory.stances.infrastructure > 0, 'Stance should be positive after success + positive mood');
  });

  it('consolidateMemory moves old entries to long-term', () => {
    const c = makeAgent('col-carol', 'Carol');
    // Fill 20 short-term entries
    for (let i = 0; i < 20; i++) {
      c.memory.shortTerm.push({
        turn: i, time: 2035 + i, content: `Event ${i}`,
        valence: i % 2 === 0 ? 'positive' : 'negative',
        category: 'environmental', salience: 0.3 + (i % 5) * 0.1,
      });
    }

    consolidateMemory(c);

    assert.ok(c.memory.shortTerm.length <= 5, 'Short-term should be trimmed to 5');
    assert.ok(c.memory.longTerm.length > 0, 'Long-term should have entries');
  });

  it('updateRelationshipsFromReactions strengthens shared-mood bonds for all colonists', () => {
    const alice = makeAgent('col-alice', 'Alice');
    const bob = makeAgent('col-bob', 'Bob');
    const reactions: AgentReaction[] = [
      makeReaction('col-alice', 'Alice', 'anxious', 0.9),
      makeReaction('col-bob', 'Bob', 'anxious', 0.8),
    ];

    updateRelationshipsFromReactions([alice, bob], reactions);

    assert.ok((alice.memory.relationships['col-bob'] ?? 0) > 0, 'Alice should bond with Bob over shared anxiety');
    assert.ok((bob.memory.relationships['col-alice'] ?? 0) > 0, 'Bob should bond with Alice');
  });

  it('updateRelationshipsFromReactions creates tension from conflicting intense moods', () => {
    const alice = makeAgent('col-alice', 'Alice');
    const bob = makeAgent('col-bob', 'Bob');
    const reactions: AgentReaction[] = [
      makeReaction('col-alice', 'Alice', 'positive', 0.9),
      makeReaction('col-bob', 'Bob', 'negative', 0.8),
    ];

    updateRelationshipsFromReactions([alice, bob], reactions);

    assert.ok((alice.memory.relationships['col-bob'] ?? 0) < 0, 'Alice should have tension with Bob over conflicting reactions');
  });

  it('buildMemoryContext returns empty string for fresh colonist', () => {
    const c = makeAgent('col-fresh', 'Fresh');
    assert.equal(buildMemoryContext(c), '');
  });

  it('buildMemoryContext includes memories and stances', () => {
    const c = makeAgent('col-experienced', 'Experienced');
    c.memory.shortTerm.push({ turn: 1, time: 2035, content: 'Crisis: survived a storm', valence: 'negative', category: 'environmental', salience: 0.8 });
    c.memory.longTerm.push('Mostly negative experiences with environmental crises.');
    c.memory.stances.environmental = -0.6;

    const ctx = buildMemoryContext(c);
    assert.ok(ctx.includes('survived a storm'), 'Should include recent memory');
    assert.ok(ctx.includes('BELIEFS'), 'Should include beliefs section');
    assert.ok(ctx.includes('environmental'), 'Should include stance');
  });
});
