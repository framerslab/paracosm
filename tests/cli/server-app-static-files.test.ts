/**
 * The server answers every request for its static files with a status and
 * keeps running. A path under /demo/ or /assets/ that names a directory, or
 * nothing at all, answers 404; a real file is served whole, or by the range
 * asked for. A directory once reached the file stream, which failed with
 * EISDIR and no listener, and that stopped the process for every visitor.
 * A request path reaches the server as the visitor sent it, so a path with
 * `..` in it must never reach a file outside the folder its route serves.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';

const root = resolve(import.meta.dirname, '..', '..');
const demoRoot = resolve(root, 'assets', 'demo');
const demoFile = 'branches-poster.jpg';
const demoSubdir = `test-directory-${process.pid}`;
const unreadableFile = `test-unreadable-${process.pid}.mp4`;

const docsRoot = resolve(root, 'docs', 'api');
const docsFile = `test-docs-${process.pid}.css`;

let site = '';
let port = 0;
let closeServer: () => Promise<void> = async () => {};

before(async () => {
  mkdirSync(resolve(demoRoot, demoSubdir), { recursive: true });
  // A regular file the server cannot open: it passes the file check and
  // fails when the read stream opens it.
  writeFileSync(resolve(demoRoot, unreadableFile), Buffer.alloc(64));
  chmodSync(resolve(demoRoot, unreadableFile), 0o000);
  // The server serves /docs/ from docs/api, which TypeDoc writes; CI runs the
  // tests before it builds the docs. The folder is left in place afterwards,
  // as tests/cli/server-app-landing.test.ts leaves it, because that file may
  // be using it at the same time.
  mkdirSync(docsRoot, { recursive: true });
  writeFileSync(resolve(docsRoot, docsFile), 'body { color: black; }');
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-static-'));
  const env = { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: undefined };
  const server = createMarsServer({ env, runPairSimulations: async () => {} });
  server.listen(0);
  await once(server, 'listening');
  ({ port } = server.address() as { port: number });
  site = `http://127.0.0.1:${port}`;
  closeServer = async () => {
    server.close();
    server.closeAllConnections();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
    rmSync(resolve(demoRoot, demoSubdir), { recursive: true, force: true });
    rmSync(resolve(demoRoot, unreadableFile), { force: true });
    rmSync(resolve(docsRoot, docsFile), { force: true });
  };
});

after(() => closeServer());

/**
 * Every request gives up after ten seconds. A response the server never
 * finishes fails its own test quickly instead of waiting out the client's
 * five-minute header limit.
 */
const answerWithin = () => AbortSignal.timeout(10_000);

/** /health answers 200, so the process is still serving after the request before it. */
async function assertStillAnswers(): Promise<void> {
  const res = await fetch(`${site}/health`, { signal: answerWithin() });
  assert.equal(res.status, 200);
  await res.arrayBuffer();
}

const directoryAndMissingPaths: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['/demo/', {}],
  ['/demo/', { Range: 'bytes=0-99' }],
  [`/demo/${demoSubdir}`, {}],
  [`/demo/${demoSubdir}/`, { Range: 'bytes=0-' }],
  ['/demo/no-such-video.mp4', {}],
  ['/assets/', {}],
  ['/assets/no-such-chunk.js', {}],
];

for (const [path, headers] of directoryAndMissingPaths) {
  const label = headers.Range ? `${path} with Range ${headers.Range}` : path;
  test(`GET ${label} answers 404 and the server keeps answering`, async () => {
    const res = await fetch(`${site}${path}`, { headers, signal: answerWithin() });
    assert.equal(res.status, 404);
    await res.arrayBuffer();
    await assertStillAnswers();
  });
}

test('a demo file is still served whole, and by range', async () => {
  const size = statSync(resolve(demoRoot, demoFile)).size;

  const whole = await fetch(`${site}/demo/${demoFile}`, { signal: answerWithin() });
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'image/jpeg');
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal((await whole.arrayBuffer()).byteLength, size);

  const part = await fetch(`${site}/demo/${demoFile}`, { headers: { Range: 'bytes=0-9' }, signal: answerWithin() });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-9/${size}`);
  assert.equal((await part.arrayBuffer()).byteLength, 10);

  await assertStillAnswers();
});

// root opens a mode-000 file, so the case only holds for an ordinary user (CI's runner).
const runsAsRoot = process.getuid?.() === 0;

test('a demo file that cannot be opened answers 500, whole and by range, and the server keeps answering', { skip: runsAsRoot && 'root can open any file' }, async () => {
  for (const headers of [{}, { Range: 'bytes=0-9' }]) {
    const res = await fetch(`${site}/demo/${unreadableFile}`, { headers, signal: answerWithin() });
    assert.equal(res.status, 500);
    assert.equal(await res.text(), 'Read failed');
    await assertStillAnswers();
  }
});

/**
 * Sends one GET with the path exactly as given. fetch() would resolve the
 * `..` segments first, as a browser does; a scanner sends them raw.
 */
function getRawPath(path: string): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, signal: answerWithin() }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => done({ status: res.statusCode ?? 0, body }));
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end();
  });
}

// Each path resolves to the repository's package.json, outside the folder
// its route serves. A proxy in front resolves `/docs/../..` itself, but
// `docs..` is an ordinary segment, so `/docs../../package.json` reaches the
// server as sent.
const pathsOutsideTheirRoute = [
  '/docs../../package.json',
  '/docs/../../package.json',
  '/docs/media/../../../package.json',
  '/demo/../../package.json',
  '/brand/../package.json',
  '/diagrams/../../package.json',
  '/assets/../../../../package.json',
];

for (const path of pathsOutsideTheirRoute) {
  test(`GET ${path}, sent as is, answers 404 and serves no file outside its route`, async () => {
    const { status, body } = await getRawPath(path);
    assert.equal(status, 404);
    assert.ok(!body.includes('"name": "paracosm"'), 'the body must not be package.json');
    await assertStillAnswers();
  });
}

test('a file inside docs/api is still served', async () => {
  const res = await fetch(`${site}/docs/${docsFile}`, { signal: answerWithin() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/css');
  assert.equal(await res.text(), 'body { color: black; }');
});
