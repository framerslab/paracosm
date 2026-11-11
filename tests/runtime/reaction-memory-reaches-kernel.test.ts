/**
 * A colonist's reaction reaches their memory in the kernel's state (#241).
 *
 * After each turn's reactions, the reaction step writes each quote into the
 * person's short-term memory, moves their stance on the event's category and
 * their relationships with the others who reacted, and consolidates their
 * memory. On 0.9.1095 every one of those writes landed on a copy of the
 * state (`SimulationKernel.getState()` returns a clone), so the live Mars
 * pair of 10 November 2026 saved 12 kernel snapshots with no person holding
 * a memory entry or a relationship, and the next turn's reaction prompts
 * carried no memory of the last.
 *
 * These tests run the real reaction step over the Mars Genesis scenario's
 * kernel (scenarios/mars.json: seed 950, 30 people, a turn every eight years
 * from 2035), with the provider call replaced by a stub reply: every second
 * person on the roster reacts hopeful at 0.9 and the rest anxious at 0.8,
 * to an event the colony handled with a conservative success. No model call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { SimulationState } from '../../src/engine/core/state.js';
import { runReactionStep } from '../../src/runtime/orchestrator/reaction-step.js';

const hook = marsScenario.hooks.progressionHook;
/** Mars turns: the landing in 2035, then a turn every eight years. */
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];
const TITLE = 'Dust storm';
const CATEGORY = 'environmental';

function marsKernel(): SimulationKernel {
  return new SimulationKernel(950, 'Leader', [], { startTime: 2035, initialPopulation: 30, scenario: marsScenario });
}

/** The stub reply for one batch: each person the prompt names, hopeful or anxious by their place on the first roster. */
function stubModel(roster: string[]) {
  const prompts: string[] = [];
  const impl = (async (req: { prompt: string }) => {
    prompts.push(req.prompt);
    const ids = [...req.prompt.matchAll(/^AGENT id=(\S+)$/gm)].map(m => m[1]);
    const reactions = ids.map(id => {
      const hopeful = roster.indexOf(id) % 2 === 0;
      return {
        agentId: id,
        quote: `${id} says the storm walls held.`,
        mood: hopeful ? 'hopeful' : 'anxious',
        intensity: hopeful ? 0.9 : 0.8,
      };
    });
    const object = { reactions };
    return { object, text: JSON.stringify(object), usage: {} };
  }) as any;
  return { prompts, impl };
}

/** Run the real reaction step for one Mars turn, every living person reacting. */
async function react(kernel: SimulationKernel, turn: number, time: number, impl: unknown, event: { title?: string; category?: string } = {}) {
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const result = await runReactionStep({
    kernel,
    scenario: marsScenario,
    turn, time, seed: 950,
    turnEvents: [{ relevantDepartments: [] }],
    turnEventTitles: [event.title ?? TITLE],
    lastEventCategory: event.category ?? CATEGORY,
    lastOutcome: 'conservative_success',
    provider: 'openai',
    apiKey: 'placeholder-key-for-a-test',
    modelConfig: {} as any,
    execution: { progressiveReactions: false },
    trackUsage: () => {},
    reportProviderError: () => {},
    emit: (type, data) => { events.push({ type, data }); },
    generateObjectImpl: impl as any,
  });
  return { ...result, events };
}

const person = (state: SimulationState, id: string) => {
  const found = state.agents.find(a => a.core.id === id);
  assert.ok(found, `${id} is on the roster`);
  return found;
};

test('after a turn with reactions the kernel holds each reactor\'s memory, stance and relationships, and the snapshot and a fork from it hold them', async () => {
  const kernel = marsKernel();
  const roster = kernel.getState().agents.map(a => a.core.id);
  const model = stubModel(roster);
  kernel.advanceTurn(1, 2035, hook);
  const alive = kernel.getState().agents.filter(a => a.health.alive).map(a => a.core.id);

  const { reactions } = await react(kernel, 1, 2035, model.impl);
  assert.equal(reactions.length, alive.length, 'the stub reply reached the reaction step');

  const [hopefulA, anxious, hopefulB] = [roster[0], roster[1], roster[2]];
  const check = (state: SimulationState, where: string) => {
    const a = person(state, hopefulA);
    assert.deepEqual(
      a.memory.shortTerm.map(e => ({ turn: e.turn, time: e.time, content: e.content, valence: e.valence, category: e.category, salience: e.salience })),
      [{ turn: 1, time: 2035, content: `Event "${TITLE}": ${hopefulA} says the storm walls held.`, valence: 'positive', category: CATEGORY, salience: 0.9 }],
      `${where}: ${hopefulA}'s reaction is in their short-term memory`,
    );
    // A success with a hopeful mood moves the stance 0.1 + 0.05; an anxious one 0.1 - 0.05.
    const near = (got: number | undefined, want: number, what: string) => assert.ok(got !== undefined && Math.abs(got - want) < 1e-9, `${what}: ${got}, not ${want}`);
    near(a.memory.stances[CATEGORY], 0.15, `${where}: ${hopefulA}'s stance on ${CATEGORY}`);
    near(person(state, anxious).memory.stances[CATEGORY], 0.05, `${where}: ${anxious}'s stance on ${CATEGORY}`);
    // Two intense reactions in the same mood bring the two closer by 0.1.
    assert.equal(a.memory.relationships[hopefulB], 0.1, `${where}: ${hopefulA} and ${hopefulB} reacted alike`);
    assert.equal(person(state, hopefulB).memory.relationships[hopefulA], 0.1, `${where}: ${hopefulB} and ${hopefulA} reacted alike`);
  };

  check(kernel.getState(), 'the kernel');

  const snapshot = JSON.parse(JSON.stringify(kernel.toSnapshot(marsScenario.id)));
  check(snapshot.state, 'the turn\'s snapshot');

  const fork = SimulationKernel.fromSnapshot(snapshot, marsScenario.id, marsScenario);
  check(fork.getState(), 'a fork from the snapshot');
  fork.advanceTurn(2, 2043, hook);
  assert.equal(
    person(fork.getState(), hopefulA).memory.shortTerm[0]?.content,
    `Event "${TITLE}": ${hopefulA} says the storm walls held.`,
    'the fork\'s next turn keeps the memory',
  );
});

test('the next turn\'s reaction prompt and its agent_reactions event carry the memory of the last', async () => {
  const kernel = marsKernel();
  const roster = kernel.getState().agents.map(a => a.core.id);
  const model = stubModel(roster);
  kernel.advanceTurn(1, 2035, hook);
  await react(kernel, 1, 2035, model.impl);

  kernel.advanceTurn(2, 2043, hook);
  const turnOnePrompts = model.prompts.length;
  const { events } = await react(kernel, 2, 2043, model.impl);
  const turnTwoPrompts = model.prompts.slice(turnOnePrompts).join('\n');
  const first = roster.find(id => person(kernel.getState(), id).health.alive)!;
  assert.ok(
    turnTwoPrompts.includes(`Recent memory: Event "${TITLE}": ${first}`),
    `turn 2's reaction prompt recalls ${first}'s turn 1 reaction`,
  );

  const shown = events.find(e => e.type === 'agent_reactions')?.data?.reactions as Array<{ memory: { recentMemories: Array<{ time: number }>; stances: unknown[] } | null }>;
  assert.ok(shown?.length, 'the turn emitted its reactions');
  for (const r of shown) {
    assert.ok(r.memory, 'each shown reaction carries a memory block');
    assert.ok(r.memory.recentMemories.some(m => m.time === 2035), 'the memory block holds the turn 1 reaction');
  }
});

test('a snapshot saved before reactions reached the kernel loads, and the reaction step writes into it', async () => {
  const before = marsKernel();
  before.advanceTurn(1, 2035, hook);
  const saved = JSON.parse(JSON.stringify(before.toSnapshot(marsScenario.id)));
  // The oldest saved runs carry a person with no memory object at all.
  const bare = saved.state.agents[0].core.id as string;
  delete saved.state.agents[0].memory;

  const kernel = SimulationKernel.fromSnapshot(saved, marsScenario.id, marsScenario);
  const roster = kernel.getState().agents.map(a => a.core.id);
  await react(kernel, 1, 2035, stubModel(roster).impl);
  assert.deepEqual(
    person(kernel.getState(), bare).memory?.shortTerm.map(e => e.content),
    [`Event "${TITLE}": ${bare} says the storm walls held.`],
  );
});

test('a run whose people react rolls the same dice as one where nobody reacts: the same deaths, births, metrics and health', async () => {
  const quiet = marsKernel();
  const loud = marsKernel();
  const model = stubModel(loud.getState().agents.map(a => a.core.id));
  for (const [turn, time] of TURNS) {
    quiet.advanceTurn(turn, time, hook);
    loud.advanceTurn(turn, time, hook);
    await react(loud, turn, time, model.impl);
  }
  const q = quiet.getState();
  const l = loud.getState();
  const records = (s: SimulationState) => s.eventLog.filter(e => e.type === 'death' || e.type === 'birth');
  assert.ok(records(q).some(e => e.type === 'death'), 'someone dies in six Mars turns at seed 950');
  assert.deepEqual(records(l), records(q), 'the death and birth records');
  assert.deepEqual(l.metrics, q.metrics);
  assert.deepEqual(l.agents.map(a => [a.core.id, a.health]), q.agents.map(a => [a.core.id, a.health]));
  assert.deepEqual(loud.toSnapshot(marsScenario.id).rngState, quiet.toSnapshot(marsScenario.id).rngState, 'the reactions drew no kernel dice');
});

/** A turn a year from 2035: sixteen reactions take a person's short-term memory past its fifteen entries. */
const YEARLY = Array.from({ length: 17 }, (_, i): [number, number] => [i + 1, 2035 + i]);

test('a person who has reacted sixteen times keeps their newest memories oldest first, and the event and the next prompt show the latest', async () => {
  const kernel = marsKernel();
  const roster = kernel.getState().agents.map(a => a.core.id);
  const model = stubModel(roster);
  let shown: Array<{ agentId: string; memory: { recentMemories: Array<{ time: number }> } | null }> = [];
  for (const [turn, time] of YEARLY.slice(0, 16)) {
    kernel.advanceTurn(turn, time, hook);
    const { events } = await react(kernel, turn, time, model.impl, { title: `Dust storm ${turn}` });
    shown = events.find(e => e.type === 'agent_reactions')?.data?.reactions as typeof shown;
  }
  const survivor = roster.find(id => person(kernel.getState(), id).health.alive);
  assert.ok(survivor, 'someone on the roster lives through sixteen Mars years');

  // The sixteenth reaction made sixteen entries, and the step consolidated them.
  const turns = person(kernel.getState(), survivor).memory.shortTerm.map(e => e.turn);
  assert.ok(turns.length < 16, `the step consolidated ${survivor}'s short-term memory: turns ${turns.join(', ')}`);
  assert.deepEqual(turns, [...turns].sort((a, b) => a - b), `${survivor}'s short-term memory runs oldest to newest`);
  assert.equal(turns.at(-1), 16, `${survivor}'s newest entry is turn 16's reaction`);

  assert.ok(shown?.length, 'turn 16 emitted its reactions');
  for (const r of shown) {
    assert.ok(r.memory?.recentMemories.some(m => m.time === 2050), `${r.agentId}'s shown memory holds turn 16's reaction`);
  }

  const [turn, time] = YEARLY[16];
  kernel.advanceTurn(turn, time, hook);
  const before = model.prompts.length;
  await react(kernel, turn, time, model.impl, { title: `Dust storm ${turn}` });
  assert.ok(
    model.prompts.slice(before).join('\n').includes(`Event "Dust storm 16": ${survivor} says the storm walls held.`),
    `turn 17's reaction prompt recalls ${survivor}'s turn 16 reaction`,
  );
});

test('an event category named like a property every object inherits (constructor) keeps its stance, and the step that consolidates memory still runs', async () => {
  const kernel = marsKernel();
  const roster = kernel.getState().agents.map(a => a.core.id);
  const model = stubModel(roster);
  const first = roster[0];
  let stanceAfterTurnOne: unknown;
  for (const [turn, time] of YEARLY.slice(0, 16)) {
    kernel.advanceTurn(turn, time, hook);
    await react(kernel, turn, time, model.impl, { category: 'constructor' });
    if (turn === 1) {
      const stances = person(kernel.getState(), first).memory.stances;
      stanceAfterTurnOne = Object.hasOwn(stances, 'constructor') ? stances.constructor : 'none';
    }
  }
  // A success with a hopeful mood moves the stance 0.1 + 0.05.
  assert.ok(typeof stanceAfterTurnOne === 'number' && Math.abs(stanceAfterTurnOne - 0.15) < 1e-9, `${first}'s stance on constructor after turn 1: ${String(stanceAfterTurnOne)}`);
  const survivor = roster.find(id => person(kernel.getState(), id).health.alive)!;
  const memory = person(kernel.getState(), survivor).memory;
  assert.ok(memory.shortTerm.length < 16, 'the step consolidated short-term memory');
  assert.ok(memory.longTerm.some(belief => belief.includes('constructor crises')), `${survivor} holds a belief about the category: ${memory.longTerm.join(' | ')}`);
});
