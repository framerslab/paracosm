/**
 * Generate a progression hook from scenario JSON via generateValidatedCode.
 * The progression hook applies between-turn health/status changes based
 * on the scenario's environment and domain.
 *
 * @module paracosm/engine/compiler/generate-progression
 */
import type { ProgressionHookContext } from '../types.js';
import type { GenerateTextFn } from './types.js';
import type { CompilerTelemetry } from './telemetry.js';
import { generateValidatedCode } from './llm-invocations/generateValidatedCode.js';
import { runProgressionSync } from './sandbox-runner.js';
import { isParseableArrowSource } from './source-validation.js';

type ProgressionFn = (ctx: ProgressionHookContext) => void;

function buildSystemBlock(scenarioJson: Record<string, any>): string {
  const labels = scenarioJson.labels ?? {};
  const env = scenarioJson.world?.environment ?? {};
  const depts = (scenarioJson.departments ?? []).map((d: any) => d.id).join(', ');
  return `You are generating a between-turn progression hook for a simulation engine.

SCENARIO: ${labels.name ?? 'Unknown'} — ${labels.settlementNoun ?? 'settlement'} simulation
POPULATION NOUN: ${labels.populationNoun ?? 'members'}
SETTLEMENT: ${labels.settlementNoun ?? 'settlement'}
ENVIRONMENT VARIABLES: ${JSON.stringify(env, null, 2)}
DEPARTMENTS: ${depts}

Function signature: (ctx: ProgressionHookContext) => void
ctx shape:
- ctx.agents: array of { core: { marsborn, birthTime, name }, health: { alive, boneDensityPct, cumulativeRadiationMsv, psychScore } }
- ctx.timeDelta: number (time since last turn, in the scenario's time unit)
- ctx.yearsDelta: number (the same step in years; may be absent, then use ctx.timeDelta)
- ctx.time, ctx.turn, ctx.startTime: number (in the scenario's time unit)
- ctx.rng: { chance(p): bool, next(): number, pick<T>(arr): T, int(min, max): number }

Rules:
1. Only modify health on ALIVE agents (check c.health.alive)
2. Domain-appropriate degradation for this scenario
3. Multiply yearly effects by (ctx.yearsDelta ?? ctx.timeDelta)
4. Use Math.max/Math.min to keep: boneDensityPct in [0,100], psychScore in [0,1], cumulativeRadiationMsv >= 0
5. NO external imports, NO require
6. Use ctx.rng.chance(p) for probabilistic effects, not Math.random`;
}

const userPrompt = `Return ONLY the complete arrow function. No markdown fences. Example:
(ctx) => { for (const c of ctx.agents) { if (!c.health.alive) continue; /* effects */ } }`;

/**
 * Parse the LLM response into a sandboxed callable. The returned function
 * delegates each invocation to {@link runProgressionSync}, which executes
 * the code in a hardened node:vm context (`codeGeneration: { strings: false }`,
 * dangerous globals undefined, wall-clock timeout) and merges any
 * mutations to `ctx.agents` back onto the host references.
 *
 * No host-side `new Function()` evaluation: the only host-realm parse
 * happens lazily inside the sandbox runner on the first invocation.
 */
export function parseResponse(text: string): ProgressionFn | null {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:typescript|ts|javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();
  if (cleaned.endsWith(';')) cleaned = cleaned.slice(0, -1).trim();
  if (!isParseableArrowSource(cleaned)) return null;
  return (ctx: ProgressionHookContext) => {
    runProgressionSync(cleaned, ctx as unknown as { agents: Array<Record<string, unknown>> });
  };
}

function smokeTest(fn: ProgressionFn): void {
  const testColonists = [
    { core: { marsborn: false, birthTime: 2010, name: 'Test' }, health: { alive: true, boneDensityPct: 95, cumulativeRadiationMsv: 100, psychScore: 0.7 }, career: {}, social: {}, narrative: {}, hexaco: {} },
    { core: { marsborn: false, birthTime: 2010, name: 'Dead' }, health: { alive: false, boneDensityPct: 80, cumulativeRadiationMsv: 50, psychScore: 0.5 }, career: {}, social: {}, narrative: {}, hexaco: {} },
  ];
  fn({
    agents: testColonists as any,
    timeDelta: 4,
    time: 2045,
    turn: 3,
    startTime: 2035,
    rng: { chance: () => false, next: () => 0.5, pick: (arr: any) => arr[0], int: (min: number, _max: number) => min },
  } as ProgressionHookContext);
}

const fallback: ProgressionFn = () => {};

export interface GenerateProgressionOptions {
  telemetry?: CompilerTelemetry;
}

export async function generateProgressionHook(
  scenarioJson: Record<string, any>,
  generateText: GenerateTextFn,
  options: GenerateProgressionOptions = {},
): Promise<{ hook: ProgressionFn; source: string; attempts: number; fromFallback: boolean }> {
  const result = await generateValidatedCode<ProgressionFn>({
    hookName: 'progression',
    systemCacheable: buildSystemBlock(scenarioJson),
    prompt: userPrompt,
    parse: parseResponse,
    smokeTest,
    fallback,
    // Must be a valid arrow function literal: cached when the LLM
    // exhausts retries, and re-parsed by `parseResponse` on next load.
    // Prior bug: a comment string parsed as syntax error and crashed
    // the sandbox at simulate-time. See source-validation.ts.
    fallbackSource: '(_ctx) => {}',
    // Progression is an arrow function that mutates metrics state, roughly 1500
    // output tokens typical; 4000 caps runaway yap without risking
    // mid-function truncation.
    maxTokens: 4000,
    generateText,
    telemetry: options.telemetry,
  });
  return { hook: result.hook, source: result.source, attempts: result.attempts, fromFallback: result.fromFallback };
}
