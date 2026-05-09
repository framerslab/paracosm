/**
 * Per-run cost + token telemetry with per-stage buckets.
 *
 * Extracted from orchestrator.ts so the trackUsage / cache-savings math
 * has one home, testable in isolation from the turn loop. The tracker
 * is stateful (totals accumulate across every tagged LLM call) and
 * returns a buildCostPayload() helper the orchestrator invokes before
 * every SSE emit so the dashboard breakdown modal reflects the latest
 * per-stage split + cache hit rate.
 *
 * Pricing lookup comes from pricing.ts so MODEL_PRICING has one home.
 *
 * @module paracosm/runtime/economics/cost-tracker
 */

import type { SimulationModelConfig } from '../../engine/types.js';
import {
  buildPriceForSite,
  getDefaultPricing,
  type CostSite,
} from '../economics/pricing.js';
import {
  ForgeStatsAggregator,
  type ForgeStats as AgentOSForgeStats,
} from '@framers/agentos';

/** Token + cost rollup for a single pipeline stage across a run. */
export interface CostBucket {
  totalTokens: number;
  totalCostUSD: number;
  calls: number;
  /** Cache-read tokens billed at 0.1× input rate (prompt-cache hit). */
  cacheReadTokens: number;
  /** Cache-write tokens billed at 1.25× input rate (new cache entry). */
  cacheCreationTokens: number;
}

/** Shape of the `usage` field providers return on each LLM call. */
export interface CallUsage {
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  costUSD?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Per-stage entry on the breakdown payload attached to every SSE emit. */
export interface CostBreakdownEntry {
  totalTokens: number;
  totalCostUSD: number;
  calls: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** USD saved vs no-caching run. Negative during turn 1, positive turn 2+. */
  cacheSavingsUSD?: number;
}

/**
 * Per-run forge reliability rollup. Aggregated by the cost tracker so
 * the same SSE payload that ships cost data also ships "how is the
 * judge treating this run's forges". Persists across the run (never
 * decrements, matching the schemaRetries pattern).
 *
 * Identical in shape to AgentOS's {@link AgentOSForgeStats}; aliased so
 * any future drift in the canonical definition propagates automatically.
 */
export type ForgeStats = AgentOSForgeStats;

/**
 * Per-run prompt-cache rollup. Ships alongside forgeStats on every
 * _cost SSE payload so the dashboard can render live cache health.
 * Cache is Anthropic-specific (OpenAI auto-caches prompts >= 1024 tok
 * without surfacing per-call counters), so on OpenAI runs these fields
 * stay zero.
 */
export interface CacheStats {
  /** Total tokens served from the provider's prompt cache this run. */
  readTokens: number;
  /** Total tokens written to the provider's prompt cache this run. */
  creationTokens: number;
  /** USD saved by caching vs a no-cache run. Negative during early
   *  turns while the cache fills; positive once reads amortize. */
  savingsUSD: number;
}

/**
 * Per-run provider-error counters keyed by the classifier's kind.
 *
 * Every LLM call that throws routes through classifyProviderError; we
 * increment the corresponding bucket here whether the run aborts
 * (auth/quota) or keeps going (rate_limit/network/unknown). Aggregated
 * across the ring buffer this becomes a cross-run signal of "is the
 * host key dying today" or "are we being rate-limited hard."
 */
export interface ProviderErrorStats {
  auth: number;
  quota: number;
  rate_limit: number;
  network: number;
  unknown: number;
  /** Total = sum of the five buckets. Kept for dashboard rendering convenience. */
  total: number;
}

/** Aggregate cost payload embedded on every SSE event's `_cost` field. */
export interface CostPayload {
  totalTokens: number;
  totalCostUSD: number;
  llmCalls: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Run-wide USD saved by prompt caching vs a no-cache run. */
  cacheSavingsUSD: number;
  breakdown: Record<string, CostBreakdownEntry>;
  /**
   * Per-schema retry rollup. Populated once sendAndValidate / generateValidatedObject
   * start reporting attempt counts. Only present when at least one
   * schema-validated call completed.
   */
  schemaRetries?: Record<string, { attempts: number; calls: number; fallbacks: number }>;
  /**
   * Per-run forge reliability rollup. Only present when at least one
   * forge attempt (approved or rejected) was captured during the run.
   */
  forgeStats?: ForgeStats;
  /**
   * Per-run prompt-cache rollup. Only present when the provider
   * reported at least one cache read or write this run.
   */
  cacheStats?: CacheStats;
  /**
   * Per-run provider-error counter rollup. Only present when at
   * least one LLM call threw (classified) during the run.
   */
  providerErrors?: ProviderErrorStats;
}

/** Cost tracker bundle returned by createCostTracker. */
export interface CostTracker {
  /** Record token + cost usage from a single LLM call, tagged by site. */
  trackUsage(result: { usage?: CallUsage }, site?: CostSite): void;
  /**
   * Record that a schema-validated call finished — used for retry
   * telemetry. `attempts` is the count returned by the wrapper (1 =
   * first-try success, N = N-1 retries, maxRetries+1 = fallback).
   * Builds a per-schema rollup exposed in `finalCost().schemaRetries`.
   */
  recordSchemaAttempt(schemaName: string, attempts: number, fellBack: boolean): void;
  /**
   * Record one forge attempt's outcome. `approved` true means the judge
   * cleared the tool; false means shape check or judge rejected it.
   * `confidence` is the judge's score for the tool's quality (used only
   * when `approved`; rejection confidence in wrapForgeTool is 0 and
   * would skew averages). `toolName`, when provided, is folded into a
   * per-name Set so the rollup can report unique-tool metrics
   * (eventually-approved vs terminally-rejected) rather than raw
   * attempt counts. `errorReason`, when provided on a rejected attempt,
   * is classified via classifyForgeRejection and binned into
   * rejectionReasons — gives the dashboard the "why" distribution
   * without SSHing logs.
   */
  recordForgeAttempt(approved: boolean, confidence: number, toolName?: string, errorReason?: string): void;
  /**
   * Record one classified provider error. `kind` matches the classifier's
   * ProviderErrorKind (auth / quota / rate_limit / network / unknown).
   * Counting non-terminal errors too (the run continues through rate
   * limits + transient failures) lets operators see retry pressure
   * across runs.
   */
  recordProviderError(kind: 'auth' | 'quota' | 'rate_limit' | 'network' | 'unknown'): void;
  /** Build the _cost payload attached to every SSE event. */
  buildCostPayload(): CostPayload;
  /**
   * Final-run snapshot for the output JSON. Includes a per-schema
   * retry rollup when any schema-validated call reported its attempt
   * count; consumers use this to track LLM-reliability regressions
   * across runs on different models.
   */
  finalCost(): {
    totalTokens: number;
    totalCostUSD: number;
    llmCalls: number;
    schemaRetries?: Record<string, { attempts: number; calls: number; fallbacks: number }>;
    forgeStats?: ForgeStats;
    cacheStats?: CacheStats;
    providerErrors?: ProviderErrorStats;
  };
}

/**
 * Create a per-run cost tracker bound to a specific model config.
 *
 * Cache cost math: Anthropic bills cache_read at 0.10× input (saves
 * 0.90×) and cache_creation at 1.25× (costs +0.25×). Net savings per
 * site = (reads × 0.90 − creates × 0.25) × inputPrice. Turn 1 is a
 * net COST because the cache hasn't amortized. Turn 3+ with reads
 * dominating produces substantial savings.
 *
 * Fallback cost estimate (when provider omits costUSD) uses
 * commander-tier pricing as an approximation. Previously this path
 * ignored cache entirely so heavy-caching runs under-reported billed
 * amount by ~10-15%.
 */
export function createCostTracker(modelConfig: SimulationModelConfig): CostTracker {
  let totalTokens = 0;
  let totalCostUSD = 0;
  let llmCalls = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  /**
   * Per-schema retry rollup. Populated by recordSchemaAttempt when
   * sendAndValidate / generateValidatedObject return with an attempt
   * count. Empty when no schema-validated call site fed results in
   * (older call sites still using plain generateText bypass this).
   */
  const schemaRetries = new Map<string, { attempts: number; calls: number; fallbacks: number }>();
  /**
   * Running forge stats aggregator. Every wrapForgeTool capture feeds
   * through recordForgeAttempt, which delegates to the AgentOS
   * aggregator so SSE consumers see a live approval-rate indicator as
   * the run goes. The aggregator owns the unique-name set bookkeeping,
   * the rejection-reason histogram, and the `uniqueTerminalRejections =
   * |rejectedNames − approvedNames|` math.
   */
  const forgeAggregator = new ForgeStatsAggregator();
  /**
   * Provider-error counters keyed by classifier kind. Incremented on
   * every classified error, not just terminal ones, so rate-limit
   * pressure and transient network errors accumulate too.
   */
  const providerErrors: ProviderErrorStats = {
    auth: 0,
    quota: 0,
    rate_limit: 0,
    network: 0,
    unknown: 0,
    total: 0,
  };

  const defaultPricing = getDefaultPricing(modelConfig);
  const priceForSite = buildPriceForSite(modelConfig);

  const newBucket = (): CostBucket => ({
    totalTokens: 0, totalCostUSD: 0, calls: 0,
    cacheReadTokens: 0, cacheCreationTokens: 0,
  });
  const costBySite: Record<CostSite, CostBucket> = {
    director: newBucket(),
    commander: newBucket(),
    departments: newBucket(),
    judge: newBucket(),
    reactions: newBucket(),
    other: newBucket(),
  };

  const trackUsage: CostTracker['trackUsage'] = (result, site = 'other') => {
    if (!result?.usage) return;
    const tokensThisCall = result.usage.totalTokens ?? 0;
    const callCacheRead = result.usage.cacheReadTokens ?? 0;
    const callCacheCreate = result.usage.cacheCreationTokens ?? 0;
    let costThisCall: number;
    if (typeof result.usage.costUSD === 'number') {
      costThisCall = result.usage.costUSD;
    } else {
      const input = result.usage.promptTokens ?? 0;
      const output = result.usage.completionTokens ?? 0;
      // Use the SITE'S assigned model rate, not the commander's, so a
      // dept call on sonnet without provider-reported costUSD bills at
      // sonnet rates instead of being under-counted at haiku rates
      // (previously `defaultPricing` was commander-tier for every site).
      const sitePricing = priceForSite(site);
      costThisCall =
        (input * sitePricing.input / 1_000_000)
        + (output * sitePricing.output / 1_000_000)
        + (callCacheRead * sitePricing.input * 0.10 / 1_000_000)
        + (callCacheCreate * sitePricing.input * 1.25 / 1_000_000);
    }
    totalTokens += tokensThisCall;
    totalCostUSD += costThisCall;
    llmCalls++;
    cacheReadTokens += callCacheRead;
    cacheCreationTokens += callCacheCreate;
    const bucket = costBySite[site];
    bucket.totalTokens += tokensThisCall;
    bucket.totalCostUSD += costThisCall;
    bucket.calls++;
    bucket.cacheReadTokens += callCacheRead;
    bucket.cacheCreationTokens += callCacheCreate;
  };

  const buildCostPayload: CostTracker['buildCostPayload'] = () => {
    let runCacheSavingsUSD = 0;
    const breakdown: Record<string, CostBreakdownEntry> = {};
    for (const [k, v] of Object.entries(costBySite)) {
      if (v.calls > 0) {
        const sitePricing = priceForSite(k as CostSite);
        const siteSavings =
          ((v.cacheReadTokens * 0.90) - (v.cacheCreationTokens * 0.25))
          * sitePricing.input / 1_000_000;
        runCacheSavingsUSD += siteSavings;
        breakdown[k] = {
          totalTokens: v.totalTokens,
          totalCostUSD: Math.round(v.totalCostUSD * 10000) / 10000,
          calls: v.calls,
          ...(v.cacheReadTokens > 0 ? { cacheReadTokens: v.cacheReadTokens } : {}),
          ...(v.cacheCreationTokens > 0 ? { cacheCreationTokens: v.cacheCreationTokens } : {}),
          ...(Math.abs(siteSavings) >= 0.0001
            ? { cacheSavingsUSD: Math.round(siteSavings * 10000) / 10000 }
            : {}),
        };
      }
    }
    const payload: CostPayload = {
      totalTokens,
      totalCostUSD: Math.round(totalCostUSD * 10000) / 10000,
      llmCalls,
      cacheReadTokens,
      cacheCreationTokens,
      cacheSavingsUSD: Math.round(runCacheSavingsUSD * 10000) / 10000,
      breakdown,
    };
    if (schemaRetries.size > 0) {
      payload.schemaRetries = Object.fromEntries(schemaRetries.entries());
    }
    const forgeSnapshot = forgeAggregator.snapshot();
    if (forgeSnapshot.attempts > 0) {
      payload.forgeStats = forgeSnapshot;
    }
    if (cacheReadTokens > 0 || cacheCreationTokens > 0) {
      payload.cacheStats = {
        readTokens: cacheReadTokens,
        creationTokens: cacheCreationTokens,
        savingsUSD: Math.round(runCacheSavingsUSD * 10000) / 10000,
      };
    }
    if (providerErrors.total > 0) {
      payload.providerErrors = { ...providerErrors };
    }
    return payload;
  };

  const recordSchemaAttempt: CostTracker['recordSchemaAttempt'] = (schemaName, attempts, fellBack) => {
    if (!schemaName) return;
    const existing = schemaRetries.get(schemaName) ?? { attempts: 0, calls: 0, fallbacks: 0 };
    schemaRetries.set(schemaName, {
      attempts: existing.attempts + attempts,
      calls: existing.calls + 1,
      fallbacks: existing.fallbacks + (fellBack ? 1 : 0),
    });
  };

  const recordForgeAttempt: CostTracker['recordForgeAttempt'] = (approved, confidence, toolName, errorReason) => {
    forgeAggregator.recordAttempt(approved, confidence, toolName, errorReason);
  };

  const recordProviderError: CostTracker['recordProviderError'] = (kind) => {
    providerErrors[kind] += 1;
    providerErrors.total += 1;
  };

  const finalCost: CostTracker['finalCost'] = () => {
    const out: ReturnType<CostTracker['finalCost']> = {
      totalTokens,
      totalCostUSD: Math.round(totalCostUSD * 10000) / 10000,
      llmCalls,
    };
    if (schemaRetries.size > 0) {
      out.schemaRetries = Object.fromEntries(schemaRetries.entries());
    }
    const forgeSnapshot = forgeAggregator.snapshot();
    if (forgeSnapshot.attempts > 0) {
      out.forgeStats = forgeSnapshot;
    }
    // Emit cacheStats only when the provider reported at least one
    // cache-related token count. OpenAI runs (which auto-cache but
    // don't surface per-call counters) leave all three at zero, so
    // we skip the payload to avoid noise.
    if (cacheReadTokens > 0 || cacheCreationTokens > 0) {
      // Recompute savings from the per-site breakdown to match the
      // buildCostPayload() rollup. Keeps the two surfaces consistent.
      let savingsUSD = 0;
      for (const [k, v] of Object.entries(costBySite)) {
        if (v.calls > 0) {
          const sitePricing = priceForSite(k as CostSite);
          savingsUSD +=
            ((v.cacheReadTokens * 0.90) - (v.cacheCreationTokens * 0.25))
            * sitePricing.input / 1_000_000;
        }
      }
      out.cacheStats = {
        readTokens: cacheReadTokens,
        creationTokens: cacheCreationTokens,
        savingsUSD: Math.round(savingsUSD * 10000) / 10000,
      };
    }
    if (providerErrors.total > 0) {
      out.providerErrors = { ...providerErrors };
    }
    return out;
  };

  return { trackUsage, recordSchemaAttempt, recordForgeAttempt, recordProviderError, buildCostPayload, finalCost };
}
