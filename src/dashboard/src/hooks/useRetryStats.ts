/**
 * Fetch /retry-stats (cross-run schema + forge reliability rollup)
 * from the server. Manual-refresh only; does not poll. Used by
 * CostBreakdownModal to show a RECENT RUNS panel that updates when
 * the modal opens and when a run completes.
 *
 * @module paracosm/cli/dashboard/hooks/useRetryStats
 */
import { useCallback, useEffect, useState } from 'react';

export interface RetryStatsSchemaBucket {
  calls: number;
  attempts: number;
  fallbacks: number;
  avgAttempts: number;
  fallbackRate: number;
  runsPresent: number;
}

export interface RetryStatsForges {
  totalAttempts: number;
  approved: number;
  rejected: number;
  approvalRate: number;
  avgApprovedConfidence: number;
  /** Unique tool names attempted across the window. */
  totalUniqueNames: number;
  /** Unique tool names that got approved at least once. */
  totalUniqueApproved: number;
  /** Unique tool names only ever rejected (never approved). */
  totalUniqueTerminalRejections: number;
  /** totalUniqueApproved / totalUniqueNames. The "eventually-approved"
   *  rate — closer to the real quality signal than raw approvalRate. */
  uniqueApprovalRate: number;
  /** Aggregated rejection-reason histogram across the window. Use the
   *  distribution to measure whether prompt fixes targeting a specific
   *  failure mode actually cut that bucket. */
  rejectionReasons: {
    schema_extra_field: number;
    shape_check: number;
    parse_error: number;
    judge_correctness: number;
    other: number;
  };
  runsPresent: number;
}

export interface RetryStatsCaches {
  totalReadTokens: number;
  totalCreationTokens: number;
  totalSavingsUSD: number;
  /** readTokens / (readTokens + creationTokens). Healthy > 0.7. */
  readRatio: number;
  runsPresent: number;
}

export interface RetryStatsProviderErrors {
  auth: number;
  quota: number;
  rate_limit: number;
  network: number;
  unknown: number;
  total: number;
  runsPresent: number;
}

export interface RetryStatsResponse {
  runCount: number;
  schemas: Record<string, RetryStatsSchemaBucket>;
  forges?: RetryStatsForges;
  caches?: RetryStatsCaches;
  providerErrors?: RetryStatsProviderErrors;
}

export interface UseRetryStatsResult {
  data: RetryStatsResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Configurable fetch URL for tests; production uses same-origin /retry-stats. */
export const RETRY_STATS_ENDPOINT = '/retry-stats';

/**
 * Fetch /retry-stats once on mount, expose manual refresh().
 *
 * @param enabled When false, skips the initial fetch (useful when the
 *        modal is closed — avoids firing requests on every dashboard mount).
 */
export function useRetryStats(enabled: boolean = true): UseRetryStatsResult {
  const [data, setData] = useState<RetryStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(RETRY_STATS_ENDPOINT, { credentials: 'same-origin' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = await res.json() as RetryStatsResponse;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchOnce();
  }, [enabled, fetchOnce]);

  return { data, loading, error, refresh: fetchOnce };
}
