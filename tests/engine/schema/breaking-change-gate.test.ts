/**
 * Breaking-change CI gate (T6.2). Fails any PR that diverges
 * RunArtifactSchema.shape without bumping RUN_ARTIFACT_SCHEMA_VERSION and
 * regenerating the snapshot fixture together.
 *
 * Failure messages include the shape diff and the exact remediation
 * command (`npm run snapshot:schema`) so the contributor knows how to
 * resolve it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunArtifactSchema } from '../../../src/engine/schema/index.js';
import { RUN_ARTIFACT_SCHEMA_VERSION } from '../../../src/engine/schema/artifact.js';
import { serializeShape, describeShapeDiff } from './shape-utils.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, 'run-artifact-schema-snapshot.json');

interface Fixture { comment?: string; schemaVersion: number; shape: Record<string, string> }

test('RunArtifactSchema shape matches snapshot, OR snapshot + RUN_ARTIFACT_SCHEMA_VERSION are updated together', () => {
  const current = serializeShape(RunArtifactSchema as never, RUN_ARTIFACT_SCHEMA_VERSION);
  const fixtureRaw = readFileSync(fixturePath, 'utf-8');
  const snapshot = JSON.parse(fixtureRaw) as Fixture;

  const shapesMatch = JSON.stringify(current.shape) === JSON.stringify(snapshot.shape);
  const versionMatches = current.schemaVersion === snapshot.schemaVersion;

  if (shapesMatch && versionMatches) {
    return;
  }

  const diff = describeShapeDiff(snapshot.shape, current.shape);

  if (versionMatches && !shapesMatch) {
    assert.fail(
      `RunArtifactSchema shape diverged but RUN_ARTIFACT_SCHEMA_VERSION was not bumped:\n${diff}\n\n` +
      `Either bump RUN_ARTIFACT_SCHEMA_VERSION in src/engine/schema/artifact.ts AND run \`npm run snapshot:schema\` ` +
      `to update the fixture, or revert your schema change.`,
    );
  }

  if (!versionMatches && shapesMatch) {
    assert.fail(
      `RUN_ARTIFACT_SCHEMA_VERSION was bumped (${snapshot.schemaVersion} -> ${current.schemaVersion}) ` +
      `but the snapshot fixture is unchanged. Run \`npm run snapshot:schema\` to refresh the fixture.`,
    );
  }

  assert.fail(
    `RUN_ARTIFACT_SCHEMA_VERSION bumped (${snapshot.schemaVersion} -> ${current.schemaVersion}) but the snapshot was not refreshed. ` +
    `Diff:\n${diff}\n\nRun \`npm run snapshot:schema\` to refresh.`,
  );
});
