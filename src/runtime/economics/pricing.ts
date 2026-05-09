/**
 * Provider pricing table + per-site rate lookup, extracted from
 * orchestrator.ts.
 *
 * Per-million-token pricing (USD). Verified against openai.com/api/pricing
 * and anthropic.com/pricing on 2026-04-16. Update when provider rate
 * cards change. Cached-input rates are not tracked here; providers with
 * prompt caching bill cached tokens at 10% of uncached input, which
 * shows up under-billed rather than over-billed in these totals.
 *
 * @module paracosm/runtime/economics/pricing
 */

import type { SimulationModelConfig } from '../../engine/types.js';

export type CostSite =
  | 'director'
  | 'commander'
  | 'departments'
  | 'judge'
  | 'reactions'
  | 'other';

export interface ModelRate {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

/** Standard (non-batch, non-regional) rates, 2026-04-16. */
export const MODEL_PRICING: Record<string, ModelRate> = {
  // OpenAI
  'gpt-5.4':                   { input: 2.50, output: 15.00 },
  'gpt-5.4-mini':              { input: 0.75, output: 4.50 },
  'gpt-5.4-nano':              { input: 0.20, output: 1.25 },
  'gpt-4o':                    { input: 2.50, output: 10.00 },
  'gpt-4o-mini':               { input: 0.15, output: 0.60 },
  // Anthropic
  'claude-opus-4-7':           { input: 5.00, output: 25.00 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
};

/** Fallback rate used when a model is missing from the pricing table. */
export const DEFAULT_RATE: ModelRate = { input: 2.50, output: 15.00 };

/**
 * Resolve the rate card the run's default tier will use. Returns the
 * commander's model rate when known, otherwise DEFAULT_RATE. Used when
 * a provider response omits `costUSD` and the tracker has to compute
 * the cost from raw token counts — we bill at commander-tier as a
 * conservative approximation.
 */
export function getDefaultPricing(modelConfig: SimulationModelConfig): ModelRate {
  return MODEL_PRICING[modelConfig.commander] ?? DEFAULT_RATE;
}

/**
 * Build a lookup that maps a pipeline site to the rate card its assigned
 * model bills at. Used for cache-savings math so the dashboard reports
 * USD saved at each site's actual per-token rate (judge on haiku costs
 * less than commander on flagship for the same cache-hit token count).
 */
export function buildPriceForSite(modelConfig: SimulationModelConfig): (site: CostSite) => ModelRate {
  const siteModelMap: Record<CostSite, string> = {
    director: modelConfig.director,
    commander: modelConfig.commander,
    departments: modelConfig.departments,
    judge: modelConfig.judge,
    reactions: modelConfig.agentReactions ?? modelConfig.commander,
    other: modelConfig.commander,
  };
  const fallback = getDefaultPricing(modelConfig);
  return (site: CostSite) => MODEL_PRICING[siteModelMap[site]] ?? fallback;
}
