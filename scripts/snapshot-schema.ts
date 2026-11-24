/**
 * Regenerate the RunArtifactSchema snapshot fixture used by the schema
 * breaking-change gate test (T6.2). Run via `npm run snapshot:schema`
 * after intentionally changing the schema; commit the resulting JSON
 * file alongside any RUN_ARTIFACT_SCHEMA_VERSION bump.
 *
 * Usage:
 *   npm run snapshot:schema
 *
 * Output:
 *   tests/engine/schema/run-artifact-schema-snapshot.json
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunArtifactSchema } from '../src/engine/schema/index.js';
import { RUN_ARTIFACT_SCHEMA_VERSION } from '../src/engine/schema/artifact.js';
import { serializeShape } from '../tests/engine/schema/shape-utils.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '../tests/engine/schema/run-artifact-schema-snapshot.json');

const snapshot = serializeShape(RunArtifactSchema as never, RUN_ARTIFACT_SCHEMA_VERSION);

const payload = {
  comment: 'Schema snapshot for the breaking-change gate test. Regenerate via `npm run snapshot:schema`.',
  schemaVersion: snapshot.schemaVersion,
  shape: snapshot.shape,
};

writeFileSync(fixturePath, JSON.stringify(payload, null, 2) + '\n');
console.log(`Wrote snapshot to ${fixturePath}`);
console.log(`schemaVersion=${snapshot.schemaVersion}, ${Object.keys(snapshot.shape).length} top-level keys`);
