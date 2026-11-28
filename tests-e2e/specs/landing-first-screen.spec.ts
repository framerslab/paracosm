/**
 * The landing page's header row and first screen, served by the real server
 * at / with the real build's digest of the pinned Mars Genesis pair run
 * (src/dashboard/src/landing/pinned-run.json, written at build into
 * dist/landing-replay.json and sent at GET /landing-replay.json).
 *
 * What it proves, at 390 by 844 and 1,440 by 900 px in both looks:
 * - the h1, the claim and the lead read the decided words; the one filled
 *   key, Run a what-if, opens /sim; the install line carries Copy; the trust
 *   line names the licence, AgentOS and the running package's version;
 * - the replay of the saved run stands inside the first screen, plays by
 *   itself, pauses, and its run line, Previous turn and Next turn step it
 *   frame by frame through the run's own turns to the verdict, each frame
 *   drawing both timelines from the digest: the turn's event, each leader's
 *   decision and outcome, and one cell a person, alive or not;
 * - under reduced motion the replay rests on the verdict and nothing moves;
 * - "Open this run in the demo" opens the same saved run in /sim;
 * - body text is 18 px at 12:1 or more and every other word 15 px at 7:1
 *   or more, apart from the primary key's label and the logotype, the two
 *   named exceptions;
 * - the header stays one row at 320, 360, 390, 430, 480 and 768 px;
 * - on a phone's first visit to the hosted demo the analytics choices bar
 *   stands 16 px or more below the Run key;
 * - the key, Copy, the replay and the look switch send their fixed events
 *   through the site's count route, which forwards them as the landing
 *   page's (tests-e2e/support/consent-server.ts);
 * - no page error at any width or look.
 */
import { test, expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { failures, measureText, saidOf } from '../support/readability.js';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The landing page is read from the local servers this suite starts.');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const VERSION = (JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as { version: string }).version;

const BASE = 'http://127.0.0.1:3456';
/** The hosted demo's server with its analytics on (tests-e2e/support/consent-server.ts) and its count sink. */
const HOSTED = 'http://127.0.0.1:3464';
const SINK = 'http://127.0.0.1:3465';

const CLAIM = 'Run any what-if. See how it actually plays out.';
const LEAD = 'Type a scenario in plain English. Paracosm runs it as timelines side by side, all from the same start. An AI event director writes each timeline’s unscripted crises from what has happened in it so far. Change one thing between them, such as a leader’s personality or an event at a past turn, and see where each one ends up.';
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 1440, height: 900 }] as const;
const LOOKS = ['dark', 'light'] as const;
type Look = typeof LOOKS[number];

interface Side {
  event: string;
  emergent: boolean;
  decision: string;
  outcome: string;
  population: number;
  people: Array<[number, number, 0 | 1, 0 | 1]>;
}
interface Digest {
  session: string;
  scenario: string;
  seed: number;
  turns: number;
  leaders: Array<{ name: string; archetype: string }>;
  start: { year: number; people: Array<[number, number, 0 | 1, 0 | 1]> };
  frames: Array<{ turn: number; year: number; sides: [Side, Side] }>;
  verdict: { winner: string; population: [number, number]; splitTurn: number };
}

let digest: Digest;

test.beforeAll(async ({ request }) => {
  const response = await request.get(`${BASE}/landing-replay.json`);
  expect(response.status(), 'the server sends the build’s digest of the pinned run').toBe(200);
  digest = await response.json() as Digest;
  expect(digest.leaders.length, 'the pinned run is a pair').toBe(2);
  expect(digest.frames.length).toBe(digest.turns);
});

/** Opens / in one look and size, collecting every page error. */
async function open(browser: Browser, look: Look, options: BrowserContextOptions & { base?: string } = {}): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const { base = BASE, ...contextOptions } = options;
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 }, ...contextOptions });
  await context.addInitScript((chosen) => {
    try { localStorage.setItem('paracosm-theme', chosen); } catch { /* storage refused: the look stays the default */ }
  }, look);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  return { page, errors, close: () => context.close() };
}

const replay = (page: Page) => page.getByRole('region', { name: 'A saved run of Mars Genesis, replayed' });
const runLine = (page: Page) => replay(page).getByRole('slider', { name: 'Turns' });
const playKey = (page: Page) => replay(page).locator('.lp-play');

/** The slider's value as a number. */
async function frameOf(page: Page): Promise<number> {
  return Number(await runLine(page).inputValue());
}

/** Waits for the replay to have drawn the digest. */
async function ready(page: Page): Promise<void> {
  await expect(replay(page)).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
}

/** How many people each timeline's grid draws alive, in the leaders' order. */
async function aliveCells(page: Page): Promise<number[]> {
  return replay(page).locator('.lp-side').evaluateAll(sides => sides.map(side => side.querySelectorAll('.lp-cell[data-alive="1"]').length));
}

const alive = (people: Side['people']) => people.filter(person => person[2] === 1).length;

for (const viewport of VIEWPORTS) {
  for (const look of LOOKS) {
    test(`the header and the first screen at ${viewport.width} px in the ${look} look`, async ({ browser }) => {
      const { page, errors, close } = await open(browser, look, { viewport, reducedMotion: 'reduce' });
      try {
        await ready(page);
        expect(await page.evaluate(() => document.documentElement.classList.contains('light'))).toBe(look === 'light');

        const h1 = page.getByRole('heading', { level: 1 });
        await expect(h1).toHaveText('PARACOSM');
        expect(await page.getByRole('heading', { level: 1 }).count(), 'one main title').toBe(1);
        await expect(page.locator('.lp-claim')).toHaveText(CLAIM);
        expect((await page.locator('.lp-lead').textContent())?.trim()).toBe(LEAD);

        const key = page.getByRole('link', { name: /^Run a what-if in the demo/ });
        await expect(key).toBeVisible();
        await expect(key).toHaveAttribute('href', '/sim');
        await expect(key.locator('.lp-key-label')).toHaveText('Run a what-if');
        await expect(key.locator('.lp-key-line')).not.toBeEmpty();
        expect(await page.locator('.lp-first a.lp-key').count(), 'one filled key on the first screen').toBe(1);

        await expect(page.getByRole('region', { name: 'Install command' })).toHaveText('npm install paracosm');
        await expect(page.getByRole('button', { name: 'Copy the install command' })).toBeVisible();

        const trust = page.locator('.lp-trust');
        await expect(trust).toContainText('Open-source simulation engine in TypeScript');
        await expect(trust).toContainText('Apache-2.0');
        await expect(trust).toContainText('Built on AgentOS');
        await expect(trust).toContainText(`v${VERSION} on npm`);
        await expect(trust.getByRole('link', { name: 'AgentOS' })).toHaveAttribute('href', 'https://agentos.sh');
        await expect(trust.getByRole('link', { name: 'Paracosm on npm' })).toHaveAttribute('href', 'https://www.npmjs.com/package/paracosm');

        // The key and the replay stand on the first screen.
        const keyBox = await key.boundingBox();
        expect(keyBox && keyBox.y + keyBox.height <= viewport.height, 'the Run key is inside the first screen').toBe(true);
        const replayBox = await replay(page).boundingBox();
        expect(replayBox && replayBox.y < viewport.height, 'the replay starts inside the first screen').toBe(true);

        // Under reduced motion the replay rests on the verdict, paused.
        const last = digest.turns + 1;
        expect(await frameOf(page)).toBe(last);
        await expect(playKey(page)).toHaveText('Play');
        await expect(replay(page).locator('.lp-verdict')).toContainText(digest.verdict.winner);
        expect(await aliveCells(page)).toEqual(digest.verdict.population);

        await expect(replay(page).getByText('A saved run', { exact: true })).toBeVisible();
        await expect(replay(page).locator('.lp-replay-figures')).toHaveText(`${digest.scenario} · 2 leaders · ${digest.turns} turns · seed ${digest.seed}`);
        await expect(replay(page).getByText('A replay of a finished run. No model is called.')).toBeVisible();

        const demoLink = page.getByRole('link', { name: 'Open this run in the demo' });
        await expect(demoLink).toHaveAttribute('href', `/sim?replay=${digest.session}&tab=sim`);

        // Words at their floors in the bar and the first screen. The primary
        // key's label and the logotype are the page's two named exceptions.
        for (const part of [page.locator('.lp-bar'), page.locator('.lp-first')]) {
          const words = await measureText(page, part);
          expect(words.length).toBeGreaterThan(0);
          const under = failures(words).filter(word => !/lp-key|lp-wordmark|lp-h1|lp-cosm/.test(word.selector));
          expect(under.map(saidOf), `words under their figures at ${viewport.width} px, ${look}`).toEqual([]);
        }
        const leadPx = await page.locator('.lp-lead').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(leadPx).toBeGreaterThanOrEqual(18);
        const smallest = await page.locator('.lp-bar, .lp-first').evaluateAll(parts => {
          let least = Infinity;
          for (const part of parts) {
            const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const el = node.parentElement;
              if (!el || !node.textContent?.trim()) continue;
              const box = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              if (box.width === 0 || style.visibility === 'hidden' || el.closest('[hidden], .lp-sr')) continue;
              least = Math.min(least, parseFloat(style.fontSize));
            }
          }
          return least;
        });
        expect(smallest, 'no word under 15 px').toBeGreaterThanOrEqual(15);

        // The primary key's label holds 4.5 to 1 or more, the floor its exception keeps.
        const keyRatio = await key.evaluate((el) => {
          const lum = (rgb: string) => {
            const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const label = el.querySelector('.lp-key-label') as HTMLElement;
          const a = lum(getComputedStyle(label).color);
          const b = lum(getComputedStyle(el).backgroundColor);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
        expect(keyRatio).toBeGreaterThanOrEqual(4.5);

        expect(errors, 'no page error').toEqual([]);
      } finally {
        await close();
      }
    });
  }
}

test('the header stays one row from 320 to 768 px, three controls under 600 px and five from 600 px', async ({ browser }) => {
  for (const look of LOOKS) {
    for (const width of [320, 360, 390, 430, 480, 768]) {
      const { page, errors, close } = await open(browser, look, { viewport: { width, height: 800 } });
      try {
        const items = page.locator('.lp-bar-row > a, .lp-bar-row .lp-nav > a, .lp-bar-row .lp-nav > button').filter({ visible: true });
        const boxes = await items.evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON() as DOMRect));
        expect(boxes.length, `${width} px, ${look}: controls in the row`).toBe(width < 600 ? 3 : 5);
        const middles = boxes.map(box => box.y + box.height / 2);
        expect(Math.max(...middles) - Math.min(...middles), `${width} px, ${look}: one row`).toBeLessThanOrEqual(1);
        for (const box of boxes) expect(box.height, `${width} px: a target of 44 px`).toBeGreaterThanOrEqual(44);
        const bar = await page.locator('.lp-bar').boundingBox();
        expect(bar?.height, `${width} px, ${look}: the bar is 56 px high`).toBeLessThanOrEqual(57);
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(sideways, `${width} px, ${look}: nothing scrolls sideways`).toBeLessThanOrEqual(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    }
  }
});

test('the replay plays by itself, pauses on Pause and plays again on Play', async ({ browser }) => {
  const { page, errors, close } = await open(browser, 'dark', { viewport: { width: 1440, height: 900 } });
  try {
    await ready(page);
    await expect.poll(() => frameOf(page), { timeout: 12_000, message: 'the replay moves on from turn 0 by itself' }).toBeGreaterThanOrEqual(1);
    await expect(playKey(page)).toHaveText('Pause');
    await playKey(page).click();
    await expect(playKey(page)).toHaveText('Play');
    const held = await frameOf(page);
    await page.waitForTimeout(3_500);
    expect(await frameOf(page), 'no frame follows a Pause').toBe(held);
    if (held < digest.turns + 1) {
      await playKey(page).click();
      await expect(playKey(page)).toHaveText('Pause');
      await expect.poll(() => frameOf(page), { timeout: 8_000 }).toBeGreaterThan(held);
      await playKey(page).click();
    }
    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});

for (const viewport of VIEWPORTS) {
  test(`the run line, Previous turn and Next turn step the saved run frame by frame at ${viewport.width} px`, async ({ browser }) => {
    const look: Look = viewport.width === 390 ? 'light' : 'dark';
    const { page, errors, close } = await open(browser, look, { viewport, reducedMotion: 'reduce' });
    try {
      await ready(page);
      const last = digest.turns + 1;
      const previous = replay(page).getByRole('button', { name: /^Previous turn/ });
      const next = replay(page).getByRole('button', { name: /^Next turn/ });
      await expect(runLine(page)).toHaveAttribute('aria-valuetext', 'Verdict');
      await expect(next).toBeDisabled();

      await previous.click();
      expect(await frameOf(page)).toBe(last - 1);
      await expect(runLine(page)).toHaveAttribute('aria-valuetext', `Turn ${digest.turns} of ${digest.turns}`);
      await next.click();
      expect(await frameOf(page)).toBe(last);

      // The run line is one tab stop worked by Home, End and the arrow keys.
      await runLine(page).focus();
      await page.keyboard.press('Home');
      expect(await frameOf(page)).toBe(0);
      await expect(runLine(page)).toHaveAttribute('aria-valuetext', `Turn 0 of ${digest.turns}`);
      await expect(previous).toBeDisabled();
      await expect(replay(page).locator('.lp-start')).toContainText(`Both colonies start with the same ${digest.start.people.length} people`);
      expect(await replay(page).locator('.lp-start .lp-cell').count(), 'turn 0 draws one shared colony').toBe(digest.start.people.length);

      for (let turn = 1; turn <= digest.turns; turn++) {
        await page.keyboard.press('ArrowRight');
        expect(await frameOf(page)).toBe(turn);
        await expect(runLine(page)).toHaveAttribute('aria-valuetext', `Turn ${turn} of ${digest.turns}`);
        const frame = digest.frames[turn - 1];
        const sides = replay(page).locator('.lp-side');
        await expect(sides).toHaveCount(2);
        for (const index of [0, 1] as const) {
          const side = sides.nth(index);
          const want = frame.sides[index];
          await expect(side.locator('.lp-name')).toContainText(digest.leaders[index].name);
          await expect(side.locator('.lp-event')).toHaveText(want.event);
          await expect(side.locator('.lp-decision')).toHaveText(want.decision);
          await expect(side.locator('.lp-outcome')).toHaveText({
            risky_success: 'RISKY WIN', risky_failure: 'RISKY LOSS', conservative_success: 'SAFE WIN', conservative_failure: 'SAFE LOSS',
          }[want.outcome] ?? '');
        }
        expect(await aliveCells(page), `turn ${turn}: each colony's people alive`).toEqual(frame.sides.map(side => alive(side.people)));
      }
      await page.keyboard.press('End');
      expect(await frameOf(page)).toBe(last);
      await expect(replay(page).locator('.lp-verdict')).toContainText(`Where they split: turn ${digest.verdict.splitTurn}`);
      // The two timelines end apart.
      expect(digest.verdict.population[0]).not.toBe(digest.verdict.population[1]);

      // A press of the slider's track moves it too.
      const track = await runLine(page).boundingBox();
      if (!track) throw new Error('the run line has no box');
      await page.mouse.click(track.x + 4, track.y + track.height / 2);
      expect(await frameOf(page)).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });
}

test('under reduced motion the replay rests on the verdict and nothing moves', async ({ browser }) => {
  const { page, errors, close } = await open(browser, 'light', { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    await ready(page);
    const last = digest.turns + 1;
    expect(await frameOf(page)).toBe(last);
    await page.waitForTimeout(3_000);
    expect(await frameOf(page)).toBe(last);
    await expect(playKey(page)).toHaveText('Play');
    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});

test('Open this run in the demo opens the saved run in /sim', async ({ browser }) => {
  const { page, errors, close } = await open(browser, 'dark', { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    await ready(page);
    await page.getByRole('link', { name: 'Open this run in the demo' }).click();
    await expect(page).toHaveURL(new RegExp(`/sim\\?replay=${digest.session}&tab=sim$`));
    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});

/** The count events the hosted server forwarded for one browser, by its user agent. */
async function forwarded(agent: string): Promise<Array<{ name?: string; url?: string; props?: Record<string, string> }>> {
  const all = await (await fetch(`${SINK}/received`)).json() as Array<{ body: { name?: string; url?: string; props?: Record<string, string> }; userAgent: string | null }>;
  return all.filter(event => event.userAgent === agent).map(event => event.body);
}

for (const look of LOOKS) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
    test(`on a first visit the analytics choices bar stands clear of the Run key at ${viewport.width} by ${viewport.height} px, ${look}`, async ({ browser }) => {
      const { page, errors, close } = await open(browser, look, { base: HOSTED, viewport });
      try {
        const bar = page.getByRole('region', { name: 'Analytics choices' });
        await expect(bar).toBeVisible();
        const barBox = await bar.boundingBox();
        const keyBox = await page.getByRole('link', { name: /^Run a what-if in the demo/ }).boundingBox();
        if (!barBox || !keyBox) throw new Error('the bar or the key has no box');
        const clear = barBox.y - (keyBox.y + keyBox.height);
        test.info().annotations.push({ type: 'clearance', description: `${viewport.width} by ${viewport.height}, ${look}: the key's bottom stands ${Math.round(clear)} px above the bar` });
        // The floor holds at 390 by 844; at 360 by 800 the clearance is measured and reported.
        if (viewport.width === 390) expect(clear, 'the key’s bottom stands 16 px or more above the bar').toBeGreaterThanOrEqual(16);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });
  }
}

test('the key, Copy, the replay and the look switch send their fixed events as the landing page’s', async ({ browser }) => {
  const agent = `paracosm-landing-e2e/${Math.random().toString(36).slice(2, 10)}`;
  // A tall window keeps the replay's keys above the analytics choices bar, which stays up unanswered so the count runs.
  const { page, errors, close } = await open(browser, 'dark', { base: HOSTED, viewport: { width: 1440, height: 1400 }, userAgent: agent });
  try {
    await ready(page);
    await expect.poll(async () => (await forwarded(agent)).some(event => event.name === 'lp_replay' && event.props?.action === 'auto_start'), { timeout: 12_000 }).toBe(true);
    await playKey(page).click();
    await page.getByRole('button', { name: 'Copy the install command' }).click();
    await expect(page.locator('.lp-copy-status')).not.toBeEmpty();
    const copyResult = (await page.locator('.lp-copy-status').textContent())?.trim();
    await page.getByRole('button', { name: 'Switch to the light look' }).click();
    await expect(page.getByRole('button', { name: 'Switch to the dark look' })).toBeVisible();
    await page.getByRole('link', { name: /^Run a what-if in the demo/ }).click();
    await expect(page).toHaveURL(/\/sim$/);

    await expect.poll(async () => (await forwarded(agent)).map(event => event.name).sort(), { timeout: 10_000 })
      .toEqual(expect.arrayContaining(['lp_copy', 'lp_demo_open', 'lp_look', 'lp_replay']));
    const events = await forwarded(agent);
    const landing = events.filter(event => event.name?.startsWith('lp_'));
    for (const event of landing) expect(event.url, `${event.name} counts as the landing page`).toBe('https://paracosm.agentos.sh/');
    expect(landing).toContainEqual(expect.objectContaining({ name: 'lp_replay', props: { action: 'pause', motion: 'full' } }));
    expect(landing).toContainEqual(expect.objectContaining({ name: 'lp_look', props: { to: 'light' } }));
    expect(landing).toContainEqual(expect.objectContaining({ name: 'lp_demo_open', props: { from: 'hero', state: 'unknown' } }));
    const copy = landing.find(event => event.name === 'lp_copy');
    expect(copy?.props?.what).toBe('install');
    expect(copy?.props?.result).toBe(copyResult === 'The line was copied.' ? 'copied' : 'refused');
    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});
