/**
 * Shared types for the scenario compiler module.
 */

import type { LlmProvider } from '../types.js';
import type { RuntimeCredentialOptions } from '../provider/credentials.js';
import type { CompilerTelemetry } from './telemetry.js';
import type { CompiledHookSources } from './hook-sources.js';

/**
 * Function signature for LLM text generation calls used by compile hooks.
 *
 * Supports two call shapes:
 * - Legacy: pass a raw prompt string (no caching)
 * - Cache-aware: pass `{ system, prompt }` to route the stable prefix
 *   through cacheBreakpoint-tagged system blocks
 *
 * Wrappers in llm-invocations/ always use the cache-aware form; direct
 * callers (CLI scripts, tests) can still use the string form.
 */
export type GenerateTextFn = (
  promptOrOptions:
    | string
    | {
        system?: Array<{ text: string; cacheBreakpoint?: boolean }>;
        prompt: string;
        /**
         * Upper bound on completion tokens for this call. Caps tail spend
         * when a model misbehaves and yaps beyond the intended output
         * size (provider defaults sit at 4-8k tokens). Use ~2× the
         * typical response size so well-behaved calls finish naturally
         * and only runaway generations hit the cap.
         */
        maxTokens?: number;
      },
) => Promise<string>;

/** Options for compileScenario(). */
export interface CompileOptions extends RuntimeCredentialOptions {
  /** LLM provider to use for hook generation. */
  provider?: LlmProvider;
  /** Model name for hook generation. */
  model?: string;
  /** Whether to use disk caching. Default: true. */
  cache?: boolean;
  /** Base directory for the disk cache. Default: '.paracosm/cache'. */
  cacheDir?: string;
  /** Custom generateText function (overrides provider/model). */
  generateText?: GenerateTextFn;
  /** Progress callback for each hook being generated. */
  onProgress?: (hookName: string, status: 'generating' | 'cached' | 'done' | 'fallback') => void;
  /** Prompt, brief, or document text to ingest into the scenario's knowledge bundle via LLM extraction + optional web search. */
  seedText?: string;
  /** URL to fetch and ingest as source material. If set, seedText is ignored. */
  seedUrl?: string;
  /** Enable live web search during seed ingestion. Requires search API keys. Default: true. */
  webSearch?: boolean;
  /** Max web searches during seed ingestion. Default: 5. */
  maxSearches?: number;
  /**
   * Optional telemetry sink that collects per-hook attempt counts and
   * any exhausted-retry fallbacks. Use when you want to surface compile
   * reliability in a dashboard or snapshot into /retry-stats. See
   * {@link CompilerTelemetry}.
   */
  telemetry?: CompilerTelemetry;
  /**
   * Restore a saved compiled scenario instead of compiling it: the server's
   * boot restore sets this for each saved scenario. When `hookSources` were
   * generated under the current compile schema version, every hook is
   * rebuilt from them alone, a record that names no hook included;
   * otherwise, when the disk cache holds one or more hooks of this exact
   * scenario JSON that restore, from those under the model that wrote them.
   * Either way no provider is resolved and no model is called: a hook that
   * source does not hold, or holds in a form the hook runner refuses, gets
   * the compiler's own fallback for it, as the compile that saved the
   * scenario did. With neither, the scenario is compiled as the other
   * options say.
   */
  restore?: { hookSources?: CompiledHookSources };
}
