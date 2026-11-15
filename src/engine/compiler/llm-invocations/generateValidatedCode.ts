/**
 * Shared wrapper for TS-code-producing compile hooks (progression,
 * prompts, fingerprint, politics, reactions). Encapsulates the parse +
 * smoke-test + retry + telemetry loop that each hook file used to
 * hand-roll, plus prompt caching and prior-output retry feedback.
 *
 * The retry feedback includes the LLM's prior malformed output truncated
 * to 2000 chars. This lives in the USER prompt, not the SYSTEM block,
 * so it does not invalidate the AgentOS / Anthropic prompt cache on
 * repeat retries across the same compile run.
 *
 * @module paracosm/engine/compiler/llm-invocations/generateValidatedCode
 */
import type { GenerateTextFn } from '../types.js';
import type { CompilerTelemetry } from '../telemetry.js';
import { removedBuiltInNamedIn } from '../own-context.js';

const MAX_PRIOR_OUTPUT_CHARS = 2000;

export interface ValidatedCodeOptions<Fn> {
  /** Used as `compile:<hookName>` in /retry-stats and in error messages. */
  hookName: string;
  /** Stable prefix wrapped with cacheBreakpoint:true. */
  systemCacheable: string;
  /** User-facing prompt; attempt-specific retry hint appended after. */
  prompt: string;
  /** Parse raw text into the target function. Return null on parse failure. */
  parse: (text: string) => Fn | null;
  /** Canonical smoke test. Must throw with a readable message on failure. */
  smokeTest: (fn: Fn) => void;
  /** Fallback function when retries exhaust. */
  fallback: Fn;
  /** Fallback source text for cache-format parity. */
  fallbackSource: string;
  maxRetries?: number;
  /**
   * Completion-token ceiling for each LLM call. Cap tail spend when a
   * model yaps past the expected output size. Unset → provider default
   * (4-8k). Recommended: ~2× typical output tokens for the hook.
   */
  maxTokens?: number;
  generateText: GenerateTextFn;
  telemetry?: CompilerTelemetry;
}

export interface ValidatedCodeResult<Fn> {
  hook: Fn;
  source: string;
  attempts: number;
  fromFallback: boolean;
  failedRawText?: string;
  failedReason?: string;
}

function buildRetryPrompt(originalPrompt: string, priorText: string, reason: string): string {
  const excerpt = priorText.length > MAX_PRIOR_OUTPUT_CHARS
    ? priorText.slice(-MAX_PRIOR_OUTPUT_CHARS)
    : priorText;
  return `${originalPrompt}\n\nPrevious attempt failed: ${reason}\n\nYOUR PRIOR OUTPUT (the code that failed):\n\`\`\`\n${excerpt}\n\`\`\`\n\nFix the specific issue named above. Return ONLY the corrected function. No markdown fences, no explanation.`;
}

export async function generateValidatedCode<Fn>(
  opts: ValidatedCodeOptions<Fn>,
): Promise<ValidatedCodeResult<Fn>> {
  const maxRetries = opts.maxRetries ?? 3;
  let lastRawText = '';
  let lastReason = '';

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const prompt = attempt === 0
      ? opts.prompt
      : buildRetryPrompt(opts.prompt, lastRawText, lastReason);

    const text = await opts.generateText({
      system: [{ text: opts.systemCacheable, cacheBreakpoint: true }],
      prompt,
      maxTokens: opts.maxTokens,
    });
    lastRawText = text;

    const fn = opts.parse(text);
    if (!fn) {
      lastReason = 'Could not parse response into a callable function (markdown wrapper, syntax error, or non-function export)';
      continue;
    }
    // The smoke test takes one path through the hook. A built-in the
    // hook's context does not hold throws on whichever path names it, so
    // a text that names one is asked for again, and the cache never holds
    // a hook its restore check would refuse (cachedHookRefusal, ../index.ts).
    const removed = removedBuiltInNamedIn(text);
    if (removed !== null) {
      lastReason = `The function names ${removed}, which does not exist where it runs. Write it with plain arrays, objects, numbers and strings`;
      continue;
    }
    try {
      opts.smokeTest(fn);
      opts.telemetry?.recordAttempt(opts.hookName, attempt + 1, false);
      return { hook: fn, source: text.trim(), attempts: attempt + 1, fromFallback: false };
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
    }
  }

  opts.telemetry?.recordFallback(opts.hookName, {
    rawText: lastRawText,
    reason: lastReason,
    attempts: maxRetries,
  });
  return {
    hook: opts.fallback,
    source: opts.fallbackSource,
    attempts: maxRetries,
    fromFallback: true,
    failedRawText: lastRawText,
    failedReason: lastReason,
  };
}
