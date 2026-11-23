/**
 * The dashboard server with one finished Mars Genesis pair run of six turns
 * stored as the server stores a finished run, on a port of its own, for the
 * spec that reads the run view's toasts and the Event Log as it opens
 * (tests-e2e/specs/run-view-toast-and-log-chip.spec.ts).
 *
 * The server code is the real one, over HTTP. The run's stream
 * (tests-e2e/support/six-turn-run.ts) is saved in the session store
 * (APP_DIR/data/sessions.db), so /sim?replay=<id> plays it through the
 * server's own /sessions/:id/replay. The server's own GET /sessions lists the
 * one stored run, so a test reads its id there.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { openSessionStore, type TimestampedEvent } from '../../src/server/stores/session.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { ARIA, DIETRICH } from './pair-run.js';
import { sixTurnPairRunFrames } from './six-turn-run.js';

const appDir = mkdtempSync(join(tmpdir(), 'paracosm-e2e-six-turn-run-'));
const runsDir = join(appDir, 'runs');
process.env.PARACOSM_OUTPUT_DIR = runsDir;
mkdirSync(runsDir, { recursive: true });

const startTs = Date.parse('2026-11-16T02:55:00.000Z');
const events: TimestampedEvent[] = sixTurnPairRunFrames().map((sse, i) => ({ ts: startTs + i * 250, sse }));

const sessionStore = openSessionStore(join(appDir, 'data', 'sessions.db'));
await sessionStore.saveSession(events, {
  scenarioId: marsScenario.id,
  scenarioName: marsScenario.labels.name,
  leaderA: ARIA.name,
  leaderB: DIETRICH.name,
});

const server = createMarsServer({
  env: { ...process.env, APP_DIR: appDir, PARACOSM_OUTPUT_DIR: runsDir, PARACOSM_HOSTED_DEMO: '' },
  maxSimsPerDay: 0,
  runHistoryStore: createSqliteRunHistoryStore({ dbPath: join(appDir, 'runs.db') }),
  sessionStore,
  getDigitalTwinWorld: async () => null,
});
server.listen(Number(process.env.PORT ?? 3468));
