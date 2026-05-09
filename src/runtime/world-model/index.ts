/**
 * Paracosm WorldModel façade: a one-object surface over the
 * compiler and orchestrator internals, plus the
 * snapshot + fork API that operationalizes paracosm's CWSM
 * (counterfactual world simulation model) positioning.
 *
 * Why it exists: paracosm positions itself as a structured world model
 * for AI agents (see `docs/positioning/world-model-mapping.md`). The
 * lower-level APIs remain internal building blocks. `WorldModel` is a thin wrapper
 * that lets consumers write code in the same vocabulary the docs use.
 * `fromJson` takes the validated world contract. Prompt, document, and
 * URL authoring should compile into that same contract before reaching
 * the runtime:
 *
 * ```ts
 * import { WorldModel } from 'paracosm';
 *
 * const wm = await WorldModel.fromJson(worldJson, { provider: 'anthropic' });
 * const result = await wm.simulate({ actor: leader, maxTurns: 6, seed: 42 });
 * ```
 *
 * Every method dispatches to the underlying API with the `scenario`
 * slot pinned to this world. Per-call options are passed through
 * verbatim. Nothing here changes orchestrator semantics, kernel
 * behavior, or the returned `RunArtifact` shape.
 *
 * The façade lives in `runtime/` rather than `engine/` because it
 * depends on `runSimulation` + `runBatch`; the engine layer does not
 * import from runtime (one-way dependency).
 *
 * @module paracosm
 */

import { runSimulation, replaySimulation, WorldModelReplayError, type RunOptions, type ActorConfig } from '../orchestrator/index.js';
import type { SimulateOptions, InterveneOptions, BatchOptions, ActorRun } from '../../api/types.js';
import { runBatch, type BatchConfig, type BatchManifest } from '../batch.js';
import { canonicalJson } from '../canonical-json.js';
import { compileScenario } from '../../engine/compiler/index.js';
import { compileFromSeed, type CompileFromSeedInput, type CompileFromSeedOptions } from '../../engine/compiler/compile-from-seed.js';
import type { CompileOptions } from '../../engine/compiler/types.js';
import type { KeyPersonnel } from '../../engine/core/agent-generator.js';
import type { ScenarioPackage } from '../../engine/types.js';
import type { RunArtifact, SubjectConfig, InterventionConfig, SwarmAgent, SwarmSnapshot } from '../../engine/schema/index.js';
import {
  getSwarm as swarmGet,
  swarmByDepartment as swarmGroupByDepartment,
  swarmFamilyTree as swarmGetFamilyTree,
} from '../swarm/index.js';
import type { KernelSnapshot } from '../../engine/core/snapshot.js';
import { z } from 'zod';
import { generateValidatedObject } from '../../llm/generateValidatedObject.js';

/**
 * Options accepted by {@link WorldModel.simulate}. Identical to
 * {@link RunOptions} minus `scenario`, which is pinned to the WorldModel
 * instance.
 */
export type WorldModelSimulateOptions = Omit<RunOptions, 'scenario'>;

/**
 * Options accepted by {@link WorldModel.batch}. Identical to
 * {@link BatchConfig} minus `scenarios`, which is fixed to `[this.scenario]`.
 * Pass `leaders`, `turns`, `seed`, and any other `BatchConfig` fields.
 */
export type WorldModelBatchOptions = Omit<BatchConfig, 'scenarios'>;

/**
 * Options for {@link WorldModel.quickstart}. Every field has a sensible
 * default; callers typically only set `actorCount`.
 */
export interface WorldModelQuickstartOptions {
  /** How many leaders the quickstart should run in parallel. Default 3. Range 2..6. */
  actorCount?: number;
  /** Scenario-level seed for each leader's run. Default: the scenario's
   *  `setup.defaultSeed`, else 42. */
  seed?: number;
  /** Absolute-final turn index for each leader's run. Default: the
   *  scenario's `setup.defaultTurns`. */
  maxTurns?: number;
  /** Whether to embed per-turn kernel snapshots so the results are
   *  fork-eligible. Default true. */
  captureSnapshots?: boolean;
  /** Provider for the leader-generation LLM call and the per-leader
   *  simulation. Default 'anthropic'. */
  provider?: 'openai' | 'anthropic';
  /** Model for the leader-generation LLM call. Default 'claude-sonnet-4-6'. */
  model?: string;
}

/**
 * Shape returned by {@link WorldModel.quickstart}.
 */
export interface WorldModelQuickstartResult {
  /** The scenario the quickstart ran against. */
  scenario: ScenarioPackage;
  /** The actors the LLM generated for this run. */
  actors: ActorConfig[];
  /** One {@link RunArtifact} per actor, in the same order as `actors`. */
  artifacts: RunArtifact[];
  /** Actor + artifact zipped together. Equivalent to
   * `actors.map((a, i) => ({ actor: a, artifact: artifacts[i] }))`.
   * Easier to iterate via `runs.forEach(({ actor, artifact }) => ...)`. */
  runs: ActorRun[];
}

/**
 * Serializable bundle that captures everything needed to reconstruct
 * an equivalent {@link WorldModel} at a specific turn. Round-trips
 * through `JSON.stringify` + `JSON.parse` without data loss.
 *
 * Produced by {@link WorldModel.snapshot} (live run) or implicitly
 * via {@link WorldModel.forkFromArtifact} (disk-persisted run that
 * was created with `captureSnapshots: true`).
 */
export interface WorldModelSnapshot {
  /** Format discriminator; bumped when the shape changes. */
  snapshotVersion: 1;
  /** Kernel state at capture time. */
  kernel: KernelSnapshot;
  /** Run-id the snapshot was captured from, when available. Threaded
   *  into `RunArtifact.metadata.forkedFrom.parentRunId` on the child
   *  run so fork chains reconstruct from stored artifacts. */
  parentRunId?: string;
}

/**
 * Reserved options accepted by {@link WorldModel.fork} and
 * {@link WorldModel.forkFromArtifact}. Current implementations restore
 * only the snapshot at fork time; pass leader, seed, and custom events
 * to the subsequent {@link WorldModel.simulate} call.
 */
/**
 * Shape returned by {@link WorldModel.replay}. `matches=true` iff the
 * fresh kernel snapshots produced by re-execution byte-equal the input
 * artifact's snapshots under canonical JSON. When false, `divergence`
 * carries a JSON-pointer-style first-mismatch path suitable for
 * forensic inspection.
 *
 * The fresh `artifact` has the same shape as the input but with a
 * regenerated `metadata.runId` and freshly-computed
 * `scenarioExtensions.kernelSnapshotsPerTurn`. Other fields copy from
 * the input verbatim.
 */
export interface WorldModelReplayResult {
  artifact: RunArtifact;
  matches: boolean;
  divergence: string;
}

export interface ForkOptions {
  /** Reserved for a future single-call fork API. Pass the leader to
   *  the subsequent `.simulate()` call today. */
  leader?: ActorConfig;
  /** Reserved for a future single-call fork API. Pass the seed to the
   *  subsequent `.simulate()` call today. */
  seed?: number;
  /** Reserved for a future single-call fork API. Pass custom events to
   *  the subsequent `.simulate()` call today. */
  customEvents?: Array<{ turn: number; title: string; description: string }>;
}

/**
 * A compiled, runnable world. Wraps a {@link ScenarioPackage} with
 * convenience methods for simulating single leaders or running a batch.
 *
 * Construct via {@link WorldModel.fromJson} (compile from raw JSON) or
 * {@link WorldModel.fromScenario} (wrap an already-compiled scenario,
 * e.g. `marsScenario`).
 *
 * The underlying scenario is exposed via {@link WorldModel.scenario} as
 * an escape hatch for callers that want the raw {@link ScenarioPackage}.
 *
 * @example Single-leader simulation
 * ```ts
 * import { WorldModel } from 'paracosm';
 * import worldJson from './my-world.json' with { type: 'json' };
 *
 * const wm = await WorldModel.fromJson(worldJson, { provider: 'anthropic' });
 * const artifact = await wm.simulate({ actor: leader, maxTurns: 6, seed: 42 });
 * ```
 *
 * @example Counterfactual branch via fork
 * ```ts
 * const wm = await WorldModel.fromJson(worldJson);
 * const trunk = await wm.simulate({
 *   actor: visionary,
 *   maxTurns: 6, seed: 42, captureSnapshots: true,
 * });
 * const branch = await (await wm.forkFromArtifact(trunk, 3)).simulate({
 *   actor: pragmatist,
 *   maxTurns: 6,
 *   seed: 42,
 * });
 * // branch.metadata.forkedFrom === { parentRunId: trunk.metadata.runId, atTurn: 3 }
 * ```
 *
 * @example Pre-compiled scenario
 * ```ts
 * import { marsScenario } from 'paracosm';
 * import { WorldModel } from 'paracosm';
 *
 * const wm = WorldModel.fromScenario(marsScenario);
 * const artifact = await wm.simulate({ actor: leader, maxTurns: 8 });
 * ```
 */
export class WorldModel {
  /**
   * The underlying compiled scenario. Exposed so callers can reuse the
   * same compiled package across custom integrations.
   */
  public readonly scenario: ScenarioPackage;

  /**
   * Snapshot of the kernel at the end of the most recent successful
   * `simulate()` call. Populated when that simulate() was invoked with
   * `captureSnapshots: true`. Used by {@link WorldModel.snapshot} to
   * emit a {@link WorldModelSnapshot} without requiring callers to
   * plumb the kernel themselves. Undefined otherwise.
   */
  private _lastKernelSnapshot?: KernelSnapshot;

  /**
   * Run id of the most recent successful `simulate()` call. Used by
   * {@link WorldModel.snapshot} to populate
   * {@link WorldModelSnapshot.parentRunId} so child runs record
   * `forkedFrom.parentRunId`.
   */
  private _lastRunId?: string;

  /**
   * When this WorldModel was produced by {@link WorldModel.fork} or
   * {@link WorldModel.forkFromArtifact}, this holds the `forkedFrom`
   * link that the next {@link WorldModel.simulate} call threads into
   * the child RunArtifact's `metadata.forkedFrom`. Cleared after
   * simulate() consumes it.
   */
  private _pendingForkedFrom?: { parentRunId: string; atTurn: number };

  /**
   * When this WorldModel was produced by {@link WorldModel.fork}, this
   * holds the kernel snapshot that {@link WorldModel.simulate} must
   * restore before running. Cleared after simulate() consumes it.
   */
  private _pendingResumeFrom?: KernelSnapshot;

  private constructor(scenario: ScenarioPackage) {
    this.scenario = scenario;
  }

  /**
   * Compile a raw scenario JSON into a runnable {@link WorldModel}.
   *
   * Delegates to {@link compileScenario} under the hood; all
   * {@link CompileOptions} (cache, provider, model, seed ingestion) are
   * supported.
   */
  static async fromJson(
    worldJson: Record<string, unknown>,
    options: CompileOptions = {},
  ): Promise<WorldModel> {
    const scenario = await compileScenario(worldJson, options);
    return new WorldModel(scenario);
  }

  /**
   * Wrap an already-compiled {@link ScenarioPackage} (e.g. `marsScenario`,
   * `lunarScenario`, or any cached result of a prior `compileScenario`
   * call).
   *
   * Pure construction, no I/O.
   */
  static fromScenario(scenario: ScenarioPackage): WorldModel {
    return new WorldModel(scenario);
  }

  /**
   * Compile a world model from prompt, brief, or document text (with an
   * optional domain hint and source URL). Delegates to
   * {@link compileFromSeed}: the LLM proposes a scenario draft against
   * `DraftScenarioSchema`, validates it, then routes it into the existing
   * {@link compileScenario} pipeline so the `seedText` research grounding
   * and hook generation stages still fire. JSON stays the canonical
   * contract; this wrapper only makes unstructured source material a
   * first-class authoring input.
   *
   * @example Quickstart from a pasted brief
   * ```ts
   * const wm = await WorldModel.fromPrompt({
   *   seedText: 'Q3 board brief: the company needs to decide between...',
   *   domainHint: 'corporate strategic decision',
   * }, { provider: 'anthropic' });
   * const result = await wm.quickstart({ actorCount: 3 });
   * ```
   */
  static async fromPrompt(
    seed: CompileFromSeedInput,
    options: CompileFromSeedOptions = {},
  ): Promise<WorldModel> {
    const scenario = await compileFromSeed(seed, options);
    return new WorldModel(scenario);
  }

  // ---------------------------------------------------------------------
  // Swarm inspection
  //
  // The swarm is paracosm's agent population: ~100 named agents with
  // departments, roles, family edges, mood, and short-term memory. Top-
  // level access is `RunArtifact.finalSwarm`. The static helpers below
  // are convenience views over that snapshot.
  // ---------------------------------------------------------------------

  /**
   * Final agent-swarm snapshot from a {@link RunArtifact}, or `undefined`
   * if the run did not produce one (e.g., batch-point modes that bypass
   * the turn loop). Equivalent to reading `artifact.finalSwarm` directly;
   * provided so consumers have a single import surface for swarm access.
   *
   * @example
   * ```ts
   * const result = await wm.simulate(leader, { maxTurns: 6 });
   * const swarm = WorldModel.swarm(result);
   * if (swarm) {
   *   console.log(`T${swarm.turn}: ${swarm.population} agents`);
   *   for (const a of swarm.agents) console.log(`  ${a.name} · ${a.department} · ${a.mood}`);
   * }
   * ```
   */
  static swarm(artifact: RunArtifact): SwarmSnapshot | undefined {
    return swarmGet(artifact);
  }

  /**
   * Group the swarm by department. Returns a map keyed by department
   * label; values are the (alive + dead) agents in that department,
   * preserving insertion order from the snapshot. Delegates to
   * {@link import('paracosm/swarm').swarmByDepartment}.
   *
   * Useful for org-chart-style summaries: "Engineering: 18 agents (15
   * alive). Lead: Maria Chen."
   */
  static swarmByDepartment(artifact: RunArtifact): Record<string, SwarmAgent[]> {
    return swarmGroupByDepartment(artifact);
  }

  /**
   * Build a family-tree adjacency map from the swarm: parent agentId →
   * list of direct-descendant agentIds. Edge direction is parent→child;
   * walk the map recursively to render multi-generation trees. Founders
   * (no parent in the swarm) are the roots. Delegates to
   * {@link import('paracosm/swarm').swarmFamilyTree}.
   *
   * Returns an empty object when the run produced no swarm or the
   * scenario does not track family edges.
   */
  static swarmFamilyTree(artifact: RunArtifact): Record<string, string[]> {
    return swarmGetFamilyTree(artifact);
  }

  /**
   * Run a single simulation through this world with the given leader.
   * Delegates to {@link runSimulation} with `scenario` pinned to this
   * instance.
   *
   * `keyPersonnel` is optional for parity with the underlying API; most
   * callers pass `[]` or omit it. The returned {@link RunArtifact} is
   * the universal Zod-validated contract exported from `paracosm/schema`.
   *
   * When this WorldModel was produced by {@link WorldModel.fork} or
   * {@link WorldModel.forkFromArtifact}, the pending
   * `_resumeFrom` + `_forkedFrom` context is threaded into the
   * underlying runSimulation via the internal `_resumeFrom` /
   * `_forkedFrom` fields on {@link RunOptions}. Both are cleared after
   * simulate() consumes them so a second simulate() on the same
   * WorldModel does not double-apply.
   */
  async simulate(
    opts: SimulateOptions,
  ): Promise<RunArtifact> {
    const { actor, keyPersonnel = [], ...options } = opts;
    const resumeFrom = this._pendingResumeFrom;
    const maxTurns = options.maxTurns ?? 12;
    if (resumeFrom && maxTurns <= resumeFrom.turn) {
      throw new Error(
        `WorldModel.fork: maxTurns=${maxTurns} must be greater than fork turn ${resumeFrom.turn}. ` +
        `maxTurns is the absolute final turn index for the resumed run, not the branch length. ` +
        `For a ${maxTurns}-turn branch from turn ${resumeFrom.turn}, pass maxTurns=${resumeFrom.turn + maxTurns}.`,
      );
    }

    const mergedOpts: RunOptions & {
      _forkedFrom?: { parentRunId: string; atTurn: number };
      _resumeFrom?: KernelSnapshot;
    } = {
      ...options,
      scenario: options.scenario ?? this.scenario,
      _forkedFrom: this._pendingForkedFrom,
      _resumeFrom: resumeFrom,
    };
    // Drop the pending context so subsequent simulate calls on the
    // same WorldModel don't double-apply.
    this._pendingForkedFrom = undefined;
    this._pendingResumeFrom = undefined;

    const artifact = await runSimulation(actor, keyPersonnel, mergedOpts as RunOptions);
    this._lastRunId = artifact.metadata.runId;

    // Pull the terminal kernel snapshot from the artifact's embedded
    // per-turn snapshots (populated when captureSnapshots: true was
    // on). When captureSnapshots was off, snapshot() is degraded /
    // unavailable; snapshot() throws with a pointer to the flag.
    const perTurn = (artifact.scenarioExtensions as { kernelSnapshotsPerTurn?: KernelSnapshot[] } | undefined)?.kernelSnapshotsPerTurn;
    if (perTurn && perTurn.length > 0) {
      this._lastKernelSnapshot = perTurn[perTurn.length - 1];
    } else {
      this._lastKernelSnapshot = undefined;
    }
    return artifact;
  }

  /**
   * Simulate an intervention applied to a subject within this world.
   *
   * Sugar over {@link WorldModel.simulate} that names the digital-twin
   * pattern: a subject (a person, organization, system, or biological
   * entity) is held constant, an intervention (a treatment, policy, or
   * action) is applied, and the leader drives the run. The returned
   * RunArtifact carries `subject` and `intervention` for traceability.
   *
   * @param opts Options bag containing the subject, intervention, actor,
   * and normal simulation settings.
   * @returns RunArtifact with `subject` and `intervention` populated.
   *
   * @example
   * ```ts
   * import { WorldModel } from 'paracosm';
   *
   * const wm = await WorldModel.fromJson(scenarioJson);
   * const artifact = await wm.intervene({
   *   subject: { id: 'company', kind: 'organization', attributes: { headcount: 100 } },
   *   intervention: { id: 'layoff', kind: 'policy', description: '25% RIF', parameters: { percent: 25 } },
   *   actor: leader,
   *   maxTurns: 4,
   * });
   * console.log(artifact.subject, artifact.intervention);
   * ```
   */
  async intervene(opts: InterveneOptions): Promise<RunArtifact> {
    return this.simulate(opts);
  }

  /**
   * Run N leaders through this world in parallel via {@link runBatch}.
   * `scenarios` is fixed to `[this.scenario]`; supply `leaders`, `turns`,
   * `seed`, and any other {@link BatchConfig} fields.
   *
   * For N-scenarios-×-M-leaders sweeps that span multiple worlds, call
   * {@link runBatch} directly with an explicit `scenarios` array.
   */
  async batch(options: WorldModelBatchOptions): Promise<BatchManifest> {
    return runBatch({
      ...options,
      scenarios: [this.scenario],
    });
  }

  /**
   * Quickstart: generate N contextual HEXACO leaders for this world and
   * run them in parallel against the same seed. Leaders are produced by
   * a structured-output LLM call (Zod schema with HEXACO bounds); each
   * run is a direct `runSimulation` call so `captureSnapshots: true`
   * flows through verbatim and the results are fork-eligible.
   *
   * Unlike {@link batch}, this path assumes one scenario and same-seed
   * runs across leaders: the entire product value is "same seed,
   * different HEXACO, see divergence".
   *
   * @example
   * ```ts
   * const wm = await WorldModel.fromPrompt({ seedText });
   * const { actors, artifacts } = await wm.quickstart({ actorCount: 3 });
   * artifacts.forEach((a, i) => console.log(actors[i].name, a.fingerprint));
   * ```
   */
  async quickstart(options: WorldModelQuickstartOptions = {}): Promise<WorldModelQuickstartResult> {
    const {
      actorCount = 3,
      seed = this.scenario.setup.defaultSeed ?? 42,
      maxTurns = this.scenario.setup.defaultTurns,
      captureSnapshots = true,
      provider = 'anthropic',
      model = 'claude-sonnet-4-6',
    } = options;

    if (actorCount < 2 || actorCount > 6) {
      throw new Error(`WorldModel.quickstart: actorCount must be between 2 and 6, got ${actorCount}.`);
    }

    const actors = await generateQuickstartActors(this.scenario, actorCount, { provider, model });

    const artifacts = await Promise.all(actors.map(actor => runSimulation(actor, [], {
      scenario: this.scenario,
      maxTurns,
      seed,
      captureSnapshots,
      provider,
    })));

    const runs: ActorRun[] = actors.map((actor, i) => ({ actor, artifact: artifacts[i] }));
    return { scenario: this.scenario, actors, artifacts, runs };
  }

  /**
   * Capture a {@link WorldModelSnapshot} of the state at the end of
   * this WorldModel's most recent `simulate()` call. Requires
   * `simulate(..., { captureSnapshots: true })` on that prior call;
   * throws with a clear pointer otherwise.
   *
   * The returned snapshot is plain JSON-safe; serialize to disk with
   * `JSON.stringify` and reload with `JSON.parse` + `fork()`.
   *
   * @throws Error when this WorldModel has never run simulate(), or
   *   when the last simulate() did not set `captureSnapshots: true`.
   */
  snapshot(): WorldModelSnapshot {
    if (!this._lastKernelSnapshot) {
      throw new Error(
        'WorldModel.snapshot() requires a prior `simulate(..., { captureSnapshots: true })` ' +
        'call on this WorldModel. Either enable snapshot capture on your simulation run or ' +
        'use `forkFromArtifact(artifact, atTurn)` to fork from a stored RunArtifact.',
      );
    }
    return {
      snapshotVersion: 1,
      kernel: this._lastKernelSnapshot,
      parentRunId: this._lastRunId,
    };
  }

  /**
   * Construct a new WorldModel positioned at the snapshot's turn. The
   * new WorldModel has no prior run of its own; calling `.simulate()`
   * on it resumes from the snapshot's kernel state, optionally with a
   * different leader, seed, or custom events.
   *
   * `metadata.forkedFrom` on the subsequent `.simulate()` call's
   * returned RunArtifact is set to
   * `{ parentRunId: snapshot.parentRunId, atTurn: snapshot.kernel.turn }`.
   *
   * The `opts` argument is accepted for API symmetry but not consumed
   * at fork time; the caller passes `opts.leader` / `opts.seed` /
   * `opts.customEvents` through to the subsequent `.simulate()` call
   * directly. A future spec may fold this into a single-call API.
   *
   * @throws Error when `snapshot.kernel.scenarioId !== this.scenario.id`.
   */
  async fork(snapshot: WorldModelSnapshot, opts: ForkOptions = {}): Promise<WorldModel> {
    if (snapshot.kernel.scenarioId !== this.scenario.id) {
      throw new Error(
        `WorldModel.fork: scenario id mismatch. Snapshot was taken against ` +
        `'${snapshot.kernel.scenarioId}' but this WorldModel wraps ` +
        `'${this.scenario.id}'. Cross-scenario forks are not supported.`,
      );
    }
    const child = new WorldModel(this.scenario);
    child._pendingResumeFrom = snapshot.kernel;
    if (snapshot.parentRunId) {
      child._pendingForkedFrom = {
        parentRunId: snapshot.parentRunId,
        atTurn: snapshot.kernel.turn,
      };
    }
    // `opts` (leader / seed / customEvents) are documented at the
    // interface boundary and intended for the subsequent simulate()
    // call; fork() itself only needs the snapshot. Silence
    // unused-parameter warnings explicitly.
    void opts;
    return child;
  }

  /**
   * Convenience: pulls the kernel snapshot at `atTurn` from
   * `artifact.scenarioExtensions.kernelSnapshotsPerTurn` (populated
   * when the parent run was created with `captureSnapshots: true`)
   * and calls {@link WorldModel.fork} with it.
   *
   * @throws Error when the artifact has no embedded per-turn
   *   snapshots (parent wasn't run with `captureSnapshots: true`) or
   *   when `atTurn` is out of range of the available snapshots.
   */
  async forkFromArtifact(artifact: RunArtifact, atTurn: number, opts: ForkOptions = {}): Promise<WorldModel> {
    const perTurn = (artifact.scenarioExtensions as { kernelSnapshotsPerTurn?: KernelSnapshot[] } | undefined)?.kernelSnapshotsPerTurn;
    if (!perTurn || perTurn.length === 0) {
      throw new Error(
        `WorldModel.forkFromArtifact: artifact has no embedded kernel snapshots. ` +
        `Re-run the parent simulation with \`captureSnapshots: true\` on its RunOptions ` +
        `to enable forking from the stored artifact.`,
      );
    }
    const snap = perTurn.find(s => s.turn === atTurn);
    if (!snap) {
      throw new Error(
        `WorldModel.forkFromArtifact: no snapshot at turn ${atTurn}. ` +
        `Available turns: [${perTurn.map(s => s.turn).join(', ')}].`,
      );
    }
    return this.fork(
      {
        snapshotVersion: 1,
        kernel: snap,
        parentRunId: artifact.metadata.runId,
      },
      opts,
    );
  }

  /**
   * Re-execute the kernel transitions captured in `artifact` and report
   * whether today's kernel produces the same snapshots. The audit
   * use case named in the 2026-04-23 positioning spec is now a single
   * API call; pillar 2 (Reproducible) is verifiable in code rather
   * than promised in copy.
   *
   * Implementation re-runs the deterministic between-turn progression
   * hook from each recorded snapshot to the next, captures fresh
   * snapshots, and compares the fresh `kernelSnapshotsPerTurn` array
   * to the input artifact's via canonical JSON. `matches=true` proves
   * the kernel is byte-equal-deterministic for this artifact's transitions.
   *
   * Required preconditions on `artifact`:
   *   - `scenarioExtensions.kernelSnapshotsPerTurn` populated.
   *   - `decisions[]` populated.
   *   - `metadata.scenario.id` matches this WorldModel's scenario.
   *
   * @param artifact The stored RunArtifact to replay.
   * @returns Replay result: `{ artifact, matches, divergence }`.
   * @throws WorldModelReplayError when preconditions fail.
   */
  async replay(artifact: RunArtifact): Promise<WorldModelReplayResult> {
    const fresh = await replaySimulation(this.scenario, artifact);
    const inputSnaps = (artifact.scenarioExtensions as { kernelSnapshotsPerTurn?: KernelSnapshot[] } | undefined)?.kernelSnapshotsPerTurn ?? [];
    const freshSnaps = (fresh.scenarioExtensions as { kernelSnapshotsPerTurn?: KernelSnapshot[] } | undefined)?.kernelSnapshotsPerTurn ?? [];
    if (canonicalJson(inputSnaps) === canonicalJson(freshSnaps)) {
      return { artifact: fresh, matches: true, divergence: '' };
    }
    return {
      artifact: fresh,
      matches: false,
      divergence: firstDivergence(inputSnaps, freshSnaps),
    };
  }
}

/**
 * Compute a first-mismatch JSON-pointer description between two values.
 * Walks both objects in parallel; returns the first path where the
 * canonical-stringified values differ. Returns empty string when values
 * are equal under canonical JSON.
 */
function firstDivergence(a: unknown, b: unknown, path = ''): string {
  if (canonicalJson(a) === canonicalJson(b)) return '';
  if (typeof a !== typeof b || (a === null) !== (b === null) || Array.isArray(a) !== Array.isArray(b)) {
    return `${path || '/'} (structural: ${describeKind(a)} vs ${describeKind(b)})`;
  }
  if (a === null || typeof a !== 'object') {
    return `${path || '/'} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}/length (${a.length} vs ${b.length})`;
    for (let i = 0; i < a.length; i++) {
      const sub = firstDivergence(a[i], b[i], `${path}/${i}`);
      if (sub) return sub;
    }
    return path;
  }
  const aKeys = Object.keys(a as Record<string, unknown>).sort();
  const bKeys = Object.keys(b as Record<string, unknown>).sort();
  for (const k of aKeys) {
    if (!bKeys.includes(k)) return `${path}/${k} (missing in fresh)`;
    const sub = firstDivergence((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`);
    if (sub) return sub;
  }
  for (const k of bKeys) {
    if (!aKeys.includes(k)) return `${path}/${k} (extra in fresh)`;
  }
  return path;
}

function describeKind(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// Re-export the replay error for consumer ergonomics: callers can catch
// it from this module without learning the orchestrator import path.
export { WorldModelReplayError } from '../orchestrator/index.js';

const QuickstartActorSchema = z.object({
  name: z.string().min(2).max(64),
  archetype: z.string().min(2).max(48),
  unit: z.string().min(2).max(64),
  hexaco: z.object({
    openness: z.number().min(0).max(1),
    conscientiousness: z.number().min(0).max(1),
    extraversion: z.number().min(0).max(1),
    agreeableness: z.number().min(0).max(1),
    emotionality: z.number().min(0).max(1),
    honestyHumility: z.number().min(0).max(1),
  }),
  instructions: z.string().min(10).max(400),
});

const QuickstartActorsSchema = z.object({
  actors: z.array(QuickstartActorSchema).min(2).max(6),
});

/**
 * Generate `count` archetypal HEXACO actors for `scenario` via a
 * structured-output LLM call. Exported so the server `/api/quickstart/generate-actors`
 * route can reuse the exact same prompt + schema.
 *
 * @internal
 */
export async function generateQuickstartActors(
  scenario: ScenarioPackage,
  count: number,
  opts: { provider?: string; model?: string } = {},
): Promise<ActorConfig[]> {
  const provider = opts.provider ?? 'anthropic';
  const model = opts.model ?? 'claude-sonnet-4-6';
  const deptRoles = scenario.departments.map(d => `${d.label} (${d.role})`).join(', ');
  const systemPrompt = `You generate archetypal decision-maker profiles for paracosm simulation runs.
Every actor must have a distinct HEXACO profile designed to diverge from the others on at least one high-impact trait (openness, conscientiousness, emotionality).
Names and units match the scenario domain: for a space settlement use space-appropriate names; for a corporate scenario use corporate names.
Instructions are short directives the actor internalizes (one to three sentences).`;
  const prompt = `Scenario: ${scenario.labels.name}
Population: ${scenario.labels.populationNoun}
Settlement: ${scenario.labels.settlementNoun}
Time unit: ${scenario.labels.timeUnitNoun}
Departments under the actor: ${deptRoles}

Generate exactly ${count} archetypal actors. Each one makes recognizably different decisions against the same events.`;

  const result = await generateValidatedObject({
    provider,
    model,
    schema: QuickstartActorsSchema,
    schemaName: 'QuickstartActors',
    systemCacheable: systemPrompt,
    prompt,
    maxRetries: 1,
  });

  return result.object.actors as ActorConfig[];
}
