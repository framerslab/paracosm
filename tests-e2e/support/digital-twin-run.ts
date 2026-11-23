/**
 * One Digital Twin run as the engine emits it: two turns of events in the
 * shape `runSimulation` hands its `onEvent` callback, each carrying the
 * cumulative `_cost` the engine stamps on it, and the artifact the run
 * returns. The stub server and the end-to-end spec share it, so what the
 * spec counts is what the server was handed.
 */

/** A subject id that makes the stub engine throw after its first event. */
export const TWIN_ENGINE_FAILS = 'twin-engine-fails';
/** A subject id that makes the stub engine take 150 ms between events, as a model-backed run takes seconds. */
export const TWIN_ENGINE_SLOW = 'twin-engine-slow';
export const TWIN_ENGINE_ERROR = 'stub engine failed';

export interface TwinEvent {
  type: string;
  leader: string;
  data: Record<string, unknown>;
}

export function twinEvents(leader: string, turns = 2): TwinEvent[] {
  let calls = 0;
  const event = (type: string, data: Record<string, unknown>): TwinEvent => {
    calls += 1;
    return { type, leader, data: { ...data, _cost: { totalTokens: calls * 100, totalCostUSD: calls / 1000, llmCalls: calls } } };
  };
  const events: TwinEvent[] = [];
  for (let turn = 1; turn <= turns; turn += 1) {
    const at = { turn, time: turn };
    const metrics = { hba1c: 7.8 - turn / 10, population: 1, morale: 0.8 };
    events.push(
      event('turn_start', { ...at, title: `Week ${turn * 4} labs`, crisis: 'Follow-up labs are in.', births: 0, deaths: 0, metrics }),
      event('event_start', { ...at, eventIndex: 0, totalEvents: 1, title: `Week ${turn * 4} labs`, description: 'Follow-up labs are in.', category: 'clinical' }),
      event('specialist_start', { ...at, department: 'endocrinology', eventIndex: 0 }),
      event('specialist_done', {
        ...at, department: 'endocrinology', eventIndex: 0, summary: `Turn ${turn}: HbA1c is falling.`,
        citations: 1, citationList: [], risks: [], recommendedActions: [],
        forgedTools: [{ name: 'dose_titration_model', approved: true }],
      }),
      event('decision_pending', { ...at, eventIndex: 0 }),
      event('decision_made', { ...at, eventIndex: 0, decision: 'Hold the dose.', rationale: 'Labs are improving.', reasoning: '', selectedPolicies: [] }),
      event('outcome', { ...at, eventIndex: 0, outcome: 'conservative_success', category: 'clinical', emergent: false, systemDeltas: {} }),
      event('turn_done', { ...at, metrics, statuses: {}, environment: {}, toolsForged: 1, totalEvents: 1 }),
      event('systems_snapshot', { ...at, agents: [], population: 1, morale: 0.8, births: 0, deaths: 0 }),
    );
  }
  return events;
}

/** The rows a page shows for twinEvents: every event but decision_made, which the page folds into the outcome. */
export const twinRows = (events: TwinEvent[]): number => events.filter(e => e.type !== 'decision_made').length;

export function twinArtifact(subject: unknown, intervention: unknown): Record<string, unknown> {
  return {
    metadata: { runId: 'twin-stub-run', scenario: { id: 't2d-glp1-protocol', name: 'T2D + GLP-1 Care' }, mode: 'turn-loop', startedAt: '2026-11-02T00:00:00.000Z', seed: 11 },
    subject,
    intervention,
    finalState: { metrics: { hba1c: 7.6, population: 1, morale: 0.8 } },
    trajectory: {
      timepoints: [1, 2].map(turn => ({ time: turn, label: `Turn ${turn}`, worldSnapshot: { metrics: { hba1c: 7.8 - turn / 10 } } })),
    },
    cost: { totalUSD: 0.018, llmCalls: 18 },
    fingerprint: { summary: 'cautious' },
  };
}
