/**
 * The digest of the saved pair run that the landing page replays on its
 * first screen. The dashboard's build reads the pinned run
 * (`pinned-run.json` beside this file, the events GET /sessions/:id/replay
 * served, cut to what the page shows) and writes this digest beside itself
 * as `landing-replay.json`; the server sends that file at
 * GET /landing-replay.json and the page draws both timelines from it.
 * The page asks no model and no saved-run store for anything.
 *
 * A build whose pinned run is not a pair of 6 to 8 turns fails here and
 * names the run: the page's run line holds turn 0, each turn and the
 * verdict, 8 to 10 frames.
 */

/** One event of a saved run's replay stream, as the server sent it. */
export interface SavedRunEvent {
  event: string;
  data: unknown;
}

/** A saved run as the landing page's build reads it. */
export interface SavedRun {
  session: string;
  title?: string;
  scenario?: string;
  eventCount?: number;
  events: SavedRunEvent[];
}

/** A person at a frame: [index in `names`, index in `departments`, 1 alive or 0 dead, 1 named on the page or 0]. */
export type ReplayPerson = [number, number, 0 | 1, 0 | 1];

/** A tool a department forged during a turn, with the judge's verdict. */
export interface ReplayTool {
  name: string;
  department: string;
  passed: boolean;
  /** The judge's confidence, 0 to 1. */
  score: number;
}

/** What one leader's timeline held at the end of a turn. */
export interface ReplaySide {
  /** The turn's event as the scenario or the event director wrote it. */
  event: string;
  /** Whether the event director wrote the event from what had happened so far. */
  emergent: boolean;
  decision: string;
  /** The outcome class: risky_success, risky_failure, conservative_success or conservative_failure. */
  outcome: string;
  tools: ReplayTool[];
  population: number;
  births: number;
  deaths: number;
  /** Morale, 0 to 1. */
  morale: number;
  people: ReplayPerson[];
}

/** One turn of the run, both timelines side by side. */
export interface ReplayFrame {
  turn: number;
  year: number;
  /** The run's spend at the end of this turn, both timelines together. */
  cost: { usd: number; tokens: number };
  sides: [ReplaySide, ReplaySide];
}

/** A leader of the pair. */
export interface ReplayLeader {
  name: string;
  archetype: string;
  hexaco: Record<string, number>;
}

/** The digest the landing page loads. */
export interface LandingReplay {
  session: string;
  title: string;
  scenario: string;
  seed: number;
  turns: number;
  /** How many events the saved run holds. */
  events: number;
  /** When the run finished, as the stream's complete event stamped it. */
  completedAt: string;
  cost: { usd: number; llmCalls: number; tokens: number };
  departments: string[];
  names: string[];
  leaders: [ReplayLeader, ReplayLeader];
  /** Turn 0: the people both colonies start with, all alive. */
  start: { year: number; people: ReplayPerson[] };
  frames: ReplayFrame[];
  verdict: {
    winner: string;
    headline: string;
    /** Each leader's people at the end, in the leaders' order. */
    population: [number, number];
    /** The first turn whose event or outcome differs between the two timelines. */
    splitTurn: number;
    /** The first turn whose event, as the scenario or the event director wrote it, differs between the two timelines. */
    eventSplitTurn: number;
  };
}

/** The fewest and the most turns the page's run line is laid out for. */
export const REPLAY_MIN_TURNS = 6;
export const REPLAY_MAX_TURNS = 8;
/** How many people turn 0 names on the page. */
export const REPLAY_NAMED = 5;

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function figure(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

interface SimEvent {
  type: string;
  leader: string;
  data: Fields;
}

/** The `sim` events of the stream, each with its type, its leader and its fields. */
function simEvents(run: SavedRun): SimEvent[] {
  const events: SimEvent[] = [];
  for (const event of run.events) {
    if (event.event !== 'sim' || !isFields(event.data)) continue;
    const { type, leader, data } = event.data;
    if (typeof type === 'string' && typeof leader === 'string' && isFields(data)) events.push({ type, leader, data });
  }
  return events;
}

/** The data of the stream's first event of a kind, if it has one. */
function streamEvent(run: SavedRun, kind: string): Fields | null {
  const found = run.events.find(event => event.event === kind && isFields(event.data));
  return found && isFields(found.data) ? found.data : null;
}

interface Agent {
  id: string;
  name: string;
  department: string;
  alive: boolean;
  marsborn: boolean;
  featured: boolean;
}

function agentsOf(snapshot: Fields): Agent[] {
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
  return agents.filter(isFields).map(agent => ({
    id: text(agent.agentId),
    name: text(agent.name),
    department: text(agent.department),
    alive: agent.alive === true,
    marsborn: agent.marsborn === true,
    featured: agent.featured === true,
  })).filter(agent => agent.id !== '');
}

/**
 * Builds the landing page's digest from a saved pair run. Throws, naming the
 * run, when it is not a pair of 6 to 8 turns or lacks a turn's start,
 * decision, outcome or snapshot for a leader, or the verdict.
 */
export function buildLandingReplay(run: SavedRun): LandingReplay {
  const named = `The pinned run ${run.session}`;
  const status = run.events
    .filter(event => event.event === 'status' && isFields(event.data) && Array.isArray(event.data.actors))
    .map(event => event.data as Fields)[0];
  const actors = status && Array.isArray(status.actors) ? status.actors.filter(isFields) : [];
  if (actors.length !== 2) {
    throw new Error(`${named} has ${actors.length} leaders; the landing page replays a pair.`);
  }
  const leaders = actors.map(actor => ({
    name: text(actor.name),
    archetype: text(actor.archetype),
    hexaco: Object.fromEntries(Object.entries(isFields(actor.hexaco) ? actor.hexaco : {})
      .filter(([, value]) => typeof value === 'number')) as Record<string, number>,
  })) as [ReplayLeader, ReplayLeader];

  const sim = simEvents(run);
  /** The last event of a type for a leader and a turn: a director's placeholder start comes before the real one. */
  const last = (type: string, leader: string, turn: number): Fields | null => {
    let found: Fields | null = null;
    for (const event of sim) {
      if (event.type === type && event.leader === leader && event.data.turn === turn) found = event.data;
    }
    return found;
  };
  const snapshotTurns = sim.filter(event => event.type === 'systems_snapshot').map(event => figure(event.data.turn));
  const turns = snapshotTurns.length > 0 ? Math.max(...snapshotTurns) : 0;
  if (turns < REPLAY_MIN_TURNS || turns > REPLAY_MAX_TURNS) {
    throw new Error(`${named} has ${turns} turns; the landing page replays a pair of ${REPLAY_MIN_TURNS} to ${REPLAY_MAX_TURNS} turns.`);
  }

  const needed = (type: string, leader: string, turn: number): Fields => {
    const found = last(type, leader, turn);
    if (!found) throw new Error(`${named} has no ${type} for ${leader} at turn ${turn}.`);
    return found;
  };

  const names: string[] = [];
  const nameIndex = new Map<string, number>();
  const departments: string[] = [];
  const indexOf = (id: string, name: string): number => {
    let index = nameIndex.get(id);
    if (index === undefined) {
      index = names.length;
      names.push(name);
      nameIndex.set(id, index);
    }
    return index;
  };
  const departmentOf = (department: string): number => {
    let index = departments.indexOf(department);
    if (index === -1) {
      index = departments.length;
      departments.push(department);
    }
    return index;
  };

  // Turn 0: the people of each leader's first snapshot who were not born on
  // Mars in it. Both timelines start from the same people.
  const firstAgents = leaders.map(leader => agentsOf(needed('systems_snapshot', leader.name, 1)).filter(agent => !agent.marsborn));
  const firstIds = firstAgents.map(agents => agents.map(agent => agent.id).sort().join(','));
  if (firstIds[0] !== firstIds[1]) {
    throw new Error(`${named} starts its two timelines with different people.`);
  }
  const featuredByBoth = new Set(firstAgents[1].filter(agent => agent.featured).map(agent => agent.id));
  const namedIds = new Set(firstAgents[0].filter(agent => agent.featured && featuredByBoth.has(agent.id)).slice(0, REPLAY_NAMED).map(agent => agent.id));
  const personOf = (agent: Agent, alive: boolean): ReplayPerson => [
    indexOf(agent.id, agent.name),
    departmentOf(agent.department),
    alive ? 1 : 0,
    namedIds.has(agent.id) ? 1 : 0,
  ];
  const firstYear = figure(needed('turn_start', leaders[0].name, 1).time);
  const start = { year: firstYear, people: firstAgents[0].map(agent => personOf(agent, true)) };

  const tools = (leader: string, turn: number): ReplayTool[] => sim
    .filter(event => event.type === 'forge_attempt' && event.leader === leader && event.data.turn === turn)
    .map(event => ({
      name: text(event.data.name),
      department: text(event.data.department),
      passed: event.data.approved === true,
      score: figure(event.data.confidence),
    }));

  /** Both leaders' running spend at the end of a turn. */
  const spentBy = (turn: number): { usd: number; llmCalls: number; tokens: number } => {
    let usd = 0;
    let llmCalls = 0;
    let tokens = 0;
    for (const leader of leaders) {
      const cost = needed('turn_done', leader.name, turn)._cost;
      if (isFields(cost)) {
        usd += figure(cost.totalCostUSD);
        llmCalls += figure(cost.llmCalls);
        tokens += figure(cost.totalTokens);
      }
    }
    return { usd: Math.round(usd * 10_000) / 10_000, llmCalls, tokens };
  };

  const frames: ReplayFrame[] = [];
  for (let turn = 1; turn <= turns; turn++) {
    const sides = leaders.map(leader => {
      const opened = needed('turn_start', leader.name, turn);
      const snapshot = needed('systems_snapshot', leader.name, turn);
      return {
        event: text(opened.title),
        emergent: opened.emergent === true,
        decision: text(needed('decision_made', leader.name, turn).decision),
        outcome: text(needed('outcome', leader.name, turn).outcome),
        tools: tools(leader.name, turn),
        population: figure(snapshot.population),
        births: figure(snapshot.births),
        deaths: figure(snapshot.deaths),
        morale: figure(snapshot.morale),
        people: agentsOf(snapshot).map(agent => personOf(agent, agent.alive)),
      } satisfies ReplaySide;
    }) as [ReplaySide, ReplaySide];
    const spent = spentBy(turn);
    frames.push({ turn, year: figure(needed('turn_start', leaders[0].name, turn).time), cost: { usd: spent.usd, tokens: spent.tokens }, sides });
  }

  const verdict = streamEvent(run, 'verdict');
  if (!verdict || text(verdict.winnerName) === '') throw new Error(`${named} has no verdict.`);
  const split = frames.find(frame => frame.sides[0].event !== frame.sides[1].event || frame.sides[0].outcome !== frame.sides[1].outcome);
  const eventSplit = frames.find(frame => frame.sides[0].event !== frame.sides[1].event);
  const end = frames[frames.length - 1].sides;

  const seeds = run.events
    .filter(event => event.event === 'result' && isFields(event.data))
    .map(event => {
      const artifact = (event.data as Fields).artifact;
      const metadata = isFields(artifact) ? artifact.metadata : null;
      return isFields(metadata) ? figure(metadata.seed) : 0;
    });
  const scenario = streamEvent(run, 'active_scenario');
  const complete = streamEvent(run, 'complete');

  return {
    session: run.session,
    title: run.title ?? '',
    scenario: run.scenario ?? (scenario ? text(scenario.name) : ''),
    seed: seeds[0] ?? 0,
    turns,
    events: run.eventCount ?? run.events.length,
    completedAt: complete ? text(complete.timestamp) : '',
    // The run's cost: each leader's running total at the end of its last turn.
    cost: spentBy(turns),
    departments,
    names,
    leaders,
    start,
    frames,
    verdict: {
      winner: text(verdict.winnerName),
      headline: text(verdict.headline),
      population: [end[0].population, end[1].population],
      splitTurn: split ? split.turn : turns,
      eventSplitTurn: eventSplit ? eventSplit.turn : turns,
    },
  };
}
