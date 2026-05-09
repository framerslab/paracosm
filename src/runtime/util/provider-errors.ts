/**
 * Provider error classifier.
 *
 * LLM-call sites across the orchestrator (director, departments, commander,
 * judge, agent reactions) all catch errors and swallow them so the turn
 * loop can keep going. That is fine for a one-off model blip. It is
 * disastrous when the user's provider credits run out: every LLM call in
 * every turn throws the same error, each one is quietly eaten, and the
 * dashboard reports a "successful" run with blank reports and canned
 * fallback events.
 *
 * This module classifies the error once, surfaces it to the orchestrator
 * via a shared abort flag, and lets the server forward a `provider_error`
 * SSE event to the dashboard for a persistent banner, so the user knows
 * immediately what happened and what to do about it.
 *
 * @module paracosm/runtime/util/provider-errors
 */

/** Categorized reason for an LLM call failure. */
export type ProviderErrorKind =
  /** API key invalid / missing / revoked. User fix: replace the key. */
  | 'auth'
  /** Account has no remaining credits or exceeded monthly quota.
   *  User fix: add credits / upgrade plan. */
  | 'quota'
  /** Hitting per-minute or per-day rate caps.
   *  User fix: slow down or wait. Different from `quota`: credits still exist. */
  | 'rate_limit'
  /** DNS / fetch / connection failure. User fix: check connectivity. */
  | 'network'
  /** Anything else (malformed request, 500s, timeouts). Not actionable by user. */
  | 'unknown';

/** A classified provider error, forwarded to SSE and the abort flag. */
export interface ClassifiedProviderError {
  kind: ProviderErrorKind;
  /** Which provider the failed call targeted, when we can infer it. */
  provider?: 'openai' | 'anthropic' | 'openrouter' | 'gemini' | string;
  /** Human-readable single-line message. */
  message: string;
  /** URL where the user goes to resolve this (billing page, rate-limit docs). */
  actionUrl?: string;
  /** Truncated copy of the raw error string for support diagnostics. */
  raw: string;
}

/**
 * Classify a thrown error from an LLM call into an actionable category.
 *
 * Matches against:
 *   HTTP status codes (401, 402, 403, 429) that appear in most provider SDK
 *   error messages.
 *   Provider-specific error body signals (`insufficient_quota`,
 *   `credit_balance_too_low`, `rate_limit_exceeded`, etc.).
 *   Network-level error codes (`ECONNREFUSED`, `fetch failed`).
 *
 * The provider field is inferred from message substrings where possible.
 * We deliberately do NOT rely on typed error classes from the AgentOS SDK
 * because different providers wrap their errors differently and the string
 * representation is the most stable signal across SDK versions.
 *
 * @param err The caught value. Can be an Error, string, or anything.
 * @returns A classified error ready to forward over SSE.
 */
export function classifyProviderError(err: unknown): ClassifiedProviderError {
  const raw = stringifyError(err).slice(0, 1000);
  const lower = raw.toLowerCase();
  const provider = inferProvider(lower);

  // --- AUTH: invalid / missing / revoked API key ---
  // Check BEFORE quota because an expired key that also returns 429 should
  // be reported as auth (user fix is different: replace key, not add credits).
  if (
    /\b401\b/.test(raw) ||
    lower.includes('invalid_api_key') ||
    lower.includes('incorrect api key') ||
    lower.includes('authentication_error') ||
    lower.includes('authenticationerror') ||
    lower.includes('invalid x-api-key') ||
    lower.includes('unauthorized')
  ) {
    return {
      kind: 'auth',
      provider,
      message: buildAuthMessage(provider),
      actionUrl: authUrl(provider),
      raw,
    };
  }

  // --- QUOTA: credits exhausted / plan limit hit ---
  // These are the real "pay us more money" signals. 402 is the canonical
  // "Payment Required" status. 403 + insufficient_quota is how OpenAI
  // reports no-credit for a real key. Anthropic uses credit_balance_too_low.
  if (
    /\b402\b/.test(raw) ||
    lower.includes('insufficient_quota') ||
    lower.includes('credit_balance_too_low') ||
    lower.includes('quota_exceeded') ||
    lower.includes('resource_exhausted') ||
    lower.includes('you exceeded your current quota') ||
    lower.includes('billing')
  ) {
    return {
      kind: 'quota',
      provider,
      message: buildQuotaMessage(provider),
      actionUrl: billingUrl(provider),
      raw,
    };
  }

  // --- RATE LIMIT: 429 that is NOT a quota signal ---
  // A plain 429 without insufficient_quota body means per-minute throttling.
  // Credits still exist; user just needs to slow down. We purposely put this
  // AFTER the quota check so OpenAI's 429 + insufficient_quota lands as quota.
  if (
    /\b429\b/.test(raw) ||
    lower.includes('rate_limit_exceeded') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('overloaded_error')
  ) {
    return {
      kind: 'rate_limit',
      provider,
      message: `${providerLabel(provider)} is rate-limiting requests. Wait a moment or reduce concurrency.`,
      raw,
    };
  }

  // --- NETWORK: fetch / DNS / connection failures ---
  if (
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('network error')
  ) {
    return {
      kind: 'network',
      provider,
      message: `Network error contacting ${providerLabel(provider)}. Check your connection.`,
      raw,
    };
  }

  // --- UNKNOWN: everything else, NOT treated as actionable ---
  return {
    kind: 'unknown',
    provider,
    message: raw.length > 160 ? raw.slice(0, 160) + '...' : raw,
    raw,
  };
}

/**
 * Does this classification warrant aborting the entire simulation?
 *
 * Auth and quota errors are terminal: every subsequent LLM call will fail
 * the same way until the user fixes the underlying issue. Continuing wastes
 * compute and floods the logs.
 *
 * Rate limits and transient network errors should NOT abort: AgentOS's
 * fallback + retry layers handle them, and legitimate bursty traffic
 * recovers within the same run.
 */
export function shouldAbortRun(kind: ProviderErrorKind): boolean {
  return kind === 'auth' || kind === 'quota';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringifyError(err: unknown): string {
  if (err == null) return '';
  if (err instanceof Error) return err.stack || err.message || err.toString();
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function inferProvider(lower: string): ClassifiedProviderError['provider'] {
  if (lower.includes('anthropic') || lower.includes('claude')) return 'anthropic';
  if (lower.includes('openai') || lower.includes('gpt-')) return 'openai';
  if (lower.includes('openrouter')) return 'openrouter';
  if (lower.includes('gemini') || lower.includes('google')) return 'gemini';
  return undefined;
}

function providerLabel(provider: ClassifiedProviderError['provider']): string {
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'openrouter') return 'OpenRouter';
  if (provider === 'gemini') return 'Gemini';
  return 'the LLM provider';
}

function buildAuthMessage(provider: ClassifiedProviderError['provider']): string {
  return `${providerLabel(provider)} API key is invalid or missing. Update the key in Settings and try again.`;
}

function buildQuotaMessage(provider: ClassifiedProviderError['provider']): string {
  if (provider === 'openai') {
    return 'OpenAI credits exhausted. Add credits at platform.openai.com/settings/organization/billing and try again.';
  }
  if (provider === 'anthropic') {
    return 'Anthropic credit balance is too low. Add credits at console.anthropic.com/settings/billing and try again.';
  }
  return `${providerLabel(provider)} quota exhausted. Add credits or switch providers to continue.`;
}

function authUrl(provider: ClassifiedProviderError['provider']): string | undefined {
  if (provider === 'openai') return 'https://platform.openai.com/api-keys';
  if (provider === 'anthropic') return 'https://console.anthropic.com/settings/keys';
  return undefined;
}

function billingUrl(provider: ClassifiedProviderError['provider']): string | undefined {
  if (provider === 'openai') return 'https://platform.openai.com/settings/organization/billing';
  if (provider === 'anthropic') return 'https://console.anthropic.com/settings/billing';
  return undefined;
}
