/**
 * Prompt/document/URL to paracosm scenario compiler (Quickstart).
 *
 * Given seed text (optionally with a domain hint), an LLM proposes a
 * scenario draft against `DraftScenarioSchema`: the domain's nouns, its
 * departments, its metrics with each one's start and range, and the
 * category tables its events use. `seedDraftToScenarioJson` turns the
 * draft into a scenario JSON whose world holds every declared score, and
 * that JSON routes into the existing `compileScenario` pipeline so the
 * `seedText` research grounding + hook generation still fire. JSON is the
 * canonical contract; this module only provides a convenience entry for
 * callers that start from unstructured source material.
 *
 * @module paracosm/compiler/compile-from-seed
 */
import { z } from 'zod';
import { compileScenario } from './index.js';
import { seedDraftToScenarioJson } from './seed-draft-world.js';
import { validateSeedWorld } from './validate.js';
import type { CompileOptions } from './types.js';
import type { ScenarioPackage } from '../types.js';
import { apiKeyForProvider, resolveProviderFromCredentials } from '../provider/credentials.js';
import { generateValidatedObject } from '../../llm/generateValidatedObject.js';

/**
 * A field that never fails the draft: a value of the wrong type reads as
 * absent, and the normalizer gives the field its default. Optional on the
 * outside, so the provider's strict schema lets the model leave it out;
 * `catch` on the inside, so a wrong type on a route with no provider-side
 * schema does not cost a draft call.
 */
const lenientString = () => z.string().optional().catch(undefined).optional();
/** As {@link lenientString}, for a number. */
const lenientNumber = () => z.number().optional().catch(undefined).optional();

/** One entry of a category table: the change an event of that kind brings to one metric. */
const DraftEffectEntrySchema = z.object({
  metric: z.string(),
  change: z.number(),
});

/** One category table. An array of these, not a record: a record takes the schema out of strict mode. */
const DraftEffectTableSchema = z.object({
  category: z.string(),
  // A malformed entry reads as undefined and the normalizer drops it; the
  // table's other entries stay.
  entries: z.array(DraftEffectEntrySchema.optional().catch(undefined)),
});

/**
 * The subset of a scenario JSON the LLM is asked to propose. Lean on
 * purpose: the compiler's existing pipeline fills in defaults, hooks,
 * and seed-ingested citations; we only need the domain-specific fields.
 *
 * The fields that say where a metric starts, what bounds it and what its
 * events bring carry no size or range check here. Every rule on them
 * lives in `seedDraftToScenarioJson`, which repairs and never rejects, so
 * none of them can fail a draft.
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
    // Years in one time unit, for a unit the kernel does not know by its
    // word (it knows year, quarter, month, week, day and hour).
    yearsPerTimeUnit: z.number().positive().max(1000).optional(),
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
    label: lenientString(),
    unit: lenientString(),
    initial: lenientNumber(),
    min: lenientNumber(),
    max: lenientNumber(),
  })).min(2).max(12),
  // Lenient as the metric fields are. A malformed table reads as undefined
  // and the normalizer drops it; the other tables stay.
  effects: z.array(DraftEffectTableSchema.optional().catch(undefined)).optional().catch(undefined).optional(),
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
- yearsPerTimeUnit (optional): years in one timeUnitNoun, only when that unit is not a year, quarter, month, week, day or hour (a season is 0.25). Omit it for those.

DEPARTMENTS (2-8 entries)
- label: 2-48 chars human-readable.
- role: 2-80 chars short title.
- instructions: 10-400 chars MAX. Keep terse and action-oriented.

METRICS (2-12 entries, the most important first: the first four show in the header)
- format: one of "number", "percent", "currency".
- better (optional): "lower" for a metric that improves as it falls (a churn rate, a defect count, a risk). Omit it for the rest.
- label: 2-48 chars, the name a reader sees ("Soil health").
- initial: where the metric stands on day one, a real figure for this domain.
  - percent: the percentage itself, on a 0 to 100 scale. 65 means 65%. Do NOT write a fraction (0.65).
  - number: the figure in its own unit (a stock of 500, an index of 40 out of 100). Start it at 1 or more, or at 0 for a count that starts empty; write a share or a rate as a percent metric.
  - currency: the amount in the scenario's currency (2400000).
- unit (optional, number and currency only): at most 16 chars ("tonnes", "kW", "points"). A percent needs none.
- min, max (optional, number and currency only): a floor or a ceiling the metric cannot pass. Give max only where the metric truly has one (a score out of 100). Leave max out for a stock, a count or an amount that can keep growing.
- The ids "population" (the head count) and "morale" (the mood, a percent) name values the engine keeps itself. Declare them only if the leader steers on them.
- Pick the metrics the leader actually steers on, not every available stat.

EFFECTS (3-8 entries): the kinds of event this world faces, and what each brings
- category: kebab-case, 2-32 chars, a kind of event ("supply", "regulation", "market", "safety").
- entries (1-4): what an event of this kind brings when the response is ordinary and competent.
  - metric: the id of one of your metrics, or "morale". Not "population".
  - change: the amount added to that metric, in the metric's own scale. Positive raises it, negative lowers it. For a percent metric write points (4 for four points).
  - Keep each change modest: about a twentieth of where the metric starts, never more than a twelfth. A bold response that works brings about two and a half times as much. A failed response loses a gain, and makes a cost up to four times larger.
  - Give each kind of event a trade-off where the domain has one: a gain on one metric and a cost on another. A cost is a change against the metric's better direction.
- Every metric must appear in at least one category.

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
 * propose a `DraftScenario`, validates it via Zod, turns it into a
 * scenario JSON whose world holds every declared score
 * (`seedDraftToScenarioJson`), then routes into the existing
 * `compileScenario` pipeline with `seedText` threading through for
 * research grounding. The categories the knowledge bundle maps are then
 * the category tables' keys, so every event the director is offered has
 * a table.
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
  const prompt = `Seed source material:\n"""\n${input.seedText}\n"""${hint}\n\nRespond with a scenario JSON that matches DraftScenarioSchema. Remember: defaultPopulation must be 10-1000 (representative sample, NOT the real-world headcount from the seed). All ids must be kebab-case. Department instructions must be 10-400 chars. Give every metric its starting value, and list the kinds of event with what each brings.`;

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

  // The draft becomes a scenario JSON that declares a world. Each default
  // and repair prints one line, as seed ingestion prints its own. The check
  // holds that JSON to the seed path's rules; an error there is a fault in
  // the normalizer, so it is printed and the compile goes on.
  const { scenario, notes } = seedDraftToScenarioJson(result.object);
  for (const note of notes) console.log(`  [draft] ${note.message}`);
  for (const error of validateSeedWorld(scenario).errors) console.log(`  [draft] invariant: ${error}`);

  // Route the scenario JSON into the existing compiler with seedText
  // grounding so the research + hook-generation stages still pull
  // citations and generate TypeScript.
  const compiled = await compileScenario(scenario, {
    ...options,
    seedText: input.seedText,
    seedUrl: input.sourceUrl,
  });

  // The director is told its category must be one the knowledge bundle
  // maps, and an event reaches a table by exact key. The seed extraction
  // adds categories in free text, which no table carries, so the mapping is
  // rebuilt on the tables' keys: each keeps the topics it was left with, a
  // key with none takes every topic (a milestone reads research by its
  // category alone), and every other key goes. The topics are untouched.
  const merged = compiled.knowledge?.categoryMapping ?? {};
  const topics = Object.keys(compiled.knowledge?.topics ?? {});
  const categoryMapping: Record<string, string[]> = {};
  for (const key of Object.keys(scenario.effects as Record<string, unknown>)) {
    const kept = Object.prototype.hasOwnProperty.call(merged, key) ? merged[key] : [];
    categoryMapping[key] = kept.length > 0 ? [...kept] : [...topics];
  }
  return { ...compiled, knowledge: { ...compiled.knowledge, categoryMapping } };
}
