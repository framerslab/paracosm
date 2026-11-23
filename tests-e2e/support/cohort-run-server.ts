/**
 * The dashboard server with five generated Mars Genesis runs stored as the
 * server stores a finished run, on a port of its own.
 *
 * The server code is the real one, over HTTP. Each run's stream is written
 * from a seed by tests-e2e/support/forge-fixtures.ts and saved in the session
 * store (APP_DIR/data/sessions.db), so /sim?replay=<id> plays it through the
 * server's own /sessions/:id/replay:
 *
 * - "Mars Genesis · 24 actors": 286 tools from 331 forges;
 * - "Mars Genesis · 300 actors": 3,612 tools from 4,207 forges, the most
 *   actors a run holds, A299's registry full;
 * - "Mars Genesis · 24 actors, A7 unreadable": the 24-actor run with A7's
 *   reports carrying their tools as a string;
 * - "Mars Genesis · report-only pair": two tools in department reports and
 *   no forge frame, as an older saved run holds them;
 * - "Mars Genesis · no forge": two actors whose reports name no tool.
 *
 * Each run is saved under its label as the scenario name, so a test finds
 * its id in the server's own GET /sessions. The run history is empty.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { openSessionStore, type TimestampedEvent } from '../../src/server/stores/session.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { DOZENS, DOZENS_A7_UNREADABLE, MAXIMUM, NO_FORGE_PAIR, REPORT_ONLY_PAIR, generateCohortRun } from './forge-fixtures.js';

const appDir = mkdtempSync(join(tmpdir(), 'paracosm-e2e-cohort-run-'));
const runsDir = join(appDir, 'runs');
process.env.PARACOSM_OUTPUT_DIR = runsDir;

const sessionStore = openSessionStore(join(appDir, 'data', 'sessions.db'));
const startTs = Date.parse('2026-11-16T02:00:00.000Z');

for (const spec of [DOZENS, MAXIMUM, DOZENS_A7_UNREADABLE, REPORT_ONLY_PAIR, NO_FORGE_PAIR]) {
  const events: TimestampedEvent[] = generateCohortRun(spec).map((sse, i) => ({ ts: startTs + i * 250, sse }));
  const [first, second] = spec.namedActors ?? [];
  await sessionStore.saveSession(events, {
    scenarioId: marsScenario.id,
    scenarioName: spec.label,
    leaderA: first?.name,
    leaderB: second?.name,
  });
}

const server = createMarsServer({
  env: { ...process.env, APP_DIR: appDir, PARACOSM_OUTPUT_DIR: runsDir, PARACOSM_HOSTED_DEMO: '' },
  maxSimsPerDay: 0,
  runHistoryStore: createSqliteRunHistoryStore({ dbPath: join(appDir, 'runs.db') }),
  sessionStore,
  getDigitalTwinWorld: async () => null,
});
server.listen(Number(process.env.PORT ?? 3467));
