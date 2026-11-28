/**
 * The site says what a visitor can use now. The landing page served at
 * GET / carries no waitlist, early-access or coming-soon promise, tells
 * the visitor where to start, links only to sections and repository
 * files that exist, and its structured data parses. Wherever it offers
 * the API reference it also offers the HTTP API reference and the
 * Cookbook. The promise-free rule holds for every page source under
 * src/dashboard and assets as well.
 *
 * Visitor analytics run on the hosted demo only, behind its consent bar.
 * There every page the server sends carries the bar's configuration and
 * script and no vendor tag, so no tool loads before the visitor's yes to
 * its purpose (tests-e2e/specs/consent-bar.spec.ts drives the bar in a
 * browser); a copy run from the package or a clone carries none of it.
 * The landing page's privacy section names each purpose and its tool, and
 * /docs answers a permanent redirect to the API reference.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import * as builtInScenarioModule from '../../src/engine/scenarios/index.js';
import { DEMO_EXECUTION, minutesForTurns } from '../../src/cli/sim-config.js';
import { buildLandingReplay, type SavedRun } from '../../src/dashboard/src/landing/replayDigest.js';
import { minutesForTurns as dashboardMinutesForTurns } from '../../src/dashboard/src/components/quickstart/first-screen/effectiveLaunch.js';

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
  const first = html.slice(html.indexOf('<section class="lp-first"'), html.indexOf('</section>', html.indexOf('<section class="lp-first"')));
  assert.match(first, /npm install paracosm/, 'the first screen must carry the install line');
  assert.match(first, /<a class="lp-key" href="\/sim"/, 'the first screen must link the hosted dashboard');
});

/** The markup from `open` up to the first `close` after it. */
function between(open: string, close: string): string {
  const start = html.indexOf(open);
  assert.notEqual(start, -1, `the landing page has no ${open}`);
  return html.slice(start, html.indexOf(close, start));
}

/** The words of a piece of markup, its tags removed until none remains, so a tag split by another reads as no words. */
function wordsOf(markup: string): string {
  let words = markup;
  let previous: string;
  do {
    previous = words;
    words = words.replace(/<[^<>]*>/g, '');
  } while (words !== previous);
  return words;
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
    (match) => JSON.parse(match[1]) as {
      '@type'?: string;
      description?: string;
      mainEntity?: Array<{ name?: string; acceptedAnswer?: { text?: string } }>;
    },
  );
  const software = blocks.find((block) => block['@type'] === 'SoftwareApplication');
  assert.equal(
    software?.description,
    'Agent swarm simulation for structured world modeling with LLMs. Run one scenario as timelines from the same start and compare outcomes after changing one thing, such as who leads or an event at a past turn. An LLM event director writes each timeline’s unscripted crises from what happens in it.',
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

/** The consent bar's script, which the server adds to the hosted demo's pages. */
const CONSENT_SCRIPT = /<script defer src="\/brand\/consent\/consent\.js\?v=[^"]+"><\/script>/;

function analyticsIn(page: string): string[] {
  return ANALYTICS_SCRIPTS.filter(([, script]) => page.includes(script)).map(([tool]) => tool);
}

/** The markup of a page up to its closing head tag. */
function headOf(page: string): string {
  const end = page.indexOf('</head>');
  assert.notEqual(end, -1, 'the page has no </head>');
  return page.slice(0, end);
}

/** The consent bar's configuration in a page's head, parsed. */
function consentConfigOf(page: string): { domain: string; ga: string; clarity: string; signal: boolean } {
  const match = headOf(page).match(/<script type="application\/json" id="paracosm-consent-config">([^<]*)<\/script>/);
  assert.ok(match, 'the head must carry the consent bar configuration');
  return JSON.parse(match[1]) as { domain: string; ga: string; clarity: string; signal: boolean };
}

let hostedDemo: Promise<{ site: string; close: () => Promise<void> }> | undefined;

/** The origin of a server started the way the hosted demo at paracosm.agentos.sh runs (PARACOSM_HOSTED_DEMO=true). */
async function hostedSite(): Promise<string> {
  hostedDemo ??= (async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'paracosm-hosted-'));
    const env = { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: 'true', PARACOSM_PLATFORM_API: undefined };
    const server = createMarsServer({
      env,
      runPairSimulations: async () => {},
      siteAnalyticsIds: { ga: 'G-UNIT0TEST0', clarity: 'unitconsent' },
    });
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

test('a copy of Paracosm run from the package or a clone loads no analytics and no consent bar on its landing page or its API docs', async () => {
  assert.deepEqual(analyticsIn(html), [], 'the landing page');
  assert.doesNotMatch(html, CONSENT_SCRIPT, 'the landing page');
  const docsPage = await withDocsPage(async (path) => (await fetch(`${localSite}${path}`)).text());
  assert.deepEqual(analyticsIn(docsPage), [], 'an API docs page');
  assert.doesNotMatch(docsPage, CONSENT_SCRIPT, 'an API docs page');
  assert.ok(!docsPage.includes('data-consent-open'), 'an API docs page offers no analytics choices');
});

test("the hosted demo's landing page, API docs and dashboard carry the consent bar and no vendor tag", async (t) => {
  const site = await hostedSite();
  const pages: Array<[string, string]> = [
    ['the landing page', await (await fetch(`${site}/`)).text()],
    ['an API docs page', await withDocsPage(async (path) => (await fetch(`${site}${path}`)).text())],
  ];
  const sim = await fetch(`${site}/sim`);
  if (sim.status === 503) {
    t.diagnostic('the dashboard is not built in this checkout (CI builds it before the tests)');
  } else {
    assert.equal(sim.status, 200);
    pages.push(['the dashboard page', await sim.text()]);
  }

  for (const [name, page] of pages) {
    assert.deepEqual(analyticsIn(page), [], `${name} must load no tool before the visitor's answer`);
    assert.match(headOf(page), CONSENT_SCRIPT, `${name} must load the consent bar's script`);
    assert.ok(headOf(page).includes('<link rel="stylesheet" href="/brand/consent/consent.css?v='), `${name} must load the consent bar's stylesheet`);
    assert.deepEqual(consentConfigOf(page), { domain: 'paracosm.agentos.sh', ga: 'G-UNIT0TEST0', clarity: 'unitconsent', signal: false }, name);
    assert.match(page, /<body[^>]*\sdata-clarity-mask="True"/, `${name}: Clarity must mask the text and images of the whole page`);
    assert.equal(page.split('id="paracosm-consent-config"').length - 1, 1, `${name} must carry the bar once`);
  }
  assert.ok(pages[1][1].includes('data-consent-open'), 'the API docs footer must offer Analytics choices');
});

test('on the hosted demo a request that sends Sec-GPC: 1 gets a bar told to run nothing', async () => {
  const res = await fetch(`${await hostedSite()}/`, { headers: { 'Sec-GPC': '1' } });
  assert.equal(res.status, 200);
  assert.equal(consentConfigOf(await res.text()).signal, true);
});

test('the consent bar script and stylesheet are served from /brand/consent/', async () => {
  for (const [path, type] of [['/brand/consent/consent.js', 'application/javascript'], ['/brand/consent/consent.css', 'text/css']] as const) {
    const res = await fetch(`${localSite}${path}?v=test`);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('content-type'), type, path);
  }
});

test("the landing page's privacy section names each purpose, its tool and its role, the signal and the footer control", () => {
  const privacy = section('privacy');

  for (const words of ['Count visits: Plausible Analytics', 'Measure use: Google Analytics 4', 'Record sessions: Microsoft Clarity']) {
    assert.ok(privacy.includes(words), `the privacy section must name ${words}`);
  }
  assert.match(privacy, /Reject all, Choose and Accept all/, 'the privacy section must name the bar\'s three keys');
  assert.match(privacy, /Google is our processor/, 'the privacy section must name Google as a processor');
  assert.match(privacy, /independent controller/, 'the privacy section must name Microsoft as an independent controller');
  assert.match(privacy, /uses no cookies/, 'the privacy section must say Plausible is cookieless');
  assert.match(privacy, /Global Privacy Control or Do Not Track/, 'the privacy section must name the privacy signal');
  assert.match(privacy, /Analytics choices/, 'the privacy section must name the footer control');
  const footer = between('<nav class="ft-links"', '</nav>');
  assert.ok(footer.includes('href="#privacy"'), 'the footer must link the privacy section');
  assert.ok(footer.includes('<button type="button" data-consent-open hidden>Analytics choices</button>'), 'the footer must hold the Analytics choices control');
});

test('the served privacy section explains who receives the first-screen events', () => {
  const privacy = section('privacy');
  const paragraphs = [...privacy.matchAll(/<p\b[^>]*>(.*?)<\/p>/gs)].map(match => wordsOf(match[1]));
  const launches = paragraphs.find(text => text.includes('Viewing the Run screen')) ?? '';
  for (const action of ['pressing Start', 'opening a leader’s full prompt', 'a run opening or failing to start', 'seeing the daily limit', 'choosing a replay or Settings']) {
    assert.ok(launches.includes(action), action);
  }
  assert.match(launches, /Plausible counts.*Google Analytics 4 measures.*with your permission.*Microsoft Clarity marks.*by name.*recording/s);

  const navigation = paragraphs.find(text => text.includes('Opening How it works')) ?? '';
  assert.match(navigation, /switching between the two leaders.*choosing a section.*Plausible.*Google Analytics 4.*permission/s);
  assert.doesNotMatch(navigation, /Clarity/);
  assert.match(privacy, /counts full prompt reads separately by IP address in memory for one minute/);
  assert.match(privacy, /only fixed choices and ranges for the number of leaders/);
  assert.match(privacy, /count runs before you answer/);
  assert.match(privacy, /Reject all or its switch stops it/);
  assert.match(privacy, /Global Privacy Control or Do Not Track.*count included/);
});

test('the served privacy section explains which saved run data can be seen and when it expires', () => {
  const privacy = section('privacy');
  assert.match(privacy, /send its prompts to OpenAI or Anthropic.*includes any orders you write for a leader/);
  assert.match(privacy, /saves finished runs for replay.*scenario, its leaders, the sequence of turns, decisions and results.*brief you started from/);
  assert.match(privacy, /visitor cookie lets this browser list your saved runs.*Everyone can also see runs our team has pinned/);
  assert.match(privacy, /Anyone with a replay link can watch.*including any orders you wrote that appear in the replay/);
  assert.match(privacy, /own unpinned run, the original brief is visible only to your browser/);
  assert.match(privacy, /ten newer runs are saved for your browser/);
  assert.match(privacy, /50 unpinned replays in total, so a replay can be removed sooner/);
  assert.match(privacy, /Team runs that we pin stay outside these limits/);
  assert.match(privacy, /separate history of runs on this device.*Clearing this site's data.*removes that local history.*Saved replays on our server follow the limits above/);
  assert.doesNotMatch(privacy, /shows on no one else's/);
});

test('the served privacy section carries one release date and keeps the standing disclosures', () => {
  const privacy = section('privacy');
  const dates = [...privacy.matchAll(/<time\b[^>]*datetime="(\d{4}-\d{2}-\d{2})"[^>]*>([^<]+)<\/time>/g)];
  assert.equal(dates.length, 1);
  const [, iso, words] = dates[0];
  const date = new Date(iso + 'T00:00:00Z');
  assert.equal(date.toISOString().slice(0, 10), iso);
  assert.equal(words, new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(date));
  assert.match(privacy, /Updated\s+<time\b/);
  assert.match(privacy, /<code>paracosm_scenario<\/code>.*lasts 30 days.*<code>paracosm_visitor<\/code>.*lasts 30 days/);
  for (const cookie of ['_ga', '_ga_*', '_clck', '_clsk']) assert.ok(privacy.includes(`<code>${cookie}</code>`), cookie);
  assert.match(privacy, /server keeps your IP address with a count of your requests/);
  assert.match(privacy, /If you add API keys, we use them for the runs and chats you start/);
  assert.match(privacy, /This tab keeps them until it closes or you select Forget my keys/);
  assert.match(privacy, /Our server holds them in memory while in use and for up to \d+ minutes afterward, then drops them/);
  assert.match(privacy, /Each key is sent only to the provider it belongs to/);
  assert.match(privacy, /Paracosm is for a general audience.*children under 13.*delete what we hold/);
  assert.match(privacy, /href="mailto:team@frame.dev"/);
  assert.match(privacy, /install from npm or run from the repository loads none of these tools/);
});

test('/docs and /docs/ answer a permanent redirect to the API reference', async () => {
  for (const path of ['/docs', '/docs/']) {
    const res = await fetch(`${localSite}${path}`, { redirect: 'manual' });
    assert.equal(res.status, 301, `${path} must answer 301`);
    assert.equal(res.headers.get('location'), '/docs/modules.html', `${path} must point at the module index`);
  }
});

test('the landing page title fits in 60 characters', () => {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  assert.ok(title.length > 0 && title.length <= 60, `the title has ${title.length} characters: ${title}`);
});

test('the served landing page describes what differs between timelines', () => {
  const description = 'Open-source TypeScript agent swarm simulator. Run one what-if as timelines from the same seed and change one thing between them: a leader’s HEXACO personality or an event at a past turn. An LLM event director writes each timeline’s unscripted crises from what happens in it.';
  const lead = 'Type a scenario in plain English. Paracosm runs it as timelines side by side, all from the same start. An AI event director writes each timeline’s unscripted crises from what has happened in it so far. Change one thing between them, such as a leader’s personality or an event at a past turn, and see where each one ends up.';
  assert.equal(html.match(/<meta name="description" content="([^"]*)">/)?.[1], description);
  assert.equal(html.match(/<meta property="og:description" content="([^"]*)">/)?.[1], description);
  assert.equal(html.match(/<meta name="twitter:description" content="([^"]*)">/)?.[1], description);
  assert.equal(html.match(/<p class="hero-positioning[^"]*"[^>]*>([^<]*)<\/p>/)?.[1].trim(), lead);
  const closing = 'Compile a brief. Run it as timelines from the same seed and change one thing between them: who leads or an event at any turn. Watch the trajectories diverge.';
  assert.equal(html.match(/<section class="banner">[\s\S]*?<p class="rv">([^<]*)<\/p>/)?.[1], closing);
  // A run reads no intervention: WorldModel.intervene() keeps it on the artifact only, so the page never offers one as the thing to change.
  assert.doesNotMatch(html, /change one thing between them:[^.<]*intervention/);
  assert.doesNotMatch(html, /LLM leaders with HEXACO personalities play it out|Generate three actors/);
});

test("the dashboard page's one static h1 sits inside #root, which React clears when the dashboard mounts", async (t) => {
  const res = await fetch(`${localSite}/sim`);
  if (res.status === 503) {
    t.skip('the dashboard is not built in this checkout (CI builds it before the tests)');
    return;
  }
  const page = await res.text();
  const h1s = [...page.matchAll(/<h1[\s>]/g)].map((match) => match.index ?? -1);

  // Mounted, the dashboard renders its own h1 for the active tab (App.tsx).
  assert.equal(h1s.length, 1, 'the page must carry one static h1');
  assert.ok(h1s[0] > page.indexOf('<div id="root">'), 'the static h1 must sit inside #root');
});


test('the privacy section names the address record and when it ends', () => {
  const privacy = section('privacy');
  assert.match(privacy, /[Tt]o apply (?:its|the) usage limits/);
  assert.match(privacy, /server keeps your IP address with a count of your requests/);
  for (const kind of ['runs', 'Digital Twin runs', 'compiles', 'chat messages', 'run imports', 'Quickstart requests', 'generating leaders', 'grounding a scenario', 'reading a page']) {
    assert.ok(privacy.includes(kind), `names ${kind}`);
  }
  assert.match(privacy, /compile on your own model key.*site.s web search.*reads a page through it/);
  assert.match(privacy, /next UTC midnight/);
  assert.match(privacy, /next UTC hour for chat/);
  assert.match(privacy, /deletes ended counts from memory at its hourly cleanup.*updates its saved copy/);
  assert.match(privacy, /clears ended counts from the saved copy when it starts/);
  assert.match(privacy, /holds your address.*simultaneous runs on your own model key and open live views/);
  assert.match(privacy, /until the run is dropped or the view closes/);
  assert.doesNotMatch(privacy, /milliseconds/);
});

test("no page asks Google's font service for anything: the landing page, the API docs and the dashboard load their fonts from this site", async (t) => {
  const site = await hostedSite();
  const pages: Array<[string, string]> = [
    ['the landing page source', html],
    ['the hosted landing page', await (await fetch(`${site}/`)).text()],
    ['the local landing page', await (await fetch(`${localSite}/`)).text()],
    ['an API docs page', await withDocsPage(async (path) => (await fetch(`${site}${path}`)).text())],
    ['the dashboard source', readFileSync(resolve(root, 'src', 'dashboard', 'index.html'), 'utf-8')],
  ];
  const sim = await fetch(`${site}/sim`);
  if (sim.status === 503) t.diagnostic('the dashboard is not built in this checkout (CI builds it before the tests)');
  else pages.push(['the dashboard page', await sim.text()]);
  for (const [name, page] of pages) {
    assert.doesNotMatch(page, /fonts\.googleapis\.com|fonts\.gstatic\.com/, `${name} must not name Google's font hosts`);
    assert.ok(page.includes('/brand/fonts/fonts.css'), `${name} must load the site's own fonts`);
  }

  const css = await fetch(`${localSite}/brand/fonts/fonts.css`);
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('content-type'), 'text/css');
  const sheet = await css.text();
  for (const family of ['Inter', 'JetBrains Mono']) assert.ok(sheet.includes(`font-family: '${family}'`), `the sheet must define ${family}`);
  const files = [...sheet.matchAll(/url\('(\/brand\/fonts\/[^']+\.woff2)'\)/g)].map(match => match[1]);
  assert.ok(files.length >= 2, 'the sheet must name its font files');
  for (const file of new Set(files)) {
    const res = await fetch(`${localSite}${file}`);
    assert.equal(res.status, 200, file);
    assert.equal(res.headers.get('content-type'), 'font/woff2', file);
  }
});

test('the privacy section says what the server keeps of a page view and for how long', () => {
  const privacy = section('privacy');
  assert.match(privacy, /one of this site.s pages/, 'names what the page address is cut to');
  assert.match(privacy, /no referrer/, 'says no referrer is sent');
  assert.doesNotMatch(privacy, /referring site.s domain/, 'sends nothing of the referrer');
  assert.match(privacy, /full User-Agent/, 'names the whole User-Agent header as what Plausible receives');
  assert.match(privacy, /daily visitor identifier/, 'names what Plausible uses the address and User-Agent for');
  assert.match(privacy, /stores neither/, 'says Plausible keeps neither');
  assert.doesNotMatch(privacy, /browser.s name/, 'the User-Agent is more than the browser\'s name');
  assert.match(privacy, /holds your IP address in memory for one minute/, 'names the count limit and its length');
  assert.match(privacy, /never writes it to disk/, 'says the count limit is not saved');
});

/** The pinned pair run the landing page replays, as the repository keeps it. */
const pinnedRun = JSON.parse(readFileSync(resolve(root, 'src/dashboard/src/landing/pinned-run.json'), 'utf-8')) as SavedRun;

test('GET /landing-replay.json sends the digest the dashboard build wrote from the pinned pair run', async () => {
  const res = await fetch(`${localSite}/landing-replay.json`);
  assert.equal(res.status, 200, 'CI builds the dashboard, which writes the digest, before the tests');
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
  const digest = await res.json() as ReturnType<typeof buildLandingReplay>;
  assert.deepEqual(digest, buildLandingReplay(pinnedRun));

  assert.equal(digest.session, pinnedRun.session);
  assert.equal(digest.leaders.length, 2);
  assert.equal(digest.frames.length, digest.turns);
  for (const frame of digest.frames) {
    for (const side of frame.sides) {
      assert.ok(side.event && side.event !== 'Director generating...', `turn ${frame.turn} names its event`);
      assert.ok(side.decision, `turn ${frame.turn} names each decision`);
      assert.match(side.outcome, /^(risky|conservative)_(success|failure)$/);
      assert.equal(side.people.filter(person => person[2] === 1).length, side.population, `turn ${frame.turn}: the living people are the population`);
    }
  }
  assert.equal(digest.verdict.winner, 'Dietrich Voss');
  assert.deepEqual(digest.verdict.population, [37, 43]);
  assert.equal(digest.cost.llmCalls, 121);
});

test('the build refuses a pinned run that is not a pair of 6 to 8 turns, naming the run', () => {
  const status = pinnedRun.events.find(event => event.event === 'status') as { data: { actors: unknown[] } };
  const three: SavedRun = {
    ...pinnedRun,
    events: pinnedRun.events.map(event => event === status
      ? { event: 'status', data: { ...status.data, actors: [...status.data.actors, status.data.actors[0]] } }
      : event),
  };
  assert.throws(() => buildLandingReplay(three), new RegExp(`${pinnedRun.session} has 3 leaders`));
  const short: SavedRun = {
    ...pinnedRun,
    events: pinnedRun.events.filter(event => !(event.event === 'sim' && (event.data as { data: { turn?: number } }).data.turn! > 5)),
  };
  assert.throws(() => buildLandingReplay(short), new RegExp(`${pinnedRun.session} has 5 turns`));
});

test('the served landing page links the pinned run in the demo, says what a run costs, and asks npm and GitHub nothing', async () => {
  assert.ok(html.includes(`href="/sim?replay=${pinnedRun.session}&amp;tab=sim"`), 'Open this run in the demo opens the pinned run');
  assert.doesNotMatch(html, /__LANDING_[A-Z_]+__/, 'every landing fill is filled');
  assert.doesNotMatch(html, /registry\.npmjs\.org|api\.github\.com/, 'the page asks npm and GitHub nothing');
  assert.match(html, /<span class="lp-key-line">Runs on this server’s API keys\.<\/span>/, 'a copy from the package or a clone runs on its own keys');
  const trust = html.slice(html.indexOf('<ul class="lp-trust"'), html.indexOf('</ul>', html.indexOf('<ul class="lp-trust"')));
  const version = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')) as { version: string }).version;
  for (const fact of ['Open-source simulation engine in TypeScript', 'Apache-2.0', 'Built on <a href="https://agentos.sh">AgentOS</a>', `v${version} on npm`]) {
    assert.ok(trust.includes(fact), fact);
  }

  for (let turns = 1; turns <= 20; turns++) {
    assert.equal(minutesForTurns(turns), dashboardMinutesForTurns(turns), `the server and the dashboard time ${turns} turns alike`);
  }
  const hosted = await (await fetch(`${await hostedSite()}/`)).text();
  const minutes = minutesForTurns(DEMO_EXECUTION.maxTurns);
  const figure = `${Math.floor(minutes) || ''}${minutes % 1 ? '½' : ''}`;
  assert.ok(hosted.includes(`<span class="lp-key-line">A free run, about ${figure} minutes</span>`), `the hosted demo's key says a free run takes about ${figure} minutes`);
  assert.ok(hosted.includes(`aria-label="Run a what-if in the demo: a free run, about ${Math.floor(minutes)}${minutes % 1 ? ' and a half' : ''} minutes"`));
});
