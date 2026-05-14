import { DEFAULT_KEY_PERSONNEL, type NormalizedSimulationConfig } from './sim-config.js';
import { marsScenario } from '../engine/scenarios/index.js';
import { apiKeyForProvider } from '../engine/provider/credentials.js';
import { generateValidatedObject } from '../llm/generateValidatedObject.js';
import { VerdictSchema, CohortVerdictSchema } from '../runtime/validators/verdict.js';
import type { ScenarioPackage } from '../engine/types.js';
import type { ResolvedEconomicsProfile } from '../runtime/economics/economics-profile.js';

/**
 * Largest cohort that gets a full LLM-ranked verdict. Past this size
 * the prompt + response token budget explodes and the dashboard
 * auto-switches to the constellation view anyway, so the per-actor
 * ranking stops being load-bearing. For N > MAX_COHORT_VERDICT_N the
 * batch runner skips the verdict call entirely and the dashboard
 * surfaces the group-median deltas via the constellation surface.
 */
const MAX_COHORT_VERDICT_N = 50;

/**
 * Per-actor summary used by both the pair verdict and the cohort
 * verdict prompt builders. Pulled out of the original inline
 * `formatLeader` closure so the cohort runner can reuse it without
 * duplicating the cause-of-death rollup + tool-ledger math.
 *
 * @param label leading label for this actor in the prompt ("LEADER A",
 *              "#3 Captain Reyes", etc.)
 * @param leader actor config (carries HEXACO + archetype + unit)
 * @param result completed RunArtifact for this actor
 * @param col `result.finalState.metrics`, hoisted for clarity
 */
function formatActorSummary(
  label: string,
  leader: import('../runtime/orchestrator/index.js').ActorConfig,
  result: any,
  col: any,
): string {
  const fp = result.fingerprint || {};
  const toolbox = result.forgedToolbox || [];
  const topTools = toolbox.slice(0, 5).map((t: any) => `${t.name}(${t.firstForgedDepartment}, reused ${t.reuseCount}x)`).join('; ');
  const deathEvents = (result.finalState?.eventLog ?? []).filter((e: any) => e.type === 'death');
  const causeCounts: Record<string, number> = {};
  for (const d of deathEvents) {
    const raw = (d.cause as string | undefined) ?? 'unknown';
    const key = raw.startsWith('accident:') ? 'accident' : raw;
    causeCounts[key] = (causeCounts[key] ?? 0) + 1;
  }
  const causeSummary = Object.keys(causeCounts).length > 0
    ? Object.entries(causeCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ')
    : 'no deaths';
  return [
    `${label}: ${leader.name} "${leader.archetype}" (${leader.unit})`,
    // Optional-chain every HEXACO axis so actors using the ai-agent
    // (or any other) trait model — where `leader.hexaco` is undefined
    // because the profile lives under `traitProfile` instead — don't
    // crash the verdict prompt builder with a TypeError. Falls back
    // to 0.50 (the schema default) so the prompt still carries a
    // structurally complete HEXACO line for the LLM to reason from.
    `  HEXACO: O${(leader.hexaco?.openness ?? 0.5).toFixed(2)} C${(leader.hexaco?.conscientiousness ?? 0.5).toFixed(2)} E${(leader.hexaco?.extraversion ?? 0.5).toFixed(2)} A${(leader.hexaco?.agreeableness ?? 0.5).toFixed(2)} Em${(leader.hexaco?.emotionality ?? 0.5).toFixed(2)} HH${(leader.hexaco?.honestyHumility ?? 0.5).toFixed(2)}`,
    `  Final: Pop ${col?.population ?? '?'}, Morale ${Math.round((col?.morale ?? 0) * 100)}%, Food ${col?.foodMonthsReserve?.toFixed(1) ?? '?'}mo, Power ${col?.powerKw?.toFixed(0) ?? '?'}kW, Modules ${col?.infrastructureModules?.toFixed(1) ?? '?'}, Science ${col?.scienceOutput ?? '?'}`,
    `  Mortality: ${deathEvents.length} total (${causeSummary})`,
    `  Innovation: ${toolbox.length} unique tools forged (${fp.innovation || 'n/a'}), citations ${result.totalCitations}`,
    topTools ? `  Top tools: ${topTools}` : '  No tools forged',
    `  Fingerprint: ${fp.summary || 'n/a'}`,
    `  Cost: $${result.cost?.totalCostUSD?.toFixed(4) ?? '?'} over ${result.cost?.llmCalls ?? '?'} LLM calls`,
  ].join('\n');
}

/**
 * SSE broadcast contract. The optional `actorId` lets per-actor
 * subscribers (`/events?actor=<id>`) filter to one leader's stream
 * without parsing every payload server-side. Callers emitting global
 * events (status, active_scenario, complete, sim_aborted, verdict)
 * omit it; per-actor callers (sim, sim_error, result) pass the
 * leader's name so the filter can match.
 */
export type BroadcastFn = (event: string, data: unknown, actorId?: string) => void;

/**
 * Derive a stable kebab-case tag for a leader from archetype, name, and
 * (last-resort) index. Hardened against missing/non-string fields so a
 * sparse LLM-generated actor never crashes the runner with a bare
 * `archetype.toLowerCase()` TypeError. Used for SSE leader tags, runId
 * prefixes, and per-leader artifact filenames.
 */
export function leaderTag(
  leader: { archetype?: unknown; name?: unknown },
  index: number,
): string {
  const archetype = typeof leader.archetype === 'string' ? leader.archetype : '';
  const name = typeof leader.name === 'string' ? leader.name : '';
  const fromArchetype = archetype.toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, '-');
  if (fromArchetype) return fromArchetype;
  const fromName = name.toLowerCase().replace(/\s+/g, '-');
  if (fromName) return fromName;
  return `leader-${index}`;
}

function resolveVerdictModel(
  provider: 'openai' | 'anthropic',
  economics: ResolvedEconomicsProfile,
): string | null {
  switch (economics.verdict.mode) {
    case 'skip':
      return null;
    case 'cheap':
      return provider === 'anthropic'
        ? 'claude-haiku-4-5-20251001'
        : 'gpt-5.4-mini';
    case 'flagship':
      return provider === 'anthropic'
        ? 'claude-opus-4-7'
        : 'gpt-5.4-pro';
    case 'balanced':
    default:
      return provider === 'anthropic'
        ? 'claude-sonnet-4-6'
        : 'gpt-5.4';
  }
}

export async function runPairSimulations(
  simConfig: NormalizedSimulationConfig,
  broadcast: BroadcastFn,
  /**
   * Optional cancellation signal. When the server's disconnect watchdog
   * trips (all SSE clients gone + grace period expired), it aborts this
   * signal. Both leaders' runSimulation calls check it at turn
   * boundaries and short-circuit cleanly, emitting a `sim_aborted`
   * event and returning partial results. The event buffer is preserved
   * so a returning user sees everything up to the cancel point.
   */
  signal?: AbortSignal,
  /**
   * Scenario to run. Defaults to Mars Genesis when omitted so CLI
   * callers that don't thread a scenario still work. The server path
   * passes the currently-active scenario (set by /compile or
   * /scenario/switch) so custom-compiled scenarios (e.g. "Brain Sim")
   * actually get their own hooks + labels run instead of silently
   * falling back to Mars while the page title shows the custom name.
   */
  scenario: ScenarioPackage = marsScenario,
  /**
   * Optional callback fired after each leader's artifact completes.
   * server-app uses this to insert a RunRecord per artifact into
   * the SQLite run-history store. Failures inside the callback are
   * caught and logged so a failing handler does not break the run.
   */
  onArtifact?: (artifact: import('../engine/schema/index.js').RunArtifact, leader: import('../runtime/orchestrator/index.js').ActorConfig) => void | Promise<void>,
): Promise<void> {
  const { actors, turns, seed, startTime, liveSearch, customEvents } = simConfig;
  broadcast('status', { phase: 'starting', maxTurns: turns, customEvents });

  const { runSimulation } = await import('../runtime/orchestrator/index.js');
  // Per-actor SSE channels: pull leader from each event so subscribers
  // on /events?actor=<leaderName> can filter the stream server-side.
  // Orchestrator emits events with `{ type, leader: leader.name, data }`
  // (see runtime/orchestrator.ts:514), so the leader field is always
  // present on per-actor events.
  const onEvent = (event: unknown) => {
    const leader = (event as { leader?: string } | null)?.leader;
    broadcast('sim', event, leader);
  };
  broadcast('status', {
    phase: 'parallel',
    actors: actors.map(leader => ({
      name: leader.name,
      archetype: leader.archetype,
      unit: leader.unit,
      hexaco: leader.hexaco,
    })),
  });

  console.log(`  Running: ${actors[0].name} vs ${actors[1].name} | ${turns} turns | seed ${seed}\n`);

  const results = await Promise.allSettled(actors.map((leader, index) => {
    const tag = leaderTag(leader, index);
    return runSimulation(leader, simConfig.keyPersonnel ?? DEFAULT_KEY_PERSONNEL, {
      maxTurns: turns,
      seed,
      startTime,
      timePerTurn: simConfig.timePerTurn,
      liveSearch,
      activeDepartments: simConfig.activeDepartments,
      onEvent,
      customEvents,
      provider: simConfig.provider,
      models: simConfig.models,
      economics: simConfig.economics,
      initialPopulation: simConfig.initialPopulation,
      startingResources: simConfig.startingResources,
      startingPolitics: simConfig.startingPolitics,
      execution: simConfig.execution,
      scenario,
      signal,
      captureSnapshots: simConfig.captureSnapshots ?? false,
      apiKey: simConfig.apiKey,
      anthropicKey: simConfig.anthropicKey,
      serperKey: simConfig.serperKey,
      firecrawlKey: simConfig.firecrawlKey,
      tavilyKey: simConfig.tavilyKey,
      cohereKey: simConfig.cohereKey,
    }).then(async result => {
      broadcast('result', {
        leader: tag,
        summary: {
          population: result.finalState?.metrics?.population,
          morale: result.finalState?.metrics?.morale,
          toolsForged: result.forgedTools?.length ?? 0,
          citations: result.citations?.length ?? 0,
        },
        fingerprint: result.fingerprint ?? null,
        // Spec 2B bridge: emit the full artifact on result when
        // snapshot capture was on so the dashboard can fork from it
        // without reconstructing from the event stream. Skipped when
        // captureSnapshots is off to keep the SSE payload lean on
        // hosted-demo runs that don't need fork capability.
        artifact: simConfig.captureSnapshots ? result : undefined,
      });
      if (onArtifact) {
        try { await onArtifact(result, leader); } catch (err) {
          console.warn('[pair-runner] onArtifact handler failed:', err);
        }
      }
      return { tag, leader, result };
    }, error => {
      broadcast('sim_error', { leader: tag, error: String(error) }, tag);
      throw error;
    });
  }));

  // Generate final verdict comparing both leaders
  const settled = results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<any>).value);

  // Skip verdict generation when EITHER leader was cancelled externally
  // (user navigated away → server pulled the plug) or hit a terminal
  // provider error. Running the verdict LLM call on partial data would
  // burn an extra flagship call for a comparison that doesn't mean
  // anything on incomplete runs. The dashboard shows the "Unfinished"
  // badge in place of the verdict card.
  const anyAborted = settled.some(v => (v.result as any)?.aborted === true || (v.result as any)?.providerError);
  if (anyAborted) {
    broadcast('complete', { timestamp: new Date().toISOString(), aborted: true });
    return;
  }

  if (settled.length === 2) {
    try {
      const [a, b] = settled;
      const colA = a.result.finalState?.metrics;
      const colB = b.result.finalState?.metrics;
      const verdictModel = resolveVerdictModel(simConfig.provider || 'openai', simConfig.economics);
      if (!verdictModel) {
        broadcast('complete', {
          timestamp: new Date().toISOString(),
          verdictSkipped: true,
          economicsProfile: simConfig.economics.id,
        });
        return;
      }
      // Build a richer per-leader summary including innovation telemetry
      // (forged toolbox details, fingerprint classification) so the LLM
      // verdict actually reasons about emergent tool use, not just final
      // colony numbers.
      // Pair verdict shares the module-level `formatActorSummary`
      // helper with the cohort verdict so the per-leader prompt block
      // (HEXACO, cause-of-death rollup, forged toolbox, fingerprint,
      // cost) stays canonical across both code paths instead of
      // drifting between two near-identical closure copies.
      const formatLeader = (label: string, v: any, col: any) =>
        formatActorSummary(label, v.leader, v.result, col);

      // Verdict runs once per completed sim and is the single most
      // user-facing synthesis call in the pipeline: it reads both
      // final states, the per-leader cause-of-death breakdown, the
      // forged toolbox, and writes the headline + summary that the
      // user sees first when the run finishes. Cheap-tier output on
      // this call was noticeably flatter than flagship output, so
      // pay the ~$0.02-0.05 per run for the better read.
      try {
        const { object: verdict, fromFallback } = await generateValidatedObject({
          provider: simConfig.provider || 'openai',
          model: verdictModel,
          apiKey: apiKeyForProvider(simConfig.provider || 'openai', simConfig),
          schema: VerdictSchema,
          schemaName: 'Verdict',
          prompt: `You are judging a colony simulation. Two AI commanders with opposing HEXACO personality profiles led identical colonies through ${turns} turns from the same starting conditions and deterministic seed. Your job is to write a verdict that explains WHY the runs diverged the way they did, not just WHO won.

${formatLeader('LEADER A', a, colA)}

${formatLeader('LEADER B', b, colB)}

TRADEOFFS TO WEIGH
Tool forging is a cost / capability tradeoff: every forged tool spent a judge LLM call and ate analyst attention; failed forges hurt morale and produced no reusable capability; successful tools let later decisions reason about concrete numbers. A leader who built few tools and reused them many times has a disciplined, cost-efficient signature. A leader who forged many novel tools has an exploratory signature with broader capability surface. Both are valid strategies and your scoring should reflect that trade, not punish either extreme.

Mortality is a cause-specific signal, not a number. The "Mortality" line above names HOW each colonist died. A leader who lost 5 to starvation made different resource-allocation decisions than a leader who lost 5 to radiation cancer; a leader with despair deaths presided over a colony in psychological freefall. Reference the specific causes when they shape the story.

REASONING — populate the "reasoning" field of your JSON response with a numbered list covering:
  (1) Population trajectory — how did each colony's population evolve, and which tradeoffs produced that shape?
  (2) Morale + psychological state — which leader's colony held together emotionally, and what does that say about HEXACO + decision style?
  (3) Resource efficiency — food, power, infrastructure — which side ran leaner, which hit crises?
  (4) Innovation signature — tools forged vs reused, breadth vs depth. What does each leader's toolbox say about their cognition?
  (5) Mortality story — which causes dominated each side, and what does THAT say about the leader's priorities?
  (6) The single most impactful divergence — resource decision, crisis response, tool strategy, or emergent behavior. Name it precisely.
  (7) Weighing the tradeoffs, who won and why.

Then fill out:
  winner: "A" or "B" or "tie"
  winnerName: the winning leader's name, or "Tie" for a tie
  headline: one-line verdict grounded in the key divergence (max 80 chars)
  summary: 2-3 sentences naming the personality + tool-use + mortality pattern that drove the divergence
  keyDivergence: the single most impactful difference between the two runs
  scores: { a: { survival, prosperity, morale, innovation }, b: { survival, prosperity, morale, innovation } } — each 0-10`,
        });
        if (fromFallback) {
          console.log('  Verdict schema fallback; skipping broadcast');
          // Pair verdict fell back the same way the cohort version
          // does — emit the same explanatory event so the UI surfaces
          // a "no verdict" banner instead of going silent.
          broadcast('verdict_skipped', {
            mode: 'pair',
            reason: 'generation_failed',
            detail: 'Schema validation fallback exhausted',
          });
        } else {
          broadcast('verdict', {
            ...verdict,
            leaderA: { name: a.leader.name, archetype: a.leader.archetype, unit: a.leader.unit },
            leaderB: { name: b.leader.name, archetype: b.leader.archetype, unit: b.leader.unit },
            finalStats: {
              a: { population: colA?.population, morale: colA?.morale, food: colA?.foodMonthsReserve, power: colA?.powerKw, modules: colA?.infrastructureModules, science: colA?.scienceOutput, tools: a.result.totalToolsForged },
              b: { population: colB?.population, morale: colB?.morale, food: colB?.foodMonthsReserve, power: colB?.powerKw, modules: colB?.infrastructureModules, science: colB?.scienceOutput, tools: b.result.totalToolsForged },
            },
          });
          console.log(`\n  VERDICT: ${verdict.headline}`);
          console.log(`  Winner: ${verdict.winnerName} (${verdict.winner})`);
          console.log(`  ${verdict.summary}\n`);
        }
      } catch (verdictErr) {
        console.log('  Verdict generation failed:', verdictErr);
      }
    } catch (outerErr) {
      console.log('  Verdict outer failure:', outerErr);
    }
  }

  broadcast('complete', { timestamp: new Date().toISOString() });
}

/**
 * Single-leader fork dispatch (Spec 2B). When `/setup` receives a
 * config with `forkFrom` set, the server branches here instead of
 * `runPairSimulations`. The fork inherits the parent's kernel state
 * + PRNG from the embedded per-turn snapshot, swaps in the supplied
 * override leader, and runs from `atTurn + 1` to `config.turns`.
 *
 * No verdict generation at the end: verdicts compare two leaders
 * against each other, but forks compare against their parent in the
 * dashboard Branches tab, not against a second live branch.
 *
 * Consumes `simConfig.forkFrom.parentArtifact` verbatim from the
 * client. Server-side validation (scenario match, embedded
 * snapshots, single-leader guard) happened in the `/setup` handler
 * before this function is reached.
 */
export async function runForkSimulation(
  simConfig: NormalizedSimulationConfig,
  broadcast: BroadcastFn,
  signal?: AbortSignal,
  scenario: ScenarioPackage = marsScenario,
  /** Optional callback fired after the forked artifact completes. */
  onArtifact?: (artifact: import('../engine/schema/index.js').RunArtifact, leader: import('../runtime/orchestrator/index.js').ActorConfig) => void | Promise<void>,
): Promise<void> {
  if (!simConfig.forkFrom) {
    throw new Error('runForkSimulation called without simConfig.forkFrom set');
  }
  if (simConfig.actors.length !== 1) {
    throw new Error(`runForkSimulation requires exactly 1 leader, got ${simConfig.actors.length}`);
  }
  const leader = simConfig.actors[0];
  const { turns, seed, startTime, liveSearch, customEvents } = simConfig;
  broadcast('status', { phase: 'starting', maxTurns: turns, customEvents, fork: true });

  const { WorldModel } = await import('../runtime/world-model/index.js');
  const wm = WorldModel.fromScenario(scenario);
  const forkedWm = await wm.forkFromArtifact(
    simConfig.forkFrom.parentArtifact,
    simConfig.forkFrom.atTurn,
  );

  broadcast('status', {
    phase: 'fork-running',
    leader: {
      name: leader.name,
      archetype: leader.archetype,
      unit: leader.unit,
      hexaco: leader.hexaco,
    },
    parentRunId: simConfig.forkFrom.parentArtifact.metadata.runId,
    atTurn: simConfig.forkFrom.atTurn,
  });

  console.log(
    `  Fork: ${leader.name} resuming from turn ${simConfig.forkFrom.atTurn} of ` +
    `parent ${simConfig.forkFrom.parentArtifact.metadata.runId}\n`,
  );

  // Per-actor SSE filter: orchestrator events carry { leader } so
  // /events?actor=<leaderName> subscribers receive only this fork's
  // stream.
  const onEvent = (event: unknown) => {
    const lname = (event as { leader?: string } | null)?.leader;
    broadcast('sim', event, lname);
  };

  try {
    const result = await forkedWm.simulate({
      actor: leader,
      keyPersonnel: simConfig.keyPersonnel ?? DEFAULT_KEY_PERSONNEL,
      maxTurns: turns,
      seed,
      startTime,
      timePerTurn: simConfig.timePerTurn,
      liveSearch,
      activeDepartments: simConfig.activeDepartments,
      onEvent,
      customEvents,
      provider: simConfig.provider,
      models: simConfig.models,
      economics: simConfig.economics,
      initialPopulation: simConfig.initialPopulation,
      startingResources: simConfig.startingResources,
      startingPolitics: simConfig.startingPolitics,
      execution: simConfig.execution,
      signal,
      captureSnapshots: true,
      apiKey: simConfig.apiKey,
      anthropicKey: simConfig.anthropicKey,
      serperKey: simConfig.serperKey,
      firecrawlKey: simConfig.firecrawlKey,
      tavilyKey: simConfig.tavilyKey,
      cohereKey: simConfig.cohereKey,
    });
    broadcast('result', {
      leader: leaderTag(leader, 0),
      summary: {
        population: result.finalState?.metrics?.population,
        morale: result.finalState?.metrics?.morale,
        toolsForged: result.forgedTools?.length ?? 0,
        citations: result.citations?.length ?? 0,
      },
      fingerprint: result.fingerprint ?? null,
      forkedFrom: result.metadata.forkedFrom,
      // Fork runs always have captureSnapshots forced on (see
      // simulate call above); emit the full artifact so the dashboard
      // can keep forking recursively without the event-stream
      // reconstruction the spec originally assumed.
      artifact: result,
    });
    if (onArtifact) {
      try { await onArtifact(result, leader); } catch (err) {
        console.warn('[fork-runner] onArtifact handler failed:', err);
      }
    }
  } catch (err) {
    // Align fork-runner's sim_error payload + routing with the other
    // two paths (lines 167 + 526) — leaderTag is the kebab-cased
    // identifier the dashboard's useGameState reads as evt.leader.
    const errTag = leaderTag(leader, 0);
    broadcast('sim_error', { leader: errTag, error: String(err) }, errTag);
    throw err;
  }

  broadcast('complete', { timestamp: new Date().toISOString(), fork: true });
}

/**
 * Generalized N-leader batch runner (Tier 5 Quickstart). Three or more
 * leaders run against the same scenario + seed in parallel, each
 * emitting per-leader SSE events identical to the pair path. No
 * verdict generation: verdicts compare exactly two leaders and would
 * be ambiguous across N >= 3. The dashboard's Quickstart tab surfaces
 * group-median deltas instead.
 *
 * Per-leader tags are derived from archetype (lowercased, kebab-cased).
 * Duplicate archetype strings get trailing indices for disambiguation.
 */
export async function runBatchSimulations(
  simConfig: NormalizedSimulationConfig,
  broadcast: BroadcastFn,
  signal?: AbortSignal,
  scenario: ScenarioPackage = marsScenario,
  /** Optional callback fired after each leader's artifact completes. */
  onArtifact?: (artifact: import('../engine/schema/index.js').RunArtifact, leader: import('../runtime/orchestrator/index.js').ActorConfig) => void | Promise<void>,
): Promise<void> {
  const { actors, turns, seed, startTime, liveSearch, customEvents } = simConfig;
  broadcast('status', { phase: 'starting', maxTurns: turns, customEvents, batch: true, actorCount: actors.length });

  const { runSimulation } = await import('../runtime/orchestrator/index.js');
  // Per-actor SSE filter: same pattern as runPairSimulations / fork.
  const onEvent = (event: unknown) => {
    const lname = (event as { leader?: string } | null)?.leader;
    broadcast('sim', event, lname);
  };
  broadcast('status', {
    phase: 'parallel',
    batch: true,
    actors: actors.map(leader => ({
      name: leader.name,
      archetype: leader.archetype,
      unit: leader.unit,
      hexaco: leader.hexaco,
    })),
  });

  console.log(`  Running batch: ${actors.map(l => l.name).join(' vs ')} | ${turns} turns | seed ${seed}
`);

  const usedTags = new Map<string, number>();
  const actorsWithTags = actors.map((leader, index) => {
    const base = leaderTag(leader, index);
    const count = usedTags.get(base) ?? 0;
    usedTags.set(base, count + 1);
    const tag = count === 0 ? base : `${base}-${count + 1}`;
    return { leader, index, tag };
  });

  // Concurrency cap. The batch runner used to fan out every actor
  // through Promise.allSettled, which fired 300 simultaneous LLM
  // streams when /setup was called with 300 actors — provider rate
  // limits would 429-storm the run before the first turn finished.
  // The economics profile carries `batch.maxConcurrency` (default 8
  // for the standard profile, lower in cost-cap mode) so we now
  // process actors through a small worker pool instead. Result + sim
  // events still broadcast as each actor completes, so the dashboard
  // sees live progress regardless of pool size.
  const maxConcurrency = Math.max(1, simConfig.economics?.batch?.maxConcurrency ?? 8);
  const runOne = ({ leader, index, tag }: typeof actorsWithTags[number]) =>
    runSimulation(leader, simConfig.keyPersonnel ?? DEFAULT_KEY_PERSONNEL, {
      maxTurns: turns,
      seed,
      startTime,
      timePerTurn: simConfig.timePerTurn,
      liveSearch,
      activeDepartments: simConfig.activeDepartments,
      onEvent,
      customEvents,
      provider: simConfig.provider,
      models: simConfig.models,
      economics: simConfig.economics,
      initialPopulation: simConfig.initialPopulation,
      startingResources: simConfig.startingResources,
      startingPolitics: simConfig.startingPolitics,
      execution: simConfig.execution,
      scenario,
      signal,
      captureSnapshots: simConfig.captureSnapshots ?? false,
      apiKey: simConfig.apiKey,
      anthropicKey: simConfig.anthropicKey,
      serperKey: simConfig.serperKey,
      firecrawlKey: simConfig.firecrawlKey,
      tavilyKey: simConfig.tavilyKey,
      cohereKey: simConfig.cohereKey,
    }).then(async result => {
      broadcast('result', {
        leader: tag,
        actorIndex: index,
        summary: {
          population: result.finalState?.metrics?.population,
          morale: result.finalState?.metrics?.morale,
          toolsForged: result.forgedTools?.length ?? 0,
          citations: result.citations?.length ?? 0,
        },
        fingerprint: result.fingerprint ?? null,
        artifact: simConfig.captureSnapshots ? result : undefined,
      });
      if (onArtifact) {
        try { await onArtifact(result, leader); } catch (err) {
          console.warn('[batch-runner] onArtifact handler failed:', err);
        }
      }
      return result;
    }, error => {
      broadcast('sim_error', { leader: tag, actorIndex: index, error: String(error) }, tag);
      throw error;
    });

  // Simple worker-pool implementation: keep `maxConcurrency` runs
  // in flight at once. Avoids pulling in `p-limit` for one usage and
  // keeps abort behaviour identical (each runSimulation already
  // observes simConfig.signal). Errors are captured per-actor in the
  // settled-style result array so a single 429 doesn't poison the
  // whole batch.
  const settled: PromiseSettledResult<unknown>[] = new Array(actorsWithTags.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const slot = nextIndex++;
      if (slot >= actorsWithTags.length) return;
      try {
        settled[slot] = { status: 'fulfilled', value: await runOne(actorsWithTags[slot]) };
      } catch (reason) {
        settled[slot] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, actorsWithTags.length) }, () => worker()),
  );

  // Mirror runPairSimulations: surface aborted/provider-error at the
  // terminal event so the dashboard can badge the session as
  // interrupted. We consider the batch aborted when every leader
  // failed or reported abortion; a single success still counts as
  // a successful batch run.
  const fulfilled = settled.filter(s => s.status === 'fulfilled')
    .map(s => (s as PromiseFulfilledResult<unknown>).value as { aborted?: boolean; providerError?: unknown });
  const allAborted = fulfilled.length === 0 || fulfilled.every(v => v?.aborted === true || !!v?.providerError);

  // Cohort verdict: rank every actor that finished cleanly. Previously
  // the dashboard saw no winner banner for N>=3 runs because verdicts
  // were pair-only; now a single LLM call produces an absolute winner
  // plus a full ranked list, scoped to MAX_COHORT_VERDICT_N actors so
  // the prompt budget stays bounded. Skipped on abort + when the
  // economics profile turns verdicts off ('skip' mode).
  if (!allAborted) {
    const verdictModel = resolveVerdictModel(simConfig.provider || 'openai', simConfig.economics);
    const cleanRuns: Array<{ leader: import('../runtime/orchestrator/index.js').ActorConfig; index: number; result: any }> = [];
    for (let i = 0; i < settled.length; i++) {
      const slot = settled[i];
      if (slot?.status !== 'fulfilled') continue;
      const result = slot.value as any;
      if (result?.aborted === true || result?.providerError) continue;
      cleanRuns.push({ leader: actorsWithTags[i].leader, index: actorsWithTags[i].index, result });
    }

    if (verdictModel && cleanRuns.length >= 2 && cleanRuns.length <= MAX_COHORT_VERDICT_N) {
      const summaries = cleanRuns.map(({ leader, index, result }) => {
        const col = result.finalState?.metrics;
        return formatActorSummary(`#${index + 1} ${leader.name}`, leader, result, col);
      }).join('\n\n');

      try {
        const { object: cohortVerdict, fromFallback } = await generateValidatedObject({
          provider: simConfig.provider || 'openai',
          model: verdictModel,
          apiKey: apiKeyForProvider(simConfig.provider || 'openai', simConfig),
          schema: CohortVerdictSchema,
          schemaName: 'CohortVerdict',
          prompt: `You are judging a cohort simulation. ${cleanRuns.length} AI commanders with different HEXACO personality profiles led identical worlds through ${turns} turns from the same starting conditions and deterministic seed. Your job is to rank them from best to worst and explain WHY each placed where it did.

ACTOR SUMMARIES (in launch order):

${summaries}

TRADEOFFS TO WEIGH
Tool forging is a cost/capability tradeoff: every forged tool spent a judge LLM call and ate analyst attention; failed forges hurt morale and produced no reusable capability; successful tools let later decisions reason about concrete numbers. A leader who built few tools and reused them many times has a disciplined, cost-efficient signature; a leader who forged many novel tools has an exploratory signature with broader capability surface. Both are valid strategies and your scoring should reflect that trade, not punish either extreme.

Mortality is a cause-specific signal, not a number. The "Mortality" line names HOW each colonist died. Starvation deaths reveal resource-allocation choices; radiation-cancer deaths reveal shielding priorities; despair deaths reveal a colony in psychological freefall. Reference specific causes when they shape the story.

REASONING — populate the "reasoning" field with a numbered breakdown covering:
  (1) Population trajectory across the cohort — which actors held the line, which collapsed?
  (2) Morale + psychological state — which actor's colony held together emotionally?
  (3) Resource efficiency — food, power, infrastructure — which ran leanest, which hit crises?
  (4) Innovation signature — breadth vs depth in the forged toolbox across actors.
  (5) Mortality story — which causes dominated, and what does that say about each actor's priorities?
  (6) The single most impactful divergence across the cohort.
  (7) The full ranking with brief why-this-rank.

Then fill out:
  winner: the name of the top-ranked actor (exact match from one of the names above)
  winnerIndex: the 0-based launch-order index of the winner
  headline: one-line verdict (max 80 chars) grounded in the key cohort divergence
  summary: 2-3 sentences naming the personality + tool-use + mortality pattern that drove the winner's success relative to the rest of the cohort
  keyDivergence: the single most impactful difference between the winner and the next-best actor
  rankings: every actor as a separate entry, with rank (1 = winner), actorName, actorIndex, scores { survival, prosperity, morale, innovation } each 0-10, and a 1-2 sentence rationale specific to that actor`,
        });
        if (fromFallback) {
          console.log('  Cohort verdict schema fallback; skipping broadcast');
          // Schema-validation fallback exhausted on the cohort verdict
          // call. The original code logged this and silently dropped
          // the broadcast, leaving the dashboard with no verdict and
          // no explanation — exactly the user-reported "I see no
          // victor for cohort runs" failure. Cheap-tier models
          // (gpt-5.4-nano, claude-haiku-4-5) hit the rankings array
          // schema (min 2 entries, each with rank + scores + rationale)
          // more often than they hit the simpler pair Verdict schema,
          // so cohort runs lost the banner where pair runs kept it.
          broadcast('verdict_skipped', {
            mode: 'cohort',
            reason: 'generation_failed',
            detail: 'Schema validation fallback exhausted',
            actorCount: cleanRuns.length,
          });
        } else {
          broadcast('cohort_verdict', {
            ...cohortVerdict,
            actors: cleanRuns.map(({ leader, index }) => ({
              name: leader.name,
              archetype: leader.archetype,
              unit: leader.unit,
              index,
            })),
            finalStats: cleanRuns.map(({ leader, index, result }) => ({
              actorName: leader.name,
              actorIndex: index,
              population: result.finalState?.metrics?.population,
              morale: result.finalState?.metrics?.morale,
              food: result.finalState?.metrics?.foodMonthsReserve,
              power: result.finalState?.metrics?.powerKw,
              modules: result.finalState?.metrics?.infrastructureModules,
              science: result.finalState?.metrics?.scienceOutput,
              tools: result.totalToolsForged,
            })),
          });
          console.log(`\n  COHORT VERDICT: ${cohortVerdict.headline}`);
          console.log(`  Winner: ${cohortVerdict.winner} (#${cohortVerdict.winnerIndex + 1})`);
          console.log(`  ${cohortVerdict.summary}\n`);
        }
      } catch (verdictErr) {
        const detail = verdictErr instanceof Error ? verdictErr.message : String(verdictErr);
        console.log('  Cohort verdict generation failed:', verdictErr);
        // Surface the failure to the dashboard so the user isn't left
        // staring at a finished run with no verdict + no explanation.
        // Without this event, a transient LLM error during the cohort
        // ranking call (rate limit, schema fallback exhausted) just
        // logged server-side and the UI silently dropped the banner.
        broadcast('verdict_skipped', {
          mode: 'cohort',
          reason: 'generation_failed',
          detail,
          actorCount: cleanRuns.length,
        });
      }
    } else if (verdictModel && cleanRuns.length > MAX_COHORT_VERDICT_N) {
      console.log(`  [batch] Cohort verdict skipped: ${cleanRuns.length} actors exceeds MAX_COHORT_VERDICT_N=${MAX_COHORT_VERDICT_N}`);
      broadcast('verdict_skipped', {
        mode: 'cohort',
        reason: 'cohort_too_large',
        actorCount: cleanRuns.length,
        max: MAX_COHORT_VERDICT_N,
      });
    } else if (!verdictModel && cleanRuns.length >= 2) {
      // economics.verdict.mode === 'skip' branch — explicit user choice
      // (the cheap-tier profile turns verdicts off to save spend) but
      // the UI still benefits from a positive signal that "yes the run
      // ended, no verdict on purpose" rather than a missing-banner.
      broadcast('verdict_skipped', {
        mode: 'cohort',
        reason: 'economics_skip',
        actorCount: cleanRuns.length,
      });
    }
  }

  broadcast('complete', {
    timestamp: new Date().toISOString(),
    batch: true,
    ...(allAborted ? { aborted: true } : {}),
  });
}
