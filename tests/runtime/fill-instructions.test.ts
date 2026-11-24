import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTOR_PRESETS } from '../../src/engine/presets/index.js';
import { clipOrderText, fillInstructions, MAX_ORDER_CHARS } from '../../src/engine/presets/fill-instructions.js';
import type { ActorInput } from '../../src/engine/types.js';
import { aiAgentModel } from '../../src/engine/traits/ai-agent.js';
import { traitModelRegistry } from '../../src/engine/traits/index.js';

const mira = Object.freeze({
  name: 'Mira',
  archetype: 'The Surveyor',
  unit: 'North',
  hexaco: Object.freeze({
    emotionality: 0.5, openness: 0.5, honestyHumility: 0.5,
    conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5,
  }),
});
const opening = 'You are Mira, "The Surveyor."';
const closing = 'Your HEXACO profile drives your leadership style.';

test('orders with words retain every character and the original actor', () => {
  const written = { ...mira, instructions: '  Keep both lines.\nWait.  ' };
  assert.strictEqual(fillInstructions(written), written);
  const long = Object.freeze({ ...mira, instructions: '  🌱\n' + 'a'.repeat(394) + '  ' });
  assert.equal(long.instructions.length, 401);
  assert.strictEqual(fillInstructions(long), long);
});

test('missing, empty and whitespace-only orders get a repeatable fill', () => {
  for (const actor of [mira, ...['', '\t', '\n', '\u00a0', ' \t\n'].map(instructions =>
    Object.freeze({ ...mira, instructions }))]) {
    const filled = fillInstructions(actor);
    assert.equal(filled.instructions, opening + ' ' + closing);
    assert.notStrictEqual(filled, actor);
    assert.deepEqual(filled, { ...actor, instructions: opening + ' ' + closing });
    assert.strictEqual(fillInstructions(filled), filled);
  }

  const titled = { ...mira, archetype: 'The Pragmatist', description: 'Check the stores.' };
  assert.equal(fillInstructions(titled).instructions,
    'You are Mira, "The Pragmatist." Check the stores. ' + closing);
  const supplied = { ...mira, instructions: ' \t\n', description: 'Check the stores.' };
  assert.equal(fillInstructions(supplied).instructions, opening + ' Check the stores. ' + closing);
  assert.equal(supplied.instructions, ' \t\n');
  assert.equal(fillInstructions({ ...mira, archetype: '  the pragmatist  ', description: ' \u00a0' }).instructions,
    'You are Mira, "the pragmatist." Leads by protocol and evidence. Safety margins first. ' + closing);
});

const middles: Record<string, string> = {
  visionary: 'Pick a promising experiment. Tell the team what a small trial could teach you and what would make you stop.',
  pragmatist: 'Ask for the evidence behind each proposal. Check the safety margin before you commit people or supplies.',
  innovator: 'When the usual tools fall short, build a new one. Try it on a small part of the problem and record what it changes.',
  stabilizer: 'Protect the capacity the team already relies on. Before replacing a working process, arrange a way back.',
  'crisis-manager': 'When reports disagree under pressure, identify what needs attention first. Assign the next action and set a time to check it.',
  'growth-optimist': 'Look for room to expand. Ask the team to back the opportunity and say which risk you accept to pursue it.',
  'protocol-builder': 'Ask what evidence supports a change. Write down the steps someone else would need to repeat it.',
  'social-architect': 'Hear from the people who will carry out the decision. Bring groups with different priorities to an agreement they can keep.',
  'cost-cutter': 'Find the work that consumes the most capacity for the least return. Redirect its resources and record the effect on morale.',
  'compliance-hawk': 'Check each proposed step against the rules. Record who checked it and report a missed check as soon as you find it.',
};

test('each of the ten presets gives its leader distinct written orders', () => {
  assert.equal(Object.keys(ACTOR_PRESETS).length, 10);
  const actual = new Set<string>();
  for (const p of Object.values(ACTOR_PRESETS)) {
    const start = 'You are ' + p.name + ', "' + p.archetype + '." ';
    assert.ok(p.instructions.trim().length >= 10 && p.instructions.length <= MAX_ORDER_CHARS, p.id);
    assert.ok(p.instructions.startsWith(start), p.id);
    assert.ok(p.instructions.endsWith(closing), p.id);
    const middle = p.instructions.slice(start.length, -(closing.length + 1));
    assert.equal(middle, middles[p.id], p.id);
    actual.add(middle);
  }
  assert.equal(actual.size, 10);
});

test('HEXACO orders speak traits outside the middle band in model order', () => {
  const axes = Object.keys(mira.hexaco) as Array<keyof typeof mira.hexaco>;
  const scores = (score: number) => Object.fromEntries(axes.map(axis => [axis, score])) as ActorInput['hexaco'];
  const low = [
    opening, 'You stay flat when others panic.', 'You stick to what has worked.',
    'You speak strategically, not confessionally.', 'You move first and adjust mid-stride.',
    'You process inward and speak only after.', "You don't owe anyone smoothness right now.", closing,
  ].join(' ');
  const high = [
    opening, 'You feel events in your body before words.', 'You look for what this moment makes possible.',
    'You say what you really think.', 'You want a plan before you move.',
    'You say it out loud rather than sit with it.', 'You want to hold the group together through this.', closing,
  ].join(' ');
  assert.equal(fillInstructions({ ...mira, hexaco: scores(0.1) }).instructions, low);
  assert.equal(fillInstructions({ ...mira, hexaco: scores(0.9) }).instructions, high);
  for (const bound of [0.35, 0.65]) {
    assert.equal(fillInstructions({ ...mira, hexaco: scores(bound) }).instructions, opening + ' ' + closing);
  }
  const hexaco = { ...mira.hexaco, emotionality: 0.1, openness: 0.9 };
  const reversed = Object.fromEntries(Object.entries(hexaco).reverse()) as typeof hexaco;
  const expected = opening + ' You stay flat when others panic. You look for what this moment makes possible. ' + closing;
  assert.equal(fillInstructions({ ...mira, hexaco }).instructions, expected);
  assert.equal(fillInstructions({ ...mira, hexaco: reversed }).instructions, expected);
});

test('an explicit alternate trait model takes precedence over legacy scores', () => {
  const actor = {
    ...mira,
    hexaco: { ...mira.hexaco, emotionality: 0.1, openness: 0.9 },
    traitProfile: { modelId: 'ai-agent', traits: { 'verification-rigor': 0.9, exploration: 0.5 } },
  };
  const expected = opening + ' You double-check every claim and run the tests. Your trait profile drives your leadership style.';
  assert.equal(fillInstructions(actor).instructions, expected);
  assert.equal(fillInstructions({
    ...actor, traitProfile: { modelId: 'ai-agent', traits: { exploration: 0.5, 'verification-rigor': 0.9 } },
  }).instructions, expected);
});

test('the UTF-16 budget preserves punctuation, temperament and a speaking cue', () => {
  assert.equal(MAX_ORDER_CHARS, 400);
  const full = 'x'.repeat(400);
  assert.equal(clipOrderText(full), full);
  assert.equal(clipOrderText('a'.repeat(399) + '🌱x').length, 399);

  traitModelRegistry.register({
    ...aiAgentModel,
    id: 'long-order-cue',
    cues: { 'verification-rigor': { high: 'you check ' + 'x'.repeat(500), low: 'you skip checks' } },
  });
  const fill = fillInstructions({
    ...mira,
    name: 'N'.repeat(120),
    archetype: 'T'.repeat(100),
    description: 'Check the stores before allocating more supplies. '.repeat(10),
    traitProfile: { modelId: 'long-order-cue', traits: { 'verification-rigor': 0.9 } },
  }).instructions;
  assert.equal(fill.length, 400);
  assert.ok(fill.startsWith('You are ' + 'N'.repeat(80) + ', "' + 'T'.repeat(60) + '." Check the stores'));
  assert.ok(fill.includes(' You check '));
  assert.ok(fill.endsWith('. Your trait profile drives your leadership style.'));
});
