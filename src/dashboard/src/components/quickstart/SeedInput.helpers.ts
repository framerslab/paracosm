/**
 * The cost the quickstart form shows before a run: the scenario's
 * compilation and the actors' generation, then each actor's run. The
 * rate per actor is the mean of the four hosted demo runs measured on 30
 * October and 1 November 2026 (0.2898, 0.4499, 0.5609 and 1.0529 USD).
 */
export function estimateQuickstartCostUSD(actorCount: number): number {
  return 0.1 + 0.6 * actorCount;
}
