/**
 * What the scenario editor shows when POST /compile is refused.
 *
 * A compile the server takes answers 200 with a stream of events, which the
 * editor reads line by line. A compile it refuses answers one JSON object
 * and no stream: 409 for an id that is taken, 429 past the day's compiles,
 * 400 for a body it cannot read. This reads that answer.
 *
 * @returns The server's `error` message, or the status when the answer
 *   carries none; `null` for an answer that is not a refusal, whose body is
 *   left unread for the caller.
 */
export async function compileRefusal(res: Response): Promise<string | null> {
  if (res.ok) return null;
  try {
    const body = await res.json() as { error?: unknown };
    if (typeof body.error === 'string' && body.error.length > 0) return body.error;
  } catch {
    // Not JSON: the status below is all there is to show.
  }
  return `The compile was refused (HTTP ${res.status}).`;
}
