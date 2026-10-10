/**
 * The site says what a visitor can use now. The landing page served at
 * GET / carries no waitlist, early-access or coming-soon promise, tells
 * the visitor where to start, links only to sections and repository
 * files that exist, and its structured data parses. Wherever it offers
 * the API reference it also offers the HTTP API reference and the
 * Cookbook. The promise-free rule holds for every page source under
 * src/dashboard and assets as well.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';

const root = resolve(import.meta.dirname, '..', '..');

/** Wording that promises something a visitor cannot use yet. */
const PROMISES: ReadonlyArray<readonly [string, RegExp]> = [
  ['waitlist', /wait[\s-]?list/i],
  ['early access', /early[\s-]access/i],
  ['coming soon', /coming[\s-]soon/i],
  ['notify me', /notify[\s-]me/i],
  ['Q3 2026', /Q3[\s-]2026/i],
  ['coming in a later release', /coming in (a|an|the) [\w-]+ release/i],
];

function promisesIn(text: string): string[] {
  return PROMISES.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

let html = '';
let closeServer: () => Promise<void> = async () => {};

before(async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-landing-'));
  const server = createMarsServer({ env: { ...process.env, APP_DIR: appDir }, runPairSimulations: async () => {} });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  closeServer = async () => {
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  };
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
  html = await res.text();
});

after(() => closeServer());

/** The markup of the landing page section with the given id, up to its closing tag. */
function section(id: string): string {
  const start = html.indexOf(`<section class="sec sec-alt" id="${id}">`);
  assert.notEqual(start, -1, `the landing page has no #${id} section`);
  return html.slice(start, html.indexOf('</section>', start));
}

test('the landing page promises nothing a visitor cannot use yet', () => {
  assert.deepEqual(promisesIn(html), []);
});

test('the landing page tells a visitor what to use today', () => {
  const getStarted = section('get-started');

  assert.match(getStarted, /npm install paracosm/, 'the section must carry the install line');
  assert.match(getStarted, /href="\/sim"/, 'the section must link the hosted dashboard');
  assert.match(getStarted, /href="\/docs"/, 'the section must link the API reference');
  assert.match(html, /<a href="#get-started"/, 'the navigation must link the section');
});

/** The markup from `open` up to the first `close` after it. */
function between(open: string, close: string): string {
  const start = html.indexOf(open);
  assert.notEqual(start, -1, `the landing page has no ${open}`);
  return html.slice(start, html.indexOf(close, start));
}

test('wherever the landing page links the API reference it also links the HTTP API reference and the Cookbook', () => {
  const httpApi = 'href="https://github.com/framerslab/paracosm/blob/master/docs/HTTP_API.md"';
  const cookbook = 'href="https://github.com/framerslab/paracosm/blob/master/docs/COOKBOOK.md"';
  const places: Record<string, string> = {
    'the Docs menu': between('type="button">Docs <svg', '</div>'),
    'the mobile Docs menu': between('<summary><span>Docs</span></summary>', '</details>'),
    'the footer': between('<nav class="ft-links"', '</nav>'),
    'the get-started section': section('get-started'),
  };

  for (const [place, markup] of Object.entries(places)) {
    assert.ok(markup.includes('href="/docs"'), `${place} must link the API reference`);
    assert.ok(markup.includes(httpApi), `${place} must link docs/HTTP_API.md`);
    assert.ok(markup.includes(cookbook), `${place} must link docs/COOKBOOK.md`);
  }
});

test('every in-page link on the landing page lands on an element that exists', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const targets = [...new Set([...html.matchAll(/\shref="#([^"]+)"/g)].map((match) => match[1]))];

  assert.ok(targets.length > 0, 'expected in-page links on the landing page');
  assert.deepEqual(targets.filter((target) => !ids.has(target)), []);
});

test('links from the landing page into this repository point at files that exist', () => {
  const linked = /https:\/\/github\.com\/framerslab\/paracosm\/(?:blob|tree)\/master\/([^"#?\s<]+)/g;
  const files = [...new Set([...html.matchAll(linked)].map((match) => match[1]))];

  assert.ok(files.length > 0, 'expected links into the repository on the landing page');
  assert.deepEqual(files.filter((file) => !existsSync(resolve(root, file))), []);
});

test("the landing page's structured data parses and every FAQ entry has an answer", () => {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1]) as { '@type'?: string; mainEntity?: Array<{ name?: string; acceptedAnswer?: { text?: string } }> },
  );
  const faq = blocks.find((block) => block['@type'] === 'FAQPage');

  assert.ok(faq?.mainEntity && faq.mainEntity.length > 0, 'expected a FAQPage block with questions');
  for (const entry of faq.mainEntity) {
    assert.ok(entry.name, 'a FAQ entry has no question');
    assert.ok(entry.acceptedAnswer?.text, `"${entry.name}" has no answer`);
  }
});

const SITE_SOURCES = ['src/dashboard', 'assets'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist']);
const PAGE_SOURCE = /\.(html|css|scss|ts|tsx|txt|xml|svg|md)$/;
const TEST_FILE = /\.test\.tsx?$/;

/** Every page source under `directory`: markup, styles, components and text files, build output and tests left out. */
function* pageSources(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) yield* pageSources(full);
    } else if (PAGE_SOURCE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      yield full;
    }
  }
}

test('no page source under src/dashboard or assets promises a waitlist, early access or a feature that is coming soon', () => {
  const offenders: string[] = [];
  for (const base of SITE_SOURCES) {
    for (const file of pageSources(resolve(root, base))) {
      const found = promisesIn(readFileSync(file, 'utf8'));
      if (found.length > 0) offenders.push(`${relative(root, file)}: ${found.join(', ')}`);
    }
  }

  assert.deepEqual(offenders, []);
});
