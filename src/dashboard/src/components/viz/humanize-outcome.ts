export interface HumanizeInput {
  actorName: string;
  decision: string;
  outcome: string;
  /** Every death of the turn, whatever its cause. */
  deaths: number;
  /** The cause with the most deaths, when the turn names its causes. */
  dominantCause: string | null;
  /**
   * The deaths under `dominantCause` alone. When it is fewer than `deaths`
   * the turn had several causes and the line gives both counts. Left out,
   * every death is read as the dominant cause's.
   */
  dominantDeaths?: number;
  moraleDelta: number;
}

/**
 * Build a natural-language outcome string for the turn banner.
 * Deterministic, no LLM call. Composes from decision first clause,
 * risky/safe framing, death count with cause, and an optional morale
 * beat. Replaces user-facing "Safe Success" / "Risky Failure" enum
 * labels that read as internal jargon in the dashboard.
 *
 * The loss clause never credits one cause with deaths it did not take: a
 * turn whose deaths share a cause reads "3 lost to radiation cancer", and a
 * turn with several reads "3 lost, 2 to radiation cancer".
 */
export function humanizeOutcome(input: HumanizeInput): string {
  const firstClause = (input.decision || '').split(/[.;]/)[0].trim();
  const shortDecision = firstClause.length > 80
    ? firstClause.slice(0, 77) + '...'
    : firstClause;
  const isRisky = input.outcome.startsWith('risky');
  const isSuccess = input.outcome.endsWith('success');

  const verb = shortDecision.length === 0
    ? 'held position'
    : isRisky
    ? (isSuccess ? 'gambled on' : 'took the risk of')
    : 'chose';

  const target = shortDecision.length === 0
    ? ''
    : shortDecision
        .replace(/^(select|implement|issue|move|expand|reduce|slow|initiate|start|deliver)\s+/i, '')
        .replace(/\s+$/, '');

  const core = target.length > 0
    ? `${input.actorName} ${verb} ${target.toLowerCase()}`
    : `${input.actorName} ${verb}`;

  const severalCauses = typeof input.dominantDeaths === 'number'
    && input.dominantDeaths > 0
    && input.dominantDeaths < input.deaths;
  const lossClause = input.deaths > 0 && input.dominantCause
    ? (severalCauses
      ? `, ${input.deaths} lost, ${input.dominantDeaths} to ${input.dominantCause}`
      : `, ${input.deaths} lost to ${input.dominantCause}`)
    : input.deaths > 0
    ? `, ${input.deaths} lost`
    : '';

  const moraleClause = input.moraleDelta <= -0.08
    ? '; morale cracked'
    : input.moraleDelta >= 0.08
    ? '; morale steadied'
    : '';

  return `${core}${lossClause}${moraleClause}`;
}
