/**
 * Generate a politics hook from scenario JSON via generateValidatedCode.
 * The politics hook returns delta values for political/social event
 * outcomes.
 *
 * @module paracosm/engine/compiler/generate-politics
 */
import type { GenerateTextFn } from './types.js';
import type { CompilerTelemetry } from './telemetry.js';
import { generateValidatedCode } from './llm-invocations/generateValidatedCode.js';
import { runArrowSync } from './sandbox-runner.js';
import { isParseableArrowSource } from './source-validation.js';

type PoliticsFn = (category: string, outcome: string) => Record<string, number> | null;

function buildSystemBlock(scenarioJson: Record<string, any>): string {
  const labels = scenarioJson.labels ?? {};
  const effects = scenarioJson.effects ?? {};
  const categories = typeof effects === 'object' && !Array.isArray(effects)
    ? Object.keys(effects)
    : [];
  const timeUnit = labels.timeUnitNoun ?? 'tick';
  const politicsKeys = Object.keys((scenarioJson.world?.politics ?? {}) as Record<string, unknown>);
  return `You are generating a politics hook for a simulation engine.

SCENARIO: ${labels.name ?? 'Unknown'} — ${labels.settlementNoun ?? 'settlement'} simulation
EVENT CATEGORIES: ${categories.join(', ')}
TIME UNIT: ${timeUnit}
DECLARED POLITICS KEYS: ${politicsKeys.length ? politicsKeys.join(', ') : '(none declared; hook should return null)'}

Function signature: (category, outcome) => Record<string, number> | null

Return:
- null for non-political categories
- Record<string, number> of politics field deltas for political/social categories

Rules:
1. Success → push toward independence/autonomy
2. Failure → push toward dependency/instability
3. 1-3 politics fields appropriate to this scenario
4. Only return keys listed under DECLARED POLITICS KEYS above; other keys are ignored by the kernel
5. Small deltas (0.01-0.10 for pct, 1-5 for ints)
6. NO external imports`;
}

const userPrompt = 'Return ONLY the arrow function. No markdown fences.';

export function parseResponse(text: string): PoliticsFn | null {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:typescript|ts|javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();
  if (cleaned.endsWith(';')) cleaned = cleaned.slice(0, -1).trim();
  if (!isParseableArrowSource(cleaned)) return null;
  return (category, outcome) =>
    runArrowSync<[string, string], Record<string, number> | null>(cleaned, [category, outcome]);
}

const OUTCOMES = ['risky_success', 'risky_failure', 'conservative_success', 'conservative_failure'];

const NO_POLITICS_KEYS_REASON = 'This scenario declares no politics keys; the hook must return null';

/**
 * The categories of the scenario's `effects`, in either form: the keys of
 * the object form, or the `categoryDefaults` keys of each entry of the
 * array form a saved compile has. This is how the director's prompt reads
 * them (`generate-director.ts`), except that an array entry that is not an
 * object gives no category here instead of throwing.
 */
function effectCategories(scenarioJson: Record<string, any>): string[] {
  const effects = scenarioJson.effects ?? {};
  return typeof effects === 'object' && !Array.isArray(effects)
    ? Object.keys(effects)
    : (effects as any[]).flatMap?.((e: any) => Object.keys(e?.categoryDefaults ?? {})) ?? [];
}

/**
 * The check a generated politics hook must pass before it is kept.
 *
 * The turn loop bounds what one decision's adopted effects move by the
 * largest number each key has in a category table or in what the politics
 * hook returns for any category and outcome (`policyEffectLimits` in
 * `src/runtime/orchestrator/commander-policy.ts`), whatever the key. In a
 * scenario that declares politics keys, one call must give null or an
 * object, as before. In a scenario that declares none, the kernel drops
 * every number the hook returns at an outcome, so those numbers could act
 * only by lifting a limit: the hook is called for `political` and for every
 * category of `effects` with each of the four outcomes, and must return
 * null or an object with no key every time.
 */
function buildSmokeTest(scenarioJson: Record<string, any>): (fn: PoliticsFn) => void {
  const politicsKeys = Object.keys((scenarioJson.world?.politics ?? {}) as Record<string, unknown>);
  if (politicsKeys.length > 0) {
    return (fn) => {
      const political = fn('political', 'risky_success');
      if (political !== null && typeof political !== 'object') {
        throw new Error('Political result must be null or object');
      }
    };
  }
  const categories = [...new Set(['political', ...effectCategories(scenarioJson)])];
  return (fn) => {
    for (const category of categories) {
      for (const outcome of OUTCOMES) {
        const result = fn(category, outcome);
        if (result !== null && typeof result !== 'object') {
          throw new Error('Political result must be null or object');
        }
        if (result !== null && Object.keys(result).length > 0) {
          throw new Error(NO_POLITICS_KEYS_REASON);
        }
      }
    }
  };
}

const fallback: PoliticsFn = () => null;

export interface GeneratePoliticsOptions {
  telemetry?: CompilerTelemetry;
}

export async function generatePoliticsHook(
  scenarioJson: Record<string, any>,
  generateText: GenerateTextFn,
  options: GeneratePoliticsOptions = {},
): Promise<{ hook: PoliticsFn; source: string; attempts: number; fromFallback: boolean }> {
  const result = await generateValidatedCode<PoliticsFn>({
    hookName: 'politics',
    systemCacheable: buildSystemBlock(scenarioJson),
    prompt: userPrompt,
    parse: parseResponse,
    smokeTest: buildSmokeTest(scenarioJson),
    fallback,
    // Valid arrow literal so the cached source survives a parse round-
    // trip. See source-validation.ts.
    fallbackSource: '(_category, _outcome) => null',
    // Politics hook is short (~1000 output tokens typical).
    maxTokens: 2000,
    generateText,
    telemetry: options.telemetry,
  });
  return { hook: result.hook, source: result.source, attempts: result.attempts, fromFallback: result.fromFallback };
}
