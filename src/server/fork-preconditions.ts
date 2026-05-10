import { RunArtifactSchema, type RunArtifact } from '../engine/schema/index.js';

export type ForkPreconditionResult =
  | { ok: true; parentArtifact: RunArtifact }
  | { ok: false; statusCode: 400 | 409; error: string; issues?: string[] };

export function validateForkSetupPreconditions(input: {
  parentArtifact: unknown;
  atTurn: number;
  activeScenarioId: string;
  activeRunInProgress: boolean;
}): ForkPreconditionResult {
  const parentResult = RunArtifactSchema.safeParse(input.parentArtifact);
  if (!parentResult.success) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Fork parent artifact is not a valid RunArtifact.',
      issues: parentResult.error.issues.slice(0, 5).map(issue => issue.message),
    };
  }

  const parent = parentResult.data;
  const parentScenarioId = parent.metadata.scenario.id;
  if (parentScenarioId !== input.activeScenarioId) {
    return {
      ok: false,
      statusCode: 400,
      error: `Fork parent scenario '${parentScenarioId}' does not match active scenario '${input.activeScenarioId}'. Cross-scenario forks are not supported.`,
    };
  }

  const snapshots = (parent.scenarioExtensions as { kernelSnapshotsPerTurn?: unknown[] } | undefined)
    ?.kernelSnapshotsPerTurn;
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Fork parent has no embedded kernel snapshots. Re-run the parent simulation with `captureSnapshots: true` to enable forking.',
    };
  }

  const hasRequestedSnapshot = snapshots.some(snapshot => {
    if (!snapshot || typeof snapshot !== 'object') return false;
    return (snapshot as { turn?: unknown }).turn === input.atTurn;
  });
  if (!hasRequestedSnapshot) {
    return {
      ok: false,
      statusCode: 400,
      error: `Fork parent has no kernel snapshot for turn ${input.atTurn}.`,
    };
  }

  if (input.activeRunInProgress) {
    return {
      ok: false,
      statusCode: 409,
      error: 'Cannot fork while another simulation is running. Wait for the current run to finish or stop it first.',
    };
  }

  return { ok: true, parentArtifact: parent };
}
