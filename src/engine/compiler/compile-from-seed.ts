/**
 * Prompt/document/URL to paracosm scenario compiler (Quickstart).
 *
 * Given seed text (optionally with a domain hint), an LLM proposes a
 * scenario JSON draft against `DraftScenarioSchema`. The draft routes
 * into the existing `compileScenario` pipeline so the `seedText` research
 * grounding + hook generation still fire. JSON is the canonical contract;
 * this module only provides a convenience entry for callers that start
 * from unstructured source material.
 *
 * @module paracosm/compiler/compile-from-seed
 */
import { z } from 'zod';
import { compileScenario } from './index.js';
import type { CompileOptions } from './types.js';
import type { ScenarioPackage } from '../types.js';
import { apiKeyForProvider, resolveProviderFromCredentials } from '../provider/credentials.js';
import { generateValidatedObject } from '../../llm/generateValidatedObject.js';

/**
 * The subset of a scenario JSON the LLM is asked to propose. Lean on
 * purpose: the compiler's existing pipeline fills in defaults, hooks,
 * and seed-ingested citations; we only need the domain-specific fields.
 */
export const DraftScenarioSchema = z.object({
  id: z.string().min(3).max(64).regex(/^[a-z0-9-]+$/, 'kebab-case ids only'),
  labels: z.object({
    name: z.string().min(2).max(80),
    populationNoun: z.string().min(2).max(32),
    settlementNoun: z.string().min(2).max(32),
    timeUnitNoun: z.string().min(2).max(24),
    currency: z.string().min(1).max(16).optional(),
    // Swappable decision-making entity. Optional so seed drafts that
    // pre-date this field still validate; the compiler defaults it to
    // "actor" / "actors" when absent (engine/compiler/index.ts).
    actorNoun: z.string().min(2).max(32).optional(),
    actorNounPlural: z.string().min(2).max(32).optional(),
  }),
  setup: z.object({
    defaultTurns: z.number().int().min(2).max(12),
    defaultPopulation: z.number().int().min(10).max(1000),
    defaultStartTime: z.number().int(),
    defaultSeed: z.number().int().optional(),
  }),
  departments: z.array(z.object({
    id: z.string().min(2).max(48).regex(/^[a-z0-9-]+$/),
    label: z.string().min(2).max(48),
    role: z.string().min(2).max(80),
    instructions: z.string().min(10).max(400),
  })).min(2).max(8),
  metrics: z.array(z.object({
    id: z.string().min(2).max(32).regex(/^[a-z0-9-]+$/),
    format: z.enum(['number', 'percent', 'currency']).default('number'),
    better: z.enum(['higher', 'lower']).optional(),
  })).min(2).max(12),
  theme: z.string().min(10).max(400).optional(),
});

export type DraftScenario = z.infer<typeof DraftScenarioSchema>;

/** Seed source material + optional domain hint passed by the caller. */
export interface CompileFromSeedInput {
  seedText: string;
  domainHint?: string;
  sourceUrl?: string;
}

/**
 * LLM system prompt for draft generation. Emphasizes domain fit AND
 * names every numeric / format constraint enforced by
 * DraftScenarioSchema so the LLM doesn't waste retries on validation
 * failures the schema would have caught (real-world counts pasted
 * verbatim into defaultPopulation, capitalized ids, instructions
 * bursting past 400 chars, etc.).
 */
const DRAFT_SYSTEM_PROMPT = `You are a scenario architect for paracosm, a structured world-model simulator for AI agents.

Given seed source material, propose a paracosm scenario JSON that matches the domain. The output is validated by Zod; producing any field outside the bounds below will be rejected.

DOMAIN NOUNS
- populationNoun (plural), settlementNoun (singular), timeUnitNoun (singular).
- Examples: submarine -> "crew" / "habitat" / "day". Corporate -> "employees" / "company" / "quarter". Space settlement -> "colonists" / "colony" / "year". Game studio -> "players" / "studio" / "week". Public health -> "residents" / "state" / "day".

ID FIELDS (id, departments[].id, metrics[].id)
- kebab-case ONLY: lowercase letters, digits, hyphens. Length 3-64 (top-level), 2-48 (department), 2-32 (metric).
- WRONG: "Stardrift Online", "Seasonal_Content". RIGHT: "stardrift-online", "seasonal-content".

SETUP
- defaultTurns: integer between 2 and 12. Pick 4-8 for most scenarios.
- defaultPopulation: integer between 10 and 1000. This is a REPRESENTATIVE SAMPLE the simulation will agentize, NOT real-world headcount. A 380,000-MAU MMO becomes defaultPopulation: 200. A nation of millions becomes defaultPopulation: 500. Never paste real counts here.
- defaultStartTime: integer appropriate for the domain (year for space, quarter index for corporate, day index for daily-cadence sims, etc.).

DEPARTMENTS (2-8 entries)
- label: 2-48 chars human-readable.
- role: 2-80 chars short title.
- instructions: 10-400 chars MAX. Keep terse and action-oriented.

METRICS (2-12 entries)
- format: one of "number", "percent", "currency".
- better (optional): "lower" for a metric that improves as it falls (a churn rate, a defect count, a risk). Omit it for the rest.
- Pick the metrics the leader actually steers on, not every available stat.

LABELS
- name: 2-80 chars, prose-y title for the scenario as a whole.
- currency (optional): 1-16 chars, e.g. "USD".

Keep all labels natural language. Leave hooks, citations, and implementation details to downstream compilation.`;

/** Internal options, a subset of `CompileOptions` that `compileFromSeed` actually reads. */
export interface CompileFromSeedOptions extends CompileOptions {
  /** Override the provider for the draft-generation LLM call. Default: 'anthropic'. */
  draftProvider?: string;
  /** Override the model for the draft-generation LLM call. Default: 'claude-sonnet-4-6'. */
  draftModel?: string;
}

/**
 * Compile a scenario from seed source material. Calls the LLM to
 * propose a `DraftScenario`, validates it via Zod, then routes into
 * the existing `compileScenario` pipeline with `seedText` threading
 * through for research grounding.
 *
 * Retries up to 3 times on Zod-validation failure. The first failure
 * usually surfaces as an off-bound numeric (defaultPopulation pasted
 * from a real-world headcount) or a non-kebab id; the explicit
 * constraints in DRAFT_SYSTEM_PROMPT plus the retry budget recover
 * cleanly in practice.
 *
 * Wraps ObjectGenerationError with a more actionable message that
 * preserves the raw model output so the caller can see what the LLM
 * tried to produce.
 *
 * @throws Error when the LLM fails to produce a valid draft after the
 *   retry budget is exhausted. Wraps any ObjectGenerationError so the
 *   message names the field bounds that likely tripped validation.
 */
export async function compileFromSeed(
  input: CompileFromSeedInput,
  options: CompileFromSeedOptions = {},
): Promise<ScenarioPackage> {
  const provider = resolveProviderFromCredentials(
    (options.draftProvider ?? options.provider) as CompileOptions['provider'],
    options,
    'anthropic',
  );
  const model = options.draftModel ?? options.model ?? 'claude-sonnet-4-6';

  const hint = input.domainHint ? `\n\nDomain hint: ${input.domainHint}` : '';
  const prompt = `Seed source material:\n"""\n${input.seedText}\n"""${hint}\n\nRespond with a scenario JSON that matches DraftScenarioSchema. Remember: defaultPopulation must be 10-1000 (representative sample, NOT the real-world headcount from the seed). All ids must be kebab-case. Department instructions must be 10-400 chars.`;

  let result: Awaited<ReturnType<typeof generateValidatedObject<typeof DraftScenarioSchema>>>;
  try {
    result = await generateValidatedObject({
      provider,
      model,
      schema: DraftScenarioSchema,
      schemaName: 'DraftScenario',
      systemCacheable: DRAFT_SYSTEM_PROMPT,
      prompt,
      maxRetries: 3,
      apiKey: apiKeyForProvider(provider, options),
    });
  } catch (err) {
    const rawText = (err as { rawText?: string }).rawText;
    const baseMessage = err instanceof Error ? err.message : String(err);
    const failureHint = ' (common cause: defaultPopulation > 1000 from a real-world count, or a non-kebab id like "Stardrift Online")';
    const wrapped = new Error(`compileFromSeed: ${baseMessage}.${failureHint}${rawText ? `\nLast LLM raw output:\n${rawText.slice(0, 800)}` : ''}`);
    (wrapped as Error & { cause?: unknown }).cause = err;
    throw wrapped;
  }

  // Route the validated draft into the existing compiler with
  // seedText grounding so the research + hook-generation stages
  // still pull citations and generate TypeScript.
  return compileScenario(result.object as unknown as Record<string, unknown>, {
    ...options,
    seedText: input.seedText,
    seedUrl: input.sourceUrl,
  });
}
