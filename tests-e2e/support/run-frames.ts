/**
 * The frames of a run's stream, as the server sends them and the session
 * store saves them: one `event: <name>` line and one `data: <json>` line.
 *
 * The stored runs of the end-to-end servers and the generated runs of
 * forge-fixtures.ts are written with these, and a unit test turns the same
 * frames into the events the dashboard's stream hook would hold.
 */
import type { SimEvent } from '../../src/dashboard/src/hooks/useSSE.js';

export const frame = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
export const sim = (leader: string, type: string, data: Record<string, unknown>): string => frame('sim', { type, leader, data });

/**
 * A forged tool as specialist_done carries it in forgedTools. `more` adds or
 * replaces fields of the record: its history rows, a schema, an outcome.
 */
export function tool(
  name: string,
  description: string,
  department: string,
  firstForgedTurn: number,
  isNew: boolean,
  confidence: number,
  more: Record<string, unknown> = {},
) {
  return {
    name,
    description,
    mode: 'sandbox',
    approved: true,
    confidence,
    inputFields: ['radiation_msv_per_day', 'ice_index'],
    outputFields: ['score'],
    output: JSON.stringify({ score: 82 }),
    department,
    isNew,
    firstForgedTurn,
    firstForgedDepartment: department,
    ...more,
  };
}

/**
 * forge_attempt as the orchestrator emits it when a department forges a tool.
 * `more` adds or replaces fields: a forge that did not pass, its reason, a
 * time of its own.
 */
export function forge(
  leader: string,
  turn: number,
  time: number,
  department: string,
  name: string,
  description: string,
  confidence: number,
  more: Record<string, unknown> = {},
): string {
  return sim(leader, 'forge_attempt', {
    turn, time, eventIndex: 0, department, name, description, mode: 'sandbox',
    approved: true, confidence,
    inputFields: ['radiation_msv_per_day', 'ice_index'], outputFields: ['score'],
    timestamp: '2026-11-16T01:52:10.000Z',
    ...more,
  });
}

/** One leader's turn: the event, one department's report with the tools it used, the decision and its outcome. */
export function leaderTurn(
  leader: string,
  turn: number,
  department: string,
  forges: string[],
  tools: Array<Record<string, unknown>>,
): string[] {
  const time = 2035 + (turn - 1) * 8;
  const at = { turn, time };
  return [
    sim(leader, 'turn_start', { ...at, title: turn === 1 ? 'Landfall' : 'Dust Season', crisis: 'Choose where to build.', category: 'environmental', births: 0, deaths: 0, metrics: { population: 30, morale: 0.85 }, emergent: false, turnSummary: '', totalEvents: 1, pacing: 'normal' }),
    sim(leader, 'event_start', { ...at, eventIndex: 0, totalEvents: 1, title: turn === 1 ? 'Landfall' : 'Dust Season', description: 'Choose where to build.', category: 'environmental', emergent: false, turnSummary: '', pacing: 'normal' }),
    sim(leader, 'specialist_start', { ...at, department, eventIndex: 0 }),
    ...forges,
    sim(leader, 'specialist_done', { ...at, department, summary: `${department} report for turn ${turn}.`, eventIndex: 0, citations: 0, citationList: [], risks: [], forgedTools: tools, recommendedActions: [] }),
    sim(leader, 'decision_pending', { ...at, eventIndex: 0 }),
    sim(leader, 'decision_made', { ...at, decision: 'Build on the plains.', rationale: 'The plains are safer.', reasoning: 'The plains are safer.', selectedPolicies: [], eventIndex: 0 }),
    sim(leader, 'outcome', { ...at, outcome: 'conservative_success', category: 'environmental', emergent: false, systemDeltas: { morale: 0.02 }, eventIndex: 0 }),
    sim(leader, 'turn_done', { ...at, metrics: { population: 30, morale: 0.87 }, toolsForged: 1 }),
  ];
}

/**
 * One department's report in a turn's first event: its start, the forges it
 * made, and the report that lists its tools. The page keeps one report for an
 * actor, turn, event and department, so a second one of the same four is
 * dropped as a repeat.
 */
export function departmentReport(
  leader: string,
  turn: number,
  department: string,
  forges: string[],
  tools: Array<Record<string, unknown>>,
): string[] {
  const at = { turn, time: 2035 + (turn - 1) * 8 };
  return [
    sim(leader, 'specialist_start', { ...at, department, eventIndex: 0 }),
    ...forges,
    sim(leader, 'specialist_done', { ...at, department, summary: `${department} report for turn ${turn}.`, eventIndex: 0, citations: 0, citationList: [], risks: [], forgedTools: tools, recommendedActions: [] }),
  ];
}

/**
 * The events the dashboard's stream hook holds after these frames: a `sim`
 * frame is its parsed data, and a `status` frame an event of type `status`
 * with no leader. Other frames are left out.
 */
export function framesToSimEvents(frames: string[]): SimEvent[] {
  const events: SimEvent[] = [];
  for (const sse of frames) {
    const match = /^event: (\S+)\ndata: (.*)\n\n$/s.exec(sse);
    if (!match) continue;
    if (match[1] === 'sim') events.push(JSON.parse(match[2]) as SimEvent);
    else if (match[1] === 'status') events.push({ type: 'status', leader: '', data: JSON.parse(match[2]) as Record<string, unknown> });
  }
  return events;
}

/** One member of an actor's population, as systems_snapshot lists it. */
export interface CrewMember {
  agentId: string;
  name: string;
  department: string;
  role: string;
  rank: 'junior' | 'senior' | 'lead' | 'chief';
  alive: boolean;
  marsborn: boolean;
  psychScore: number;
  age: number;
  generation: number;
  childrenIds: string[];
  featured: boolean;
  mood: string;
  shortTermMemory: string[];
}

const CREW_FIRST = ['Noor', 'Ben', 'Ifeoma', 'Lars', 'Rin', 'Paula', 'Idris', 'Greta'];
const CREW_LAST = ['Aziz', 'Calder', 'Eze', 'Holm', 'Sato'];
const CREW_RANKS = ['chief', 'lead', 'senior', 'junior'] as const;
const CREW_MOODS = ['hopeful', 'neutral', 'anxious', 'focused'];

/**
 * A small population for one actor at one turn, the same for the same actor
 * and turn: the living grid draws one cell a member.
 */
export function crewOf(leader: string, turn: number, departments: string[], size = 8): CrewMember[] {
  const slug = leader.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return Array.from({ length: size }, (_, i) => ({
    agentId: `${slug}-crew-${i + 1}`,
    name: `${CREW_FIRST[i % CREW_FIRST.length]} ${CREW_LAST[Math.floor(i / CREW_FIRST.length) % CREW_LAST.length]}`,
    department: departments[i % departments.length],
    role: `${departments[i % departments.length]} specialist`,
    rank: CREW_RANKS[i % CREW_RANKS.length],
    alive: true,
    marsborn: false,
    psychScore: Math.round((0.55 + ((i * 7 + turn * 3) % 40) / 100) * 100) / 100,
    age: 28 + ((i * 5 + leader.length) % 22),
    generation: 0,
    childrenIds: [],
    featured: i < 2,
    mood: CREW_MOODS[(i + turn) % CREW_MOODS.length],
    shortTermMemory: [],
  }));
}

/** systems_snapshot as the orchestrator emits it at the end of a turn: the population the living grid draws. */
export function systemsSnapshot(leader: string, turn: number, time: number, agents: CrewMember[], morale = 0.87): string {
  return sim(leader, 'systems_snapshot', {
    turn, time, agents,
    population: agents.filter(a => a.alive).length, morale, foodReserve: 14,
    births: 0, deaths: 0,
  });
}
