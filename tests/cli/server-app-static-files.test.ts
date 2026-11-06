/**
 * The server answers every request for its static files with a status and
 * keeps running. A path under /demo/ or /assets/ that names a directory, or
 * nothing at all, answers 404; a real file is served whole, or by the range
 * asked for. A directory once reached the file stream, which failed with
 * EISDIR and no listener, and that stopped the process for every visitor.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';

const root = resolve(import.meta.dirname, '..', '..');
const demoRoot = resolve(root, 'assets', 'demo');
const demoFile = 'branches-poster.jpg';
const demoSubdir = `test-directory-${process.pid}`;

let site = '';
let closeServer: () => Promise<void> = async () => {};

before(async () => {
  mkdirSync(resolve(demoRoot, demoSubdir), { recursive: true });
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-static-'));
  const env = { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: undefined };
  const server = createMarsServer({ env, runPairSimulations: async () => {} });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  site = `http://127.0.0.1:${port}`;
  closeServer = async () => {
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
    rmSync(resolve(demoRoot, demoSubdir), { recursive: true, force: true });
  };
});

after(() => closeServer());

async function assertStillAnswers(): Promise<void> {
  const res = await fetch(`${site}/health`);
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
    const res = await fetch(`${site}${path}`, { headers });
    assert.equal(res.status, 404);
    await res.arrayBuffer();
    await assertStillAnswers();
  });
}

test('a demo file is still served whole, and by range', async () => {
  const size = statSync(resolve(demoRoot, demoFile)).size;

  const whole = await fetch(`${site}/demo/${demoFile}`);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'image/jpeg');
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal((await whole.arrayBuffer()).byteLength, size);

  const part = await fetch(`${site}/demo/${demoFile}`, { headers: { Range: 'bytes=0-9' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-9/${size}`);
  assert.equal((await part.arrayBuffer()).byteLength, 10);

  await assertStillAnswers();
});
