/**
 * A person's chat is told the leader they lived under and the turns the
 * run had, each with its year.
 *
 * On the hosted demo (#213), Bruno Morales was asked under each leader of a
 * Mars Genesis pair of 6 turns "Who is your commander, and what went wrong
 * in your last two years?". Under both leaders he named Erik Lindqvist, a
 * person of the roster, and he spoke of Turn 15, 18 and 19. His agent was
 * never given the leader's name: the decisions in its memories read "The
 * commander decided", and the roster it was told is complete holds every
 * person but the commander. Nor was it given the run's turns, the year of
 * each, or the year the run ended; the department reports, decisions and
 * outcomes in its memories carried a turn and no year, and the prompt's
 * example citation read "Turn 3, Year 3".
 *
 * The events are those of a Mars Genesis pair the hosted demo saved on
 * 11 November 2026 (tests/fixtures/mars-pair-chat-2026-11-11.json), sent
 * through the dashboard server's /chat route with a stub agent factory, so
 * no model is called. What the agent is told is built by the function the
 * real factory calls, from the arguments the route passed it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mars, settingsBody, waitFor, withVisitors } from './helpers/run-server.js';
import {
  buildChatAgentInstructions,
  type ChatAgentOptions,
  type ColonistMemoryEntry,
  type ColonistProfile,
} from '../../src/runtime/agents/chat-agents.js';

interface SimEvent { type: string; leader: string; data: Record<string, unknown> }

const pair = JSON.parse(
  readFileSync(new URL('../fixtures/mars-pair-chat-2026-11-11.json', import.meta.url), 'utf-8'),
) as { events: SimEvent[] };

const LEADERS = ['Aria Chen', 'Dietrich Voss'];
/** The Chief Engineer, who reacted under both leaders. */
const PERSON = 'col-bruno-morales';
const QUESTION = 'Who is your commander, and what went wrong in your last two years?';

/** Each turn one leader's run played, with its year, read from its turn_start events. */
function yearsOfTurns(leader: string): Map<number, number> {
  const years = new Map<number, number>();
  for (const e of pair.events) {
    if (e.leader === leader && e.type === 'turn_start') years.set(Number(e.data.turn), Number(e.data.time));
  }
  return years;
}

interface AgentCall { profile: ColonistProfile; memories: ColonistMemoryEntry[]; opts: ChatAgentOptions }

/** What the route gave Bruno Morales's agent under each leader, asked once per leader. */
async function agentsGiven(): Promise<Map<string, AgentCall>> {
  const calls: AgentCall[] = [];
  const given = new Map<string, AgentCall>();
  await withVisitors(async ({ cookied }) => {
    const v = cookied();
    assert.equal((await v.post('/setup', settingsBody(mars))).status, 200);
    await waitFor(async () => (await v.json<{ isComplete: boolean }>('/results')).isComplete, 'the run to finish', 10_000);
    for (const leader of LEADERS) {
      const res = await v.post('/chat', { agentId: PERSON, leader, message: QUESTION });
      assert.equal(res.status, 200, `chat under ${leader}: ${res.status} ${await res.clone().text()}`);
      given.set(leader, calls[calls.length - 1]);
    }
  }, {
    runner: async (_config, broadcast) => {
      for (const e of pair.events) broadcast('sim', e, e.leader);
      broadcast('complete', {});
    },
    extra: {
      chatAgent: async (profile: ColonistProfile, memories: ColonistMemoryEntry[], opts: ChatAgentOptions) => {
        calls.push({ profile, memories, opts });
        return { session: { send: async () => ({ text: 'Stub reply.', usage: {} }) }, isNew: true };
      },
    },
  });
  return given;
}

let asked: Promise<Map<string, AgentCall>> | undefined;
const given = () => (asked ??= agentsGiven());

test('under each leader, his agent is told that leader was his commander', async () => {
  const calls = await given();
  for (const leader of LEADERS) {
    const other = LEADERS.find(l => l !== leader)!;
    const call = calls.get(leader)!;
    assert.equal(call.profile.name, 'Bruno Morales');
    assert.equal(call.opts.leader, leader);
    const told = buildChatAgentInstructions(call.profile, call.opts);
    assert.match(told, new RegExp(`\\bcommander\\b[^.]*\\b${leader}\\b`), `under ${leader}, he is told ${leader} was his commander`);
    assert.ok(!told.includes(other), `under ${leader}, he is told nothing of ${other}`);
  }
});

test("his agent is told the run's turns, each with its year, as the only ones there were", async () => {
  const calls = await given();
  for (const leader of LEADERS) {
    const years = yearsOfTurns(leader);
    assert.equal(years.size, 6, `the saved run played 6 turns under ${leader}`);
    const last = Math.max(...years.keys());
    const call = calls.get(leader)!;
    const told = buildChatAgentInstructions(call.profile, call.opts);
    assert.match(told, new RegExp(`\\b${years.size} turns\\b`), `under ${leader}, he is told the run had ${years.size} turns`);
    for (const [turn, year] of years) {
      assert.ok(told.includes(`Turn ${turn} (Year ${year})`), `under ${leader}, he is told Turn ${turn} was Year ${year}`);
    }
    assert.ok(told.includes(`ended at Turn ${last}, Year ${years.get(last)}`), `under ${leader}, he is told the run ended at Turn ${last}`);
    for (const m of told.matchAll(/\bTurn (\d+)/g)) {
      assert.ok(years.has(Number(m[1])), `under ${leader}, he is told of Turn ${m[1]}, which the run did not have`);
    }
    const runYears = new Set(years.values());
    for (const m of told.matchAll(/\bYear (\d+)/g)) {
      assert.ok(runYears.has(Number(m[1])), `under ${leader}, he is told of Year ${m[1]}, which is no year of the run`);
    }
  }
});

test('each memory seeded into his agent keeps the turn and the year it happened in', async () => {
  const calls = await given();
  for (const leader of LEADERS) {
    const years = yearsOfTurns(leader);
    const { memories } = calls.get(leader)!;
    assert.ok(memories.some(m => m.type === 'reaction'), `under ${leader}, his own reactions are among his memories`);
    for (const type of ['crisis', 'department', 'decision', 'outcome'] as const) {
      assert.ok(memories.some(m => m.type === type), `under ${leader}, a ${type} is among his memories`);
    }
    for (const m of memories) {
      assert.equal(m.time, years.get(m.turn), `under ${leader}, the ${m.type} memory of Turn ${m.turn} keeps the turn's year`);
      assert.ok(
        m.text.startsWith(`Turn ${m.turn} (Year ${m.time})`),
        `under ${leader}, the ${m.type} memory says its turn and year: ${m.text.slice(0, 80)}`,
      );
    }
  }
});
