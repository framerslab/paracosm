/** The texts the runner writes when a decision or a department report call fails. */
const RUNNER_FALLBACK_TEXT = [
  / decision unavailable; defer to department consensus\.$/,
  / report unavailable this turn\.$/,
];

/**
 * Whether a decision, its rationale or reasoning, or a department report's
 * prose is model-written. A record with field-level source answers from
 * it. A record saved before the runner recorded source has no list, and
 * its text is the model's unless it is empty or the runner's fallback text.
 */
export function isAiWrittenPassage(
  source: { aiWrittenFields?: unknown } | Record<string, unknown> | undefined,
  field: string,
  text: unknown,
): boolean {
  if (Array.isArray(source?.aiWrittenFields)) return source.aiWrittenFields.includes(field);
  if (typeof text !== 'string') return false;
  const passage = text.trim();
  return passage.length > 0 && !RUNNER_FALLBACK_TEXT.some(pattern => pattern.test(passage));
}
