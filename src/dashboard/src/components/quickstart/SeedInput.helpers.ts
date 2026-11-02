/**
 * The cost the quickstart form shows before a run: the scenario's
 * compilation and the actors' generation, then each actor's run.
 */
export function estimateQuickstartCostUSD(actorCount: number): number {
  return 0.1 + 0.3 * actorCount;
}
