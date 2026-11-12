/**
 * The dashboard server with admin writes on, on a port of its own.
 *
 * The server code is the real one, over HTTP: ADMIN_WRITE=true and an
 * ADMIN_TOKEN, as an operator sets them, so /admin-config answers
 * `adminWrite: true` and a disk write of POST /scenario/store takes the
 * X-Admin-Token header. The token below guards nothing but this server's
 * temporary folders: its scenarios folder is an empty temporary one, so a
 * scenario a test saves lands there and never in scenarios/, and its runs
 * folder is a temporary one too, so a wipe sent with the token removes
 * nothing from output/. The Digital Twin world, which the server compiles
 * with a model on boot, is none here, and nothing here starts a run.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';

/** The same value tests-e2e/specs/admin-token-field.spec.ts enters. */
const ADMIN_TOKEN = 'e2e-admin-token';

const root = mkdtempSync(join(tmpdir(), 'paracosm-e2e-admin-write-'));
const scenarioDir = join(root, 'scenarios');
const appDir = join(root, 'app');
const runsDir = join(root, 'output');
mkdirSync(scenarioDir);
mkdirSync(appDir);
mkdirSync(runsDir);

const server = createMarsServer({
  env: {
    ...process.env,
    APP_DIR: appDir,
    PARACOSM_OUTPUT_DIR: runsDir,
    PARACOSM_HOSTED_DEMO: '',
    PARACOSM_DISABLE_RUN_HISTORY: '1',
    ADMIN_WRITE: 'true',
    ADMIN_TOKEN,
  },
  maxSimsPerDay: 0,
  scenarioDir,
  runHistoryStore: createNoopRunHistoryStore(),
  getDigitalTwinWorld: async () => null,
});
server.listen(Number(process.env.PORT ?? 3461));
