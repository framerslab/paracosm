/**
 * The real seed compile, and a run of the scenario it compiles, on a stub
 * model.
 *
 * `compileSeedOnStub` runs the real `compileFromSeed` with the global
 * `fetch` answering as the OpenAI API (tests/runtime/helpers/
 * stub-openai-transport.ts). AgentOS builds every request, checks the
 * draft reply against the draft schema, and the compiler runs every stage:
 * the draft, the seven hooks, the seed extraction. The stub answers each
 * request by its text:
 *
 * - the draft call (its system text opens "You are a scenario architect for
 *   paracosm", src/engine/compiler/compile-from-seed.ts) with the draft the
 *   test gives;
 * - the seed extraction (its prompt opens "You are analyzing a document to
 *   extract domain knowledge", src/engine/compiler/seed-ingestion.ts) with
 *   the extraction the test gives;
 * - each code hook, by the first line of its system block, with a small
 *   function that passes that hook's smoke test for any world, or with text
 *   that is no hook (`hooks: 'none'`);
 * - the director and milestone prompts, whose system blocks open as the
 *   hooks' do, with `{}`, or with the text that is no hook under
 *   `hooks: 'none'`; either way those two are the compiler's own fallbacks;
 * - anything else with `{}`.
 *
 * `runCompiledOnStub` runs the real `runSimulation` in a compiled scenario
 * on the same transport, answering the commander's decision prompt with a
 * recorded decision that takes the option asked for.
 *
 * No network is reached and nothing is paid. When a compile or a run fails,
 * its error lists every request the stub received and the reply it sent, so
 * one read of a failed run shows which request the stub did not serve.
 */
import { readFileSync } from 'node:fs';
import { compileFromSeed } from '../../../../src/engine/compiler/compile-from-seed.js';
import { createCompilerTelemetry, type CompilerTelemetrySnapshot } from '../../../../src/engine/compiler/telemetry.js';
import type { ScenarioPackage } from '../../../../src/engine/types.js';
import type { RunArtifact } from '../../../../src/engine/schema/index.js';
import { runSimulation } from '../../../../src/runtime/orchestrator/index.js';
import {
  stubFailure,
  withStubOpenAi,
  type StubExchange,
  type StubReply,
  type StubRequest,
} from '../../../runtime/helpers/stub-openai-transport.js';
import { decisionTitleOf, reactionReply, recordedAriaReply } from '../../../runtime/helpers/stub-model-mars-run.js';

/** The provider, model and key the Mars helper runs on in CI; the key reaches only the stub. */
const PROVIDER = 'openai' as const;
const MODEL = 'gpt-4o';
const API_KEY = 'placeholder-key-for-a-test';

/** A file of tests/fixtures/compiler/, parsed. */
export function loadCompilerFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../../fixtures/compiler/${name}`, import.meta.url), 'utf-8'));
}

/** The seed text the compile is given when a test names none: two sentences about the orchard. */
export const ORCHARD_SEED_TEXT = 'A family orchard on a hillside grows apples through four seasons a year. '
  + 'Its growers weigh each harvest against the health of the soil and the prices the buyers offer.';

/** The opening of the draft call's system prompt (src/engine/compiler/compile-from-seed.ts). */
const DRAFT_MARK = 'You are a scenario architect for paracosm';
/** The opening of the seed extraction's prompt (src/engine/compiler/seed-ingestion.ts). */
const EXTRACTION_MARK = 'You are analyzing a document to extract domain knowledge';
/** How every hook's system block opens (src/engine/compiler/generate-*.ts). */
const HOOK_MARK = 'You are generating ';

/** True for the draft call. */
export const isDraftRequest = (request: StubRequest): boolean => request.system.includes(DRAFT_MARK);
/** True for the seed extraction. */
export const isExtractionRequest = (request: StubRequest): boolean => request.text.includes(EXTRACTION_MARK);

/**
 * A working function for each code hook, by the first line of its system
 * block. Each passes its hook's smoke test whatever metrics the world
 * holds: the fingerprint and the department prompt read only the keys
 * `finalState.metrics` and `ctx.state.metrics` hold.
 */
const WORKING_HOOKS: ReadonlyArray<readonly [mark: string, source: string]> = [
  ['You are generating a between-turn progression hook', '(ctx) => {}'],
  ['You are generating a department prompt hook', "(ctx) => ['Scores held: ' + Object.keys(ctx.state.metrics).join(', ')]"],
  [
    'You are generating a timeline fingerprint hook',
    "(finalState) => { const held = Object.keys(finalState.metrics).length; const breadth = held > 2 ? 'broad' : 'narrow'; return { breadth, summary: breadth + ' (' + held + ' scores held)' }; }",
  ],
  ['You are generating a politics hook', '(category, outcome) => null'],
  ['You are generating a reaction context hook', "(colonist, ctx) => 'Steady after the last turn.'"],
];

/** Each code hook a working function, or every hook prompt text that is no hook. */
export type StubHooks = 'working' | 'none';

function compileReply(draft: unknown, extraction: unknown, hooks: StubHooks): StubReply {
  const draftText = JSON.stringify(draft);
  const extractionText = JSON.stringify(extraction);
  return (request) => {
    if (isDraftRequest(request)) return draftText;
    if (isExtractionRequest(request)) return extractionText;
    if (request.system.includes(HOOK_MARK)) {
      if (hooks === 'none') return 'not a hook';
      return WORKING_HOOKS.find(([mark]) => request.system.includes(mark))?.[1] ?? '{}';
    }
    return '{}';
  };
}

/** What a seed compile on the stub gives. */
export interface SeedCompileOnStub {
  scenario: ScenarioPackage;
  /** The compile's telemetry: each hook's attempts and fallbacks. */
  telemetry: CompilerTelemetrySnapshot;
  /** Every request the stub received, in order, with the reply it sent. */
  seen: StubExchange[];
}

/**
 * Compile a scenario with the real `compileFromSeed`, the stub answering the
 * draft call with `draft` and the extraction with `extraction` (by default
 * tests/fixtures/compiler/extraction-orchard.json). Web search and the disk
 * cache are off.
 */
export async function compileSeedOnStub(options: {
  draft: unknown;
  seedText?: string;
  extraction?: unknown;
  hooks: StubHooks;
}): Promise<SeedCompileOnStub> {
  const telemetry = createCompilerTelemetry();
  const reply = compileReply(options.draft, options.extraction ?? loadCompilerFixture('extraction-orchard.json'), options.hooks);
  return withStubOpenAi(reply, async (seen) => {
    try {
      const scenario = await compileFromSeed({ seedText: options.seedText ?? ORCHARD_SEED_TEXT }, {
        provider: PROVIDER,
        model: MODEL,
        draftProvider: PROVIDER,
        draftModel: MODEL,
        apiKey: API_KEY,
        cache: false,
        webSearch: false,
        telemetry,
      });
      return { scenario, telemetry: telemetry.snapshot(), seen };
    } catch (err) {
      throw stubFailure('compileFromSeed on the stub model', err, seen);
    }
  });
}

/** The leader of a run on the stub: every HEXACO trait at one half. */
const LEADER = {
  name: 'Rowan Hale',
  archetype: 'The Steward',
  unit: 'Orchard One',
  hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
  instructions: 'Lead the settlement through each turn and choose one option for every event.',
};

/** What a run on the stub gives. */
export interface CompiledRunOnStub {
  artifact: RunArtifact;
  /** The title of each decision prompt the stub answered, in order. */
  decisions: string[];
}

/**
 * Run a compiled scenario with the real `runSimulation`: the leader above,
 * the scenario's first two departments, the Mars helper's provider, key and
 * models, and the turn loop's snapshots on. The stub answers the
 * commander's decision prompt (it carries `You MUST include
 * "selectedOptionId"`, src/runtime/orchestrator/index.ts) with Aria Chen's
 * recorded "Legacy Assessment" reply from
 * tests/fixtures/mars-live-decisions-2026-11.json, its `selectedOptionId`
 * set to `take`; a reaction batch with the reply the Mars helper gives one;
 * anything else with `{}`.
 */
export async function runCompiledOnStub(
  scenario: ScenarioPackage,
  options: { take: string; seed: number; turns: number; population: number },
): Promise<CompiledRunOnStub> {
  const recorded = recordedAriaReply('Legacy Assessment');
  if (!recorded) throw new Error('tests/fixtures/mars-live-decisions-2026-11.json holds Aria Chen\'s "Legacy Assessment" reply');
  const decisionText = JSON.stringify({ ...recorded, selectedOptionId: options.take });
  const decisions: string[] = [];
  const reply: StubReply = (request) => {
    const reaction = reactionReply(request.lastUser);
    if (reaction) return reaction.reply;
    const title = decisionTitleOf(request.lastUser);
    if (title === null) return '{}';
    decisions.push(title);
    return decisionText;
  };
  const departments = (scenario.departments ?? []).slice(0, 2).map(d => d.id);
  return withStubOpenAi(reply, async (seen) => {
    try {
      const artifact = await runSimulation(LEADER as never, [], {
        scenario,
        maxTurns: options.turns,
        seed: options.seed,
        initialPopulation: options.population,
        activeDepartments: departments as never,
        captureSnapshots: true,
        provider: PROVIDER,
        apiKey: API_KEY,
        models: { commander: MODEL, departments: MODEL, judge: MODEL, director: MODEL, agentReactions: MODEL },
      });
      return { artifact, decisions };
    } catch (err) {
      throw stubFailure(`runSimulation in ${scenario.id} on the stub model`, err, seen);
    }
  });
}
