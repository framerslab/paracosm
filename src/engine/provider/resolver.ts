/**
 * Provider resolution with environment-aware fallback.
 *
 * The landing-page example, tutorials, and most first-run usage hard-code
 * `provider: 'anthropic'`. When a user runs that example without setting
 * ANTHROPIC_API_KEY, the agentos provider init succeeds silently, then
 * every LLM call fails on auth and retries forever, producing nothing but
 * repeated provider-init log lines with no clear signal about what went
 * wrong. This resolver fixes that by inspecting the env once, up front:
 *
 * - Requested provider has a key in env: use it unchanged.
 * - Requested provider has no key, but a different provider does: fall
 *   through to that provider with a single loud warning line so the user
 *   knows what happened.
 * - No key for any supported provider: throw a clear error naming the
 *   env vars to set, rather than hanging in a retry loop.
 *
 * The resolver is env-only and has no side effects beyond the warning
 * log, so it is safe to call at the top of every run. Process.env access
 * is guarded so browser bundles degrade to "requested provider" without
 * inspecting globals.
 *
 * @module paracosm/engine/provider/resolver
 */
import type { LlmProvider } from '../types.js';

const ENV_KEYS: Record<LlmProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

/** Providers to try when the requested one is missing its key, in priority order. */
const FALLBACK_ORDER: LlmProvider[] = ['openai', 'anthropic'];

function hasKey(provider: LlmProvider, env: NodeJS.ProcessEnv | undefined): boolean {
  if (!env) return false;
  const value = env[ENV_KEYS[provider]];
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Thrown when no supported provider has an API key in the environment.
 * Carries structured detail so callers (dashboard, CLI, tests) can branch
 * on it without string-matching the message.
 */
export class ProviderKeyMissingError extends Error {
  readonly code = 'PARACOSM_PROVIDER_KEY_MISSING';
  readonly requested: LlmProvider;
  readonly tried: LlmProvider[];
  constructor(requested: LlmProvider, tried: LlmProvider[]) {
    const envList = tried.map(p => ENV_KEYS[p]).join(' or ');
    super(
      `No provider API key found in the environment. ` +
      `You requested provider '${requested}'. ` +
      `Set ${envList} and retry. ` +
      `(To bypass env inspection entirely, pass your own { generateText } on CompileOptions, ` +
      `or construct your own AgentOS session and wire it through.)`,
    );
    this.name = 'ProviderKeyMissingError';
    this.requested = requested;
    this.tried = tried;
  }
}

export interface ResolvedProviderChoice {
  /** The provider to actually use for this run. */
  provider: LlmProvider;
  /** True when the returned provider differs from what the caller requested. */
  fellBack: boolean;
  /** The provider the caller originally asked for. */
  requested: LlmProvider;
}

export interface ResolveProviderOptions {
  /** Explicit apiKey disables env inspection for the requested provider. */
  apiKey?: string | null;
  /** Inject env for tests. Defaults to `process.env` when available. */
  env?: NodeJS.ProcessEnv;
  /** Suppress the fallback warning log (tests, library callers). */
  silent?: boolean;
  /**
   * Never move to another provider: a requested provider with no key throws
   * `ProviderKeyMissingError` naming that provider alone.
   */
  stayOnProvider?: boolean;
}

/**
 * Return the provider to actually use. When the requested provider has
 * no key available, fall through to the next provider that does. Throws
 * `ProviderKeyMissingError` if no supported provider is configured.
 */
export function resolveProviderWithFallback(
  requested: LlmProvider,
  options: ResolveProviderOptions = {},
): ResolvedProviderChoice {
  const env = options.env ?? (typeof process !== 'undefined' ? process.env : undefined);

  // Explicit key on options wins: the caller is telling us they have auth
  // sorted, don't inspect env.
  if (options.apiKey && options.apiKey.trim().length > 0) {
    return { provider: requested, fellBack: false, requested };
  }

  if (hasKey(requested, env)) {
    return { provider: requested, fellBack: false, requested };
  }

  if (options.stayOnProvider) {
    throw new ProviderKeyMissingError(requested, [requested]);
  }

  for (const candidate of FALLBACK_ORDER) {
    if (candidate === requested) continue;
    if (hasKey(candidate, env)) {
      if (!options.silent) {
        console.warn(
          `[paracosm] ${ENV_KEYS[requested]} not set; falling back to provider '${candidate}' ` +
          `(${ENV_KEYS[candidate]} detected). Pass an explicit provider: '${requested}' + ` +
          `{ apiKey } on the options to bypass this fallback.`,
        );
      }
      return { provider: candidate, fellBack: true, requested };
    }
  }

  throw new ProviderKeyMissingError(requested, [requested, ...FALLBACK_ORDER.filter(p => p !== requested)]);
}
