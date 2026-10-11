/**
 * The site says what a visitor can use now. The landing page served at
 * GET / carries no waitlist, early-access or coming-soon promise, tells
 * the visitor where to start, links only to sections and repository
 * files that exist, and its structured data parses. Wherever it offers
 * the API reference it also offers the HTTP API reference and the
 * Cookbook. The promise-free rule holds for every page source under
 * src/dashboard and assets as well.
 *
 * Visitor analytics run on the hosted demo only. There every page the
 * server sends loads Plausible, and the landing page and the API docs
 * also load Google Analytics and Microsoft Clarity with their privacy
 * settings; a copy run from the package or a clone loads none of them.
 * The landing page's privacy section names the three tools, and /docs
 * answers a permanent redirect to the API reference.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import * as builtInScenarioModule from '../../src/engine/scenarios/index.js';

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
let localSite = '';
let closeServer: () => Promise<void> = async () => {};

before(async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-landing-'));
  // A copy run from the npm package or a clone, which is not the hosted demo.
  const env = { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: undefined };
  const server = createMarsServer({ env, runPairSimulations: async () => {} });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  closeServer = async () => {
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  };
  localSite = `http://127.0.0.1:${port}`;
  const res = await fetch(`${localSite}/`);
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

/** Number words the landing page uses for small counts, indexed by value. */
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function countWord(count: number): string {
  const word = COUNT_WORDS[count];
  assert.ok(word, `no word for ${count}: extend COUNT_WORDS`);
  return word;
}

test('the scenarios section lists exactly the scenario files in scenarios/, and every scenario count on the page matches them', () => {
  const listed = [...section('scenarios').matchAll(/<summary>([^<]+)<\/summary>/g)]
    .map((match) => match[1].split('\u00b7')[0].trim())
    .sort();
  const inRepository = readdirSync(resolve(root, 'scenarios'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(resolve(root, 'scenarios', name), 'utf8')) as { id?: unknown; labels?: { name?: string } })
    .filter((draft) => typeof draft.id === 'string')
    .map((draft) => draft.labels?.name)
    .sort();

  assert.deepEqual(
    listed,
    inRepository,
    'a scenario was added to or removed from scenarios/: update the cards, the count in the heading and the FAQ answer',
  );

  // The package root re-exports every built-in scenario from this module.
  const builtIns = Object.values(builtInScenarioModule).filter(
    (value) => typeof value === 'object' && value !== null && 'id' in value && 'labels' in value,
  ).length;
  const total = countWord(inRepository.length);
  const exported = countWord(builtIns);
  const more = countWord(inRepository.length - builtIns);
  const heading = `${total.charAt(0).toUpperCase()}${total.slice(1)} scenarios to start from`;

  assert.ok(section('scenarios').includes(`>${heading}</h2>`), `the section heading must read "${heading}"`);
  assert.ok(section('scenarios').includes(`All ${total} below`), `the section must say "All ${total} below"`);
  const faqCount = new RegExp(`exports ${exported} scenarios[^.]*?holds ${more} more`, 'g');
  assert.equal(
    [...html.matchAll(faqCount)].length,
    2,
    `the visible FAQ answer and its structured data must both say the package exports ${exported} and the repository holds ${more} more`,
  );
  const llmsFull = readFileSync(resolve(root, 'src', 'dashboard', 'public', 'llms-full.txt'), 'utf8');
  assert.match(llmsFull, new RegExp(`exports ${exported} scenarios[^.]*?holds ${more} more`), 'llms-full.txt must give the same counts');
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

/** The script each analytics tool loads, as it appears in a page's markup. */
const ANALYTICS_SCRIPTS: ReadonlyArray<readonly [string, string]> = [
  ['Plausible', 'https://analytics.manic.agency/js/script.js'],
  ['Google Analytics', 'https://www.googletagmanager.com/gtag/js'],
  ['Microsoft Clarity', 'https://www.clarity.ms/tag/'],
];

const PLAUSIBLE_TAG = '<script defer data-domain="paracosm.agentos.sh" src="https://analytics.manic.agency/js/script.js"></script>';

function analyticsIn(page: string): string[] {
  return ANALYTICS_SCRIPTS.filter(([, script]) => page.includes(script)).map(([tool]) => tool);
}

/** The markup of a page up to its closing head tag. */
function headOf(page: string): string {
  const end = page.indexOf('</head>');
  assert.notEqual(end, -1, 'the page has no </head>');
  return page.slice(0, end);
}

let hostedDemo: Promise<{ site: string; close: () => Promise<void> }> | undefined;

/** The origin of a server started the way the hosted demo at paracosm.agentos.sh runs (PARACOSM_HOSTED_DEMO=true). */
async function hostedSite(): Promise<string> {
  hostedDemo ??= (async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'paracosm-hosted-'));
    const env = { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: 'true', PARACOSM_PLATFORM_API: undefined };
    const server = createMarsServer({ env, runPairSimulations: async () => {} });
    server.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    return {
      site: `http://127.0.0.1:${port}`,
      close: async () => {
        server.close();
        await once(server, 'close');
        rmSync(appDir, { recursive: true, force: true });
      },
    };
  })();
  return (await hostedDemo).site;
}

after(async () => {
  if (hostedDemo) await (await hostedDemo).close();
});

/**
 * Serves a minimal page from docs/api, where the server reads the API
 * reference that TypeDoc writes, for the duration of `use`.
 */
async function withDocsPage<T>(use: (path: string) => Promise<T>): Promise<T> {
  const docsDir = resolve(root, 'docs', 'api');
  const name = `analytics-check-${process.pid}.html`;
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, name), '<!DOCTYPE html><html><head><title>check</title></head><body><p>check</p></body></html>');
  try {
    return await use(`/docs/${name}`);
  } finally {
    rmSync(join(docsDir, name), { force: true });
  }
}

test('a copy of Paracosm run from the package or a clone loads no analytics on its landing page or its API docs', async () => {
  assert.deepEqual(analyticsIn(html), [], 'the landing page');
  const docsPage = await withDocsPage(async (path) => (await fetch(`${localSite}${path}`)).text());
  assert.deepEqual(analyticsIn(docsPage), [], 'an API docs page');
});

test('the hosted demo loads Plausible first on the landing page, then Google Analytics and Clarity with their privacy settings', async () => {
  const res = await fetch(`${await hostedSite()}/`);
  assert.equal(res.status, 200);
  const page = await res.text();
  const head = headOf(page);

  const plausible = head.indexOf(PLAUSIBLE_TAG);
  const google = head.indexOf('src="https://www.googletagmanager.com/gtag/js?id=G-4KEEK15KWZ"');
  const clarity = head.indexOf('"https://www.clarity.ms/tag/"');
  assert.notEqual(plausible, -1, 'the head must load Plausible for paracosm.agentos.sh');
  assert.ok(google > plausible, 'the head must load Google Analytics, after Plausible');
  assert.ok(clarity > google, 'the head must load Microsoft Clarity, after Google Analytics');

  const config = head.match(/gtag\(\s*'config'\s*,\s*'G-4KEEK15KWZ'\s*,\s*\{([^}]*)\}\s*\)/);
  assert.ok(config, 'the head must configure the Google Analytics property');
  assert.match(config[1], /['"]?allow_google_signals['"]?\s*:\s*false/, 'Google signals must be off');
  assert.match(config[1], /['"]?allow_ad_personalization_signals['"]?\s*:\s*false/, 'ad personalization must be off');
  assert.ok(head.includes('"ukky5yykaj"'), 'the head must load the Clarity project');
  assert.match(page, /<body[^>]*\sdata-clarity-mask="True"/, 'Clarity must mask the text and images of the whole page');
});

test('on the hosted demo the dashboard loads Plausible and the API docs load all three tools', async (t) => {
  const site = await hostedSite();

  const docsPage = await withDocsPage(async (path) => (await fetch(`${site}${path}`)).text());
  assert.deepEqual(analyticsIn(headOf(docsPage)), ['Plausible', 'Google Analytics', 'Microsoft Clarity'], 'an API docs page');
  assert.match(docsPage, /<body[^>]*\sdata-clarity-mask="True"/, 'Clarity must mask the API docs page');

  const sim = await fetch(`${site}/sim`);
  if (sim.status === 503) {
    t.skip('the dashboard is not built in this checkout (CI builds it before the tests)');
    return;
  }
  assert.equal(sim.status, 200);
  const dashboard = await sim.text();
  // The dashboard's bundle loads Google Analytics and Clarity itself when it is built with their ids (deploy.yml),
  // so the server adds Plausible alone.
  assert.deepEqual(analyticsIn(headOf(dashboard)), ['Plausible'], 'the dashboard page');
  assert.equal(headOf(dashboard).split(PLAUSIBLE_TAG).length - 1, 1, 'the dashboard must load Plausible once');
  assert.match(dashboard, /<body[^>]*\sdata-clarity-mask="True"/, 'Clarity must mask the dashboard');
});

test("the landing page's privacy section names the three tools, their processors and what they collect, and the footer links it", () => {
  const privacy = section('privacy');

  for (const tool of ['Plausible', 'Google Analytics', 'Microsoft Clarity']) {
    assert.ok(privacy.includes(tool), `the privacy section must name ${tool}`);
  }
  assert.match(privacy, /Google is our processor/, 'the privacy section must name Google as a processor');
  assert.match(privacy, /Microsoft is our processor/, 'the privacy section must name Microsoft as a processor');
  assert.match(privacy, /uses no cookies/, 'the privacy section must say Plausible is cookieless');
  assert.ok(between('<nav class="ft-links"', '</nav>').includes('href="#privacy"'), 'the footer must link the privacy section');
});

test('/docs and /docs/ answer a permanent redirect to the API reference', async () => {
  for (const path of ['/docs', '/docs/']) {
    const res = await fetch(`${localSite}${path}`, { redirect: 'manual' });
    assert.equal(res.status, 301, `${path} must answer 301`);
    assert.equal(res.headers.get('location'), '/docs/modules.html', `${path} must point at the module index`);
  }
});

test('the landing page title fits in 60 characters and its meta description in 120 to 160', () => {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  const description = html.match(/<meta name="description" content="([^"]*)">/)?.[1] ?? '';

  assert.ok(title.length > 0 && title.length <= 60, `the title has ${title.length} characters: ${title}`);
  assert.ok(description.length >= 120 && description.length <= 160, `the description has ${description.length} characters: ${description}`);
});
