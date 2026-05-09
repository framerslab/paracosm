export interface HumanizeInput {
  actorName: string;
  decision: string;
  outcome: string;
  deaths: number;
  dominantCause: string | null;
  moraleDelta: number;
}

/**
 * Build a natural-language outcome string for the turn banner.
 * Deterministic, no LLM call. Composes from decision first clause,
 * risky/safe framing, death count with cause, and an optional morale
 * beat. Replaces user-facing "Safe Success" / "Risky Failure" enum
 * labels that read as internal jargon in the dashboard.
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

  const lossClause = input.deaths > 0 && input.dominantCause
    ? `, ${input.deaths} lost to ${input.dominantCause}`
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
