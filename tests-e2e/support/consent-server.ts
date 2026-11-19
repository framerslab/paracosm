/**
 * The hosted demo's server with its visitor analytics on, on a port of its
 * own, for tests-e2e/specs/consent-bar.spec.ts.
 *
 * The server code is the real one, over HTTP, in hosted_demo mode
 * (PARACOSM_HOSTED_DEMO=true), as paracosm.agentos.sh runs it. Its analytics
 * ids are made up, so no request a page makes could count anywhere even if
 * the spec let it through. The count events the server forwards go to a
 * sink on a second port, which keeps what it receives and answers
 * GET /received with it, so nothing reaches the shared Plausible instance.
 * Its folders are temporary ones; no model is called and nothing starts a
 * run.
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';

const PORT = Number(process.env.PORT ?? 3464);
const SINK_PORT = Number(process.env.CONSENT_SINK_PORT ?? 3465);

interface ReceivedEvent {
  body: unknown;
  userAgent: string | null;
  forwardedFor: string | null;
}

const received: ReceivedEvent[] = [];
const sink = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/event') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      let body: unknown = raw;
      try { body = JSON.parse(raw); } catch { /* kept as text */ }
      const header = (name: string) => {
        const value = req.headers[name];
        return typeof value === 'string' ? value : null;
      };
      received.push({ body, userAgent: header('user-agent'), forwardedFor: header('x-forwarded-for') });
      res.writeHead(202, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/received') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(received));
    return;
  }
  res.writeHead(404);
  res.end();
});
sink.listen(SINK_PORT, '127.0.0.1');

const root = mkdtempSync(join(tmpdir(), 'paracosm-e2e-consent-'));
const appDir = join(root, 'app');
const runsDir = join(root, 'output');
mkdirSync(appDir);
mkdirSync(runsDir);

const server = createMarsServer({
  env: {
    ...process.env,
    APP_DIR: appDir,
    PARACOSM_OUTPUT_DIR: runsDir,
    PARACOSM_HOSTED_DEMO: 'true',
    PARACOSM_DISABLE_RUN_HISTORY: '1',
  },
  maxSimsPerDay: 0,
  runHistoryStore: createNoopRunHistoryStore(),
  getDigitalTwinWorld: async () => null,
  // Made-up ids of the right shapes: the spec answers every vendor host itself.
  siteAnalyticsIds: { ga: 'G-E2E0TEST00', clarity: 'e2econsent' },
  countEventUrl: `http://127.0.0.1:${SINK_PORT}/api/event`,
});
server.listen(PORT);
