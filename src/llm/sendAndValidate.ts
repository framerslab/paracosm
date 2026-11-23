/**
 * Session-aware schema-validated wrapper over an AgentOS session's
 * `.send()` call. Adds a retry-with-Zod-feedback loop while preserving
 * the session's accumulating conversation history.
 *
 * Why not use AgentOS generateObject for commander / department reports?
 * Those agents rely on session memory — the commander remembers prior
 * events, its own rationale, and the promotion decisions it made at
 * turn 0; dept heads remember their prior analyses and forged tools.
 * generateObject is one-shot and would discard that memory. This wrapper
 * keeps session.send() as the transport and layers Zod validation on top.
 *
 * The retry message is sent as a new user turn in the SAME session, so
 * the model's own prior malformed output is already in its immediate
 * context when it receives the corrective message. That is what makes
 * the retry self-correcting rather than blind.
 *
 * @module paracosm/llm/sendAndValidate
 */
import { extractJson, ObjectGenerationError } from '@framers/agentos';
import type { ZodType, ZodError, z } from 'zod';

export interface SessionLike {
  send: (prompt: string) => Promise<{ text: string; usage?: any }>;
}

export interface SendAndValidateOptions<T extends ZodType> {
  session: SessionLike;
  prompt: string;
  schema: T;
  /** Human-readable schema name for fallback telemetry (e.g. 'CommanderDecision'). */
  schemaName?: string;
  maxRetries?: number;
  onUsage?: (r: { usage?: any }) => void;
  onProviderError?: (err: unknown) => void;
  /**
   * Fires when schema validation exhausts retries and the wrapper falls
   * back. Separate from `onProviderError` so callers can distinguish
   * model misbehavior on schema from quota / auth failures.
   */
  onValidationFallback?: (details: { rawText: string; schemaName?: string; err: unknown }) => void;
  /**
   * Once the retries are spent, each reply's parsed JSON goes here before
   * the fallback, newest first, until one returns a result: that result is
   * the call's (`salvaged`, not a fallback), and `undefined` passes to the
   * next older reply. A reply that was no JSON is skipped. With none kept,
   * the fallback applies.
   */
  salvage?: (parsed: unknown) => z.infer<T> | undefined;
  fallback?: z.infer<T>;
}

export interface SendAndValidateResult<T> {
  object: T;
  fromFallback: boolean;
  rawText: string;
  /**
   * Total attempts it took to produce a valid result (or to exhaust
   * retries when `fromFallback` is true). 1 = first-try success,
   * 2 = one retry, etc. Allows the orchestrator to roll up per-schema
   * retry rates into the run's cost/quality telemetry.
   */
  attempts: number;
  /**
   * True when the result is a reply `salvage` kept after the retries were
   * spent; `rawText` is then that reply's text, which may be older than
   * the last one.
   */
  salvaged: boolean;
}

const MAX_ZOD_ERRORS_IN_FEEDBACK = 5;

function summarizeZodErrors(err: ZodError | undefined): string {
  if (!err) return '(unknown validation error)';
  const issues = err.issues.slice(0, MAX_ZOD_ERRORS_IN_FEEDBACK);
  const lines = issues.map(i => `- ${i.path.join('.') || '<root>'}: ${i.message}`);
  if (err.issues.length > MAX_ZOD_ERRORS_IN_FEEDBACK) {
    lines.push(`(${err.issues.length - MAX_ZOD_ERRORS_IN_FEEDBACK} more issues omitted)`);
  }
  return lines.join('\n');
}

function buildRetryPrompt(err: ZodError | undefined, parseError?: string): string {
  if (parseError) {
    return `Your previous response was not valid JSON (${parseError}). Return ONLY a valid JSON object matching the schema. No markdown, no code fences, no explanation.`;
  }
  return `Your previous JSON did not match the required schema. Validation errors:\n${summarizeZodErrors(err)}\n\nReturn ONLY the corrected JSON object. No markdown, no code fences, no explanation.`;
}

export async function sendAndValidate<T extends ZodType>(
  opts: SendAndValidateOptions<T>,
): Promise<SendAndValidateResult<z.infer<T>>> {
  const maxRetries = opts.maxRetries ?? 2;
  let lastError: ZodError | undefined;
  let lastText = '';
  let lastParseError: string | undefined;
  /** Every reply that parsed as JSON, oldest first, for `salvage`. */
  const parsedReplies: Array<{ parsed: unknown; text: string }> = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const prompt = attempt === 0
      ? opts.prompt
      : buildRetryPrompt(lastError, lastParseError);

    const r = await opts.session.send(prompt);
    opts.onUsage?.({ usage: r.usage });
    lastText = r.text;
    lastParseError = undefined;

    // extractJson returns the JSON SUBSTRING (or null), so we still
    // need to JSON.parse it before handing to Zod. Validation errors
    // from JSON.parse flow back into the retry prompt.
    const jsonStr = extractJson(r.text);
    if (jsonStr === null) {
      lastParseError = 'no JSON object or array found in response';
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      lastParseError = (parseErr as Error).message;
      continue;
    }

    parsedReplies.push({ parsed, text: r.text });
    const validation = opts.schema.safeParse(parsed);
    if (validation.success) {
      return { object: validation.data, fromFallback: false, rawText: r.text, attempts: attempt + 1, salvaged: false };
    }
    lastError = validation.error;
  }

  if (opts.salvage) {
    // The newest reply that can be kept: a model's last reply is not
    // always its best (a retry can come back as prose with no JSON).
    for (let i = parsedReplies.length - 1; i >= 0; i--) {
      const kept = opts.salvage(parsedReplies[i].parsed);
      if (kept !== undefined) {
        return { object: kept, fromFallback: false, rawText: parsedReplies[i].text, attempts: maxRetries + 1, salvaged: true };
      }
    }
  }

  const err = new ObjectGenerationError(
    `Validation failed after ${maxRetries + 1} attempts`,
    lastText,
    lastError,
  );
  opts.onProviderError?.(err);
  if (opts.fallback !== undefined) {
    opts.onValidationFallback?.({
      rawText: lastText,
      schemaName: opts.schemaName,
      err,
    });
    return { object: opts.fallback, fromFallback: true, rawText: lastText, attempts: maxRetries + 1, salvaged: false };
  }
  throw err;
}
