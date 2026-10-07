#!/usr/bin/env node
/**
 * Packs the package, installs the tarball into an empty project, starts the
 * `paracosm-dashboard` command it ships and requests the landing page, the
 * dashboard and the assets they load. It fails when the tarball lacks a file
 * the command serves or when a page does not answer, so a package whose
 * dashboard command has nothing to serve is caught before it is published.
 *
 * Run it after `npm run build` and `npm run dashboard:build`, as CI does:
 * `npm run check:package`. It runs the prepack copy itself
 * (scripts/pack-dashboard.mjs), then packs with scripts off so the standard
 * output of `npm pack --json` stays parseable.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Tarball paths the dashboard command reads. */
const REQUIRED_FILES = [
  'dist/cli/serve.js',
  'dist/server/server-app.js',
  'dist/dashboard/dist/index.html',
  'dist/dashboard/landing.html',
  'assets/landing.css',
  'assets/diagrams/paracosm-flow.svg',
  'assets/favicons/favicon-32.png',
  'assets/demo/e2e-atlas-8-poster.jpg',
];

/** [path, content type prefix, text the body must contain (or null)] */
const PAGES = [
  ['/', 'text/html', '<title>Paracosm'],
  // The package leaves the hero video out; the landing page must name the hosted copy.
  ['/', 'text/html', 'https://paracosm.agentos.sh/demo/e2e-atlas-8-hero.mp4'],
  ['/sim', 'text/html', '<div id="root">'],
  ['/brand/landing.css', 'text/css', null],
  ['/diagrams/paracosm-flow.svg', 'image/svg+xml', '<svg'],
  ['/favicon.png', 'image/png', null],
];

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function waitForServer(url, timeoutMs, server, closed) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      // 'exit' can come before the last of the server's output; 'close' follows once
      // stdout and stderr have ended, so the output main() prints with this error is complete.
      await Promise.race([closed, new Promise((wait) => setTimeout(wait, 5_000).unref())]);
      throw new Error(`paracosm-dashboard exited (${server.signalCode ?? `code ${server.exitCode}`}) before it answered`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((wait) => setTimeout(wait, 500));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'paracosm-pack-'));
  let child;
  let serverOutput = '';
  try {
    execFileSync(process.execPath, [join(root, 'scripts/pack-dashboard.mjs')], { cwd: root, stdio: 'inherit' });
    const packed = JSON.parse(
      execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], { cwd: root, encoding: 'utf8' }),
    )[0];
    const paths = new Set(packed.files.map((file) => file.path));
    const missing = REQUIRED_FILES.filter((path) => !paths.has(path));
    if (missing.length > 0) throw new Error(`the tarball lacks ${missing.join(', ')}`);
    const videos = [...paths].filter((path) => path.endsWith('.mp4'));
    if (videos.length > 0) throw new Error(`the tarball ships video files: ${videos.join(', ')}`);
    console.log(`packed ${packed.filename}: ${packed.entryCount} files, ${(packed.unpackedSize / 1e6).toFixed(1)} MB unpacked`);

    // Install the tarball as a user would, into a project with nothing else in it.
    const project = join(work, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'paracosm-package-smoke', private: true }));
    execFileSync('npm', ['install', join(work, packed.filename), '--no-audit', '--no-fund'], { cwd: project, stdio: 'inherit' });

    const port = await freePort();
    const command = join(project, 'node_modules', 'paracosm', 'dist', 'cli', 'serve.js');
    child = spawn(process.execPath, [command], {
      cwd: project,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { serverOutput += chunk; });
    child.stderr.on('data', (chunk) => { serverOutput += chunk; });
    const closed = new Promise((resolveClose) => child.once('close', resolveClose));

    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/`, 60_000, child, closed);
    for (const [path, type, marker] of PAGES) {
      const response = await fetch(`${base}${path}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
      if (!contentType.startsWith(type)) throw new Error(`GET ${path} answered ${contentType}, not ${type}`);
      if (marker !== null && !(await response.text()).includes(marker)) throw new Error(`GET ${path} has no ${marker}`);
      console.log(`GET ${path}: ${response.status} ${contentType}`);
    }
  } catch (error) {
    if (serverOutput) console.error(`--- paracosm-dashboard output ---\n${serverOutput}`);
    throw error;
  } finally {
    // Wait for the server to exit before removing the project it runs from.
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
      child.kill();
      await Promise.race([exited, new Promise((wait) => setTimeout(wait, 10_000).unref())]);
    }
    rmSync(work, { recursive: true, force: true });
  }
}

main().then(
  () => console.log('smoke-packed-package: the installed dashboard command serves its pages'),
  (error) => {
    console.error(`smoke-packed-package: ${error.message}`);
    process.exitCode = 1;
  },
);
