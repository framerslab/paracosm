/**
 * @fileoverview Tests for the session-title module — summarisation,
 * prompt assembly, response cleanup, fallback, and the full
 * generateSessionTitle round-trip with a stubbed LLM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TimestampedEvent } from './stores/session.js';
import {
  summariseForTitle,
  buildTitlePrompt,
  cleanTitle,
  fallbackTitle,
  generateSessionTitle,
} from './session-title.js';

function frame(eventName: string, data: Record<string, unknown>): TimestampedEvent {
  return { ts: 0, sse: `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n` };
}

test('summariseForTitle pulls scenario, actors, turns, crisis, verdict', () => {
  const events: TimestampedEvent[] = [
    frame('active_scenario', { id: 'mars', name: 'Mars Genesis' }),
    frame('status', {
      phase: 'parallel',
      leaders: [
        { name: 'Aria Chen', archetype: 'The Visionary' },
        { name: 'Dietrich Voss', archetype: 'The Engineer' },
      ],
    }),
    frame('sim', {
      type: 'event_start',
      title: 'Landfall',
      category: 'infrastructure',
      leader: 'Aria Chen',
    }),
    frame('sim', {
      type: 'turn_done',
      turn: 1,
      leader: 'Aria Chen',
      deaths: 0,
      metrics: { population: 30, morale: 0.85 },
    }),
    frame('sim', {
      type: 'turn_done',
      turn: 1,
      leader: 'Dietrich Voss',
      deaths: 0,
      metrics: { population: 30, morale: 0.8 },
    }),
    frame('sim', { type: 'forge_attempt', approved: true, leader: 'Aria Chen', name: 't1' }),
    frame('sim', {
      type: 'turn_done',
      turn: 2,
      leader: 'Aria Chen',
      deaths: 1,
      metrics: { population: 29, morale: 0.7 },
    }),
    frame('verdict', { winner: 'Dietrich Voss', headline: "B's steady hand" }),
    frame('complete', {}),
  ];
  const h = summariseForTitle(events);
  assert.equal(h.scenarioName, 'Mars Genesis');
  assert.equal(h.leaderA, 'Aria Chen');
  assert.equal(h.leaderB, 'Dietrich Voss');
  assert.equal(h.archetypeA, 'The Visionary');
  assert.equal(h.archetypeB, 'The Engineer');
  assert.equal(h.turnCount, 2);
  assert.equal(h.winner, 'Dietrich Voss');
  assert.equal(h.headline, "B's steady hand");
  assert.equal(h.firstCrisis, 'Landfall (infrastructure)');
  assert.equal(h.finalPopA, 29);
  assert.equal(h.finalPopB, 30);
  assert.equal(Math.round((h.finalMoraleA ?? 0) * 100), 70);
  assert.equal(h.deathsA, 1);
  // deathsB is 0 in the fixture and is intentionally omitted (zero
  // deaths is the expected happy path — don't clutter the prompt).
  assert.equal(h.deathsB, undefined);
  assert.equal(h.forgedA, 1);
  assert.equal(h.aborted, undefined);
});

test('summariseForTitle marks aborted runs', () => {
  const events: TimestampedEvent[] = [
    frame('active_scenario', { name: 'Test' }),
    frame('sim', { type: 'turn_done', turn: 1 }),
    frame('complete', { aborted: true }),
  ];
  assert.equal(summariseForTitle(events).aborted, true);
});

test('buildTitlePrompt includes every populated field + instruction', () => {
  const prompt = buildTitlePrompt({
    scenarioName: 'Mars',
    leaderA: 'Aria',
    leaderB: 'Voss',
    archetypeA: 'The Visionary',
    archetypeB: 'The Engineer',
    turnCount: 6,
    winner: 'Aria',
    headline: 'Cautious wins',
  });
  assert.ok(prompt.includes('Mars'));
  assert.ok(prompt.includes('Aria (The Visionary)'));
  assert.ok(prompt.includes('Voss (The Engineer)'));
  assert.ok(prompt.includes('Turns completed: 6'));
  assert.ok(prompt.includes('Winner: Aria'));
  assert.ok(prompt.includes('Cautious wins'));
  assert.ok(prompt.includes('3-7 words'));
  assert.ok(prompt.endsWith('Title:'));
});

test('buildTitlePrompt omits missing fields cleanly', () => {
  const prompt = buildTitlePrompt({ scenarioName: 'Mars' });
  assert.ok(prompt.includes('Scenario: Mars'));
  assert.ok(!prompt.includes('Leader A:'));
  assert.ok(!prompt.includes('Turns completed:'));
  assert.ok(!prompt.includes('Winner:'));
});

test('cleanTitle strips preambles, quotes, trailing punctuation', () => {
  assert.equal(cleanTitle('"Aria\'s Cautious Descent"'), "Aria's Cautious Descent");
  assert.equal(cleanTitle('Title: Engineering Wins on Turn 4.'), 'Engineering Wins on Turn 4');
  assert.equal(cleanTitle("Here's the title: Voss Holds the Line!"), 'Voss Holds the Line');
  assert.equal(cleanTitle('# Steady Hand\n\n(additional reasoning)'), 'Steady Hand');
  assert.equal(cleanTitle('   A Title\n'), 'A Title');
});

test('cleanTitle returns empty string for pure whitespace/garbage', () => {
  assert.equal(cleanTitle(''), '');
  assert.equal(cleanTitle('   \n   '), '');
  assert.equal(cleanTitle('"""'), '');
});

test('cleanTitle caps length at 120 chars', () => {
  const t = cleanTitle('x'.repeat(200));
  assert.equal(t.length, 120);
});

test('fallbackTitle composes a deterministic label from highlights', () => {
  assert.equal(
    fallbackTitle({ scenarioName: 'Mars', leaderA: 'Aria', leaderB: 'Voss', turnCount: 6 }),
    'Aria vs Voss · Mars · T6',
  );
  assert.equal(
    fallbackTitle({ scenarioName: 'Mars', turnCount: 3, aborted: true }),
    'Mars · T3 · (unfinished)',
  );
  assert.equal(fallbackTitle({ scenarioName: '' }), 'Simulation Run');
});

test('generateSessionTitle returns cleaned LLM output on success', async () => {
  const stub = async () => ({ text: '"Voss Steadies the Line".' });
  const title = await generateSessionTitle(
    [frame('active_scenario', { name: 'Mars' })],
    'openai',
    stub,
  );
  assert.equal(title, 'Voss Steadies the Line');
});

test('generateSessionTitle returns null when LLM throws', async () => {
  const stub = async () => {
    throw new Error('rate limited');
  };
  const title = await generateSessionTitle([frame('active_scenario', { name: 'Mars' })], 'openai', stub);
  assert.equal(title, null);
});

test('generateSessionTitle returns null for pure-whitespace LLM response', async () => {
  const stub = async () => ({ text: '   \n   ' });
  const title = await generateSessionTitle([frame('active_scenario', { name: 'Mars' })], 'openai', stub);
  assert.equal(title, null);
});

test('generateSessionTitle uses model override when provided', async () => {
  let capturedModel: string | undefined;
  const stub = async (args: { provider: string; model: string; prompt: string }) => {
    capturedModel = args.model;
    return { text: 'Ok' };
  };
  await generateSessionTitle([frame('active_scenario', { name: 'Mars' })], 'openai', stub, 'custom-nano-42');
  assert.equal(capturedModel, 'custom-nano-42');
});

test('generateSessionTitle defaults to provider-specific smallest model', async () => {
  const captured: string[] = [];
  const stub = async (args: { provider: string; model: string; prompt: string }) => {
    captured.push(`${args.provider}:${args.model}`);
    return { text: 'Ok' };
  };
  await generateSessionTitle([frame('active_scenario', { name: 'Mars' })], 'openai', stub);
  await generateSessionTitle([frame('active_scenario', { name: 'Mars' })], 'anthropic', stub);
  assert.equal(captured[0], 'openai:gpt-5.4-nano');
  assert.equal(captured[1], 'anthropic:claude-haiku-4-5-20251001');
});
