/**
 * The dashboard server with admin writes on, on a port of its own.
 *
 * The server code is the real one, over HTTP: ADMIN_WRITE=true and an
 * ADMIN_TOKEN, as an operator sets them, so /admin-config answers
 * `adminWrite: true` and a disk write of POST /scenario/store takes the
 * X-Admin-Token header. The token below guards nothing but this server's
 * temporary folders: its scenarios folder is a temporary one, so a
 * scenario a test saves lands there and never in scenarios/, and its runs
 * folder is a temporary one too, so a wipe sent with the token removes
 * nothing from output/. The Digital Twin world, which the server compiles
 * with a model on boot, is none here, and nothing here starts a run.
 *
 * The scenarios folder holds one persisted compiled draft, made from
 * scenarios/atlas-lab.json under an id of its own. The server re-compiles
 * persisted drafts at boot; the compiler here is a stub that hands the
 * draft back, so the draft enters the catalog as a compiled scenario, the
 * one source the scenario drawer offers Rename and Delete for, and no model
 * is called.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import type { ScenarioPackage } from '../../src/engine/types.js';

/** The same value tests-e2e/specs/admin-token-field.spec.ts enters. */
const ADMIN_TOKEN = 'e2e-admin-token';
/** The compiled scenario's id and name; tests-e2e/specs/admin-token-field.spec.ts names the same two. */
const COMPILED_ID = 'e2e-compiled-scenario';
const COMPILED_NAME = 'E2E Compiled Scenario';

const root = mkdtempSync(join(tmpdir(), 'paracosm-e2e-admin-write-'));
const scenarioDir = join(root, 'scenarios');
const appDir = join(root, 'app');
const runsDir = join(root, 'output');
mkdirSync(join(scenarioDir, 'compiled'), { recursive: true });
mkdirSync(appDir);
mkdirSync(runsDir);

const atlas = JSON.parse(readFileSync(new URL('../../scenarios/atlas-lab.json', import.meta.url), 'utf-8')) as Record<string, unknown>;
writeFileSync(join(scenarioDir, 'compiled', `${COMPILED_ID}.json`), JSON.stringify({
  ...atlas,
  id: COMPILED_ID,
  labels: { ...(atlas.labels as Record<string, unknown>), name: COMPILED_NAME },
  _persistMeta: { compiledAt: '2026-11-01T00:00:00.000Z', seedText: null },
}));

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
  compileScenario: async (json) => ({ ...json, hooks: {} }) as unknown as ScenarioPackage,
});
server.listen(Number(process.env.PORT ?? 3461));
