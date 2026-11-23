/**
 * The Run tab's first screen on /sim, as a first-time visitor meets it.
 *
 * The page talks to the real server over HTTP and SSE, in hosted_demo mode
 * with one run a day for each internet address
 * (tests-e2e/support/first-screen-server.ts): GET /scenario, GET
 * /admin-config, GET /rate-limit and GET /sessions answer as the hosted demo
 * answers them. Each test, and each retry of it, sends an internet address
 * of its own in x-real-ip, so no two share a day's count. A case that needs
 * a slow, failed or different scenario answer stands in for it with
 * page.route on /scenario; everything else is the server's own answer.
 *
 * The scenario line (feature 3):
 * - The scenario's name is the page's one h1, visible, under the mark
 *   SCENARIO; three sentences say what the AI leaders do, what Start does
 *   and what ends the run; one line of figures gives the run's people,
 *   departments, turns and events a turn, as the run will use them: the
 *   host's caps on a free run, the scenario's own on a visitor's key.
 * - Shapes of the final size stand until the scenario answers, and the
 *   words replace them with no jump; another scenario's name is never
 *   painted first.
 * - A scenario that did not load, or a page gone offline, says so beside
 *   the broken-link mark with a Try now key, and no Start is active.
 * - The title and description say what the page does.
 *
 * The leaders at a pair (feature 5):
 * - From 1,100 px two cards stand side by side, each with the leader's place
 *   figure, name, title, six scores as bars with their figures and its
 *   written orders whole, each score at the same height on both cards.
 * - Under 1,100 px one card shows at a time under a switch of two keys, and
 *   one table holds both leaders' scores, a column a leader.
 * - A score outside 0.35 to 0.65 fills in the accent; one inside the band or
 *   on its edge fills in the control edge.
 * - A scenario with no written leaders shows two cards named Leader 1 and
 *   Leader 2 with empty score tracks, and shapes of the cards' size stand
 *   until the scenario answers.
 *
 * The shared colony panel (feature 14 before Start):
 * - Exactly one colony field: the living grid drawing the scenario's key
 *   people at turn 0, at rest, with each featured person's name set over the
 *   field as text and no two names overlapping.
 * - It waits for the scenario, and a scenario that names no key people keeps
 *   the panel's frame with a sentence and no canvas.
 * - On the light look's canvas ground the grid's tones read 4.5 to 1.
 *
 * The run's size (feature 4), and the screen at 24 and 300 leaders:
 * - A run on the host's keys is a pair, said in words. On the visitor's own
 *   key, or on a server that is not the hosted demo, the size is a number
 *   from 2 to 300 with a fewer key and a more key, kept in the address.
 * - Above 2 the screen keeps the two written leaders and one colony field,
 *   says Paracosm writes all the leaders when the run starts, and writes the
 *   scenario line and the panel's caption for that size.
 *
 * Start, the notice and the launch (feature 10):
 * - One filled key says the run's length and who pays, with the run line
 *   beside it and the notice in the page. It stays at the bottom edge until
 *   its place in the page is reached, above the consent bar when that shows.
 * - One press reads the day's count again, writes the leaders a larger run
 *   needs, posts exactly one /setup and opens Watch; the first screen stays
 *   until then.
 *
 * At the day's limit, and when Start fails (feature 10):
 * - With no free run left and no key saved, two paragraphs take the
 *   notice's place, the first with the reset time and zone beside a clock
 *   face whose hands show it; a filled key in Start's place replays the
 *   visitor's last run, or the team's run when this browser has none, with
 *   no model call; with neither there is no filled key, only the link to
 *   Settings. The scenario line leaves out the sentence that names Start.
 * - A limit met between the page's read and the press is found by /setup's
 *   refusal and said the same way, with no raw server text.
 * - A failed /setup is one sentence above an active Start, beside its mark:
 *   no connection, a busy server, every run slot in use, or any other
 *   refusal. A count that cannot be read leaves Start active, and a saved-run
 *   list that did not load at the limit is said with a Try again key.
 *
 * The grid on the Sim tab, one Start, and no tour (feature 14 once the run
 * starts; features 11 and 12):
 * - Once Start opens the run, the Sim tab shows each leader's own colony in
 *   the living grid: a pair's two panels side by side from a tablet up and
 *   stacked on a phone, the first in the grid's amber and the second in its
 *   teal, holding the people the shared panel showed. The stub runner sends
 *   each leader's roster at turn 1 from the run's own kernel, and a second
 *   port (3472) answers what it sent.
 * - A run of 3, 24 or 300 leaders, replayed from a server of stored runs
 *   (tests-e2e/support/cohort-replay-server.ts, port 3471), shows the track
 *   of one panel a leader, and the page does not scroll sideways.
 * - Under reduced motion a panel holds still between turns.
 * - Start is the one control that starts a new run: saved runs are in Library,
 *   run files open in Studio, and the Sim tab's empty state offers no run or tour.
 * - No tour opens by itself on a first visit.
 *
 * How it works (feature 11):
 * - The header's key opens one card on every tab: six lines that state the
 *   rules of a run, with three drawings of one sample turn, each inside its
 *   own line. The fourth line names the run's turns and the scenario's word
 *   for a settlement, and reads "After the last turn" and "each side" until
 *   the scenario has loaded. The card asks the server for nothing, so it
 *   opens whole offline.
 * - Close and Escape close it and return focus to the key; from a tablet up
 *   a press outside closes it and reaches the page. On a phone it is a
 *   sheet from the bottom edge that holds focus; from 600 px it is a panel
 *   under the key, 480 px wide, then 760 px from 1,100 px and 960 px from
 *   1,440 px, where the drawings stand in one band over two columns of
 *   lines. At 200 per cent text it scrolls inside its own height with Close
 *   in view.
 *
 * Other scenarios, Write your own scenario, the notes and the foot
 * (features 12 and 13):
 * - Under Start, one list of the server's scenarios: the bundled ones, then
 *   the visitor's own under Yours. A row shows the scenario's name and its
 *   departments, loads it with the page's reload, and never runs one. The
 *   row of the scenario above says On screen now and cannot be pressed.
 *   Show all opens the rest in place. A list or a row that did not load,
 *   and a choice made offline, say so beside a Try again key or the
 *   broken-link mark. A server with one scenario has no list.
 * - Write your own scenario keeps the paste form under the list. On a run
 *   on the host's keys it has no Actors slider and no dollar figure and its
 *   key reads Generate and run; at the day's limit it says so above that
 *   key and asks the server for nothing. A draft of 200 characters or more
 *   holds Start, with a link to the draft and a key that clears it.
 * - The fictional note stands under the leaders' heading row, the AI note
 *   and the adults note above Start's notice, and the foot ends the page:
 *   the adults line, the site's links in one row, Analytics choices and the
 *   licence line. The idle tab shows no status, dollar figure or token count.
 *
 * - Every word and glyph meets its figure, every row stays one row, and the
 *   automated check finds no WCAG 2.2 A or AA failure.
 *
 * The sweep, 200 per cent text and the pictures (every feature above):
 * - Every state (ready at a pair, starting, no free run left, the visitor's
 *   own key at 24 and at 300, and a self-hosted server) at 320, 390, 600,
 *   768, 1,100 and 1,440 px in both looks meets every figure, keeps every
 *   row one row and scrolls nothing sideways, and the automated check finds
 *   nothing at the ready and no-run-left states.
 * - At 200 per cent text (every type size doubled, as a browser's text-only
 *   zoom does, in a 320 px window) nothing is cut and nothing scrolls
 *   sideways: the scenario line's sentences and figures wrap, the figures in
 *   one column; Start holds both of its lines; each row of Other scenarios
 *   holds its lines; the notes wrap; and the foot's row holds Privacy and a
 *   More links key, whose menu holds Docs, GitHub and npm.
 * - The pictures of the pull request: the whole Run tab at 390 and 1,440 px
 *   in both looks, ready, with no free run left and on the visitor's own key
 *   at 24, the How it works card, and Watch on the stub pair.
 *
 * Each width and look saves pictures into test-pictures/sim-first-screen/,
 * which CI uploads.
 */
import { test, expect, type Browser, type BrowserContext, type Locator, type Page, type Route, type TestInfo } from '@playwright/test';
import { openTab } from '../support/frame.js';
import { FIRST_SCREEN, axeFindings, measureReadability, rowsOnOneRow } from '../support/first-screen-measure.js';
import { spacingFaults } from '../support/readability.js';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The hosted demo server lives on a local port of its own.');

const SERVER = 'http://127.0.0.1:3470';
const PICTURES = 'test-pictures/sim-first-screen';

test.use({ baseURL: SERVER, deviceScaleFactor: 2 });

type Look = 'light' | 'dark';
const LOOKS: readonly Look[] = ['light', 'dark'];
const sizeAt = (width: number) => ({ width, height: width < 900 ? 844 : 900 });
const PHONE = sizeAt(390);
const WIDE = sizeAt(1440);

/** The three sentences of a pair, with the fallback place phrase every scenario reads until scenarios name their place. */
const PAIR_SENTENCES = 'Two AI leaders each run this scenario for 6 turns, each under its own orders. Press Start to watch them decide. At the end, a verdict says who won and why.';
/** A free run of Mars Genesis, under the hosted demo's caps of 30 people, 3 departments and 6 turns. */
const FREE_FIGURES = '30 people · 3 departments · 6 turns · up to 2 events a turn';
/** The same figures as a screen reader reads them, as one sentence. */
const FREE_FIGURES_SPOKEN = '30 people, 3 departments, 6 turns, up to 2 events a turn';
/** A run on the visitor's own key reads the scenario's own figures. */
const OWN_KEY_FIGURES = '100 people · 5 departments · 6 turns · up to 2 events a turn';
const DID_NOT_LOAD = 'The scenario did not load. Trying again.';
const OFFLINE = 'You are offline. The scenario loads when you are back online.';
const TITLE = 'Watch AI leaders run the same scenario | Paracosm';

/** Mars Genesis's two written leaders, with their six scores to two places in the order the cards draw them. */
const ARIA = { place: '1', name: 'Aria Chen', title: 'The Visionary', scores: ['0.95', '0.35', '0.85', '0.55', '0.30', '0.65'] };
const DIETRICH = { place: '2', name: 'Dietrich Voss', title: 'The Engineer', scores: ['0.25', '0.97', '0.30', '0.60', '0.70', '0.90'] };
const PAIR = [ARIA, DIETRICH] as const;
/** The spoken names of the two switch keys: each holds the words its key shows, "1 Aria Chen" and "2 Dietrich Voss". */
const SHOW_ARIA = 'Show leader 1 Aria Chen';
const SHOW_DIETRICH = 'Show leader 2 Dietrich Voss';
const TRAITS = ['Openness', 'Conscientiousness', 'Extraversion', 'Agreeableness', 'Emotionality', 'Honesty-humility'];
const MIDDLE_BAND = 'Middle band 0.35 to 0.65';
const HEXACO_NOTE = 'HEXACO is a six-trait personality model. The six scores above are this leader’s.';
const NO_WRITTEN_LEADERS = 'This scenario has no written leaders. Paracosm writes them when you press Start.';

/** The shared colony panel on a free run of Mars Genesis: its five key people stand in four departments. */
const COLONY_FIGURES = '5 key people · 4 departments';
const COLONY_CAPTION = 'Both colonies start with the same 30 people, these 5 among them. Each leader’s decisions make them diverge.';
const COLONY_SPOKEN = 'The colony at turn 0: 5 of its 30 people, in 4 departments, the same for every leader';
const COLONY_KEY = ['Department', 'Person', 'Featured person'];
const NO_KEY_PEOPLE = 'This scenario names no key people. Its colony is drawn when the run starts.';
/** The field's height at each width the panel is laid out for. */
const FIELD_HEIGHTS: ReadonlyArray<readonly [number, number]> = [[320, 170], [390, 190], [600, 200], [1100, 250], [1440, 280]];
const DESCRIPTION = 'Read each AI leader’s orders and full prompt, compare leaders side by side, then watch 2 to 300 of them run the same scenario turn by turn.';

let defined = 0;
/**
 * A test of this spec: before its body runs, its context sends an internet
 * address of its own (198.51.100.n, three a test so each retry has its own).
 * Every test is a first visit: its browser holds nothing of an earlier one.
 */
function screenTest(
  title: string,
  body: (fixtures: { page: Page; context: BrowserContext; browser: Browser }, info: TestInfo) => Promise<void>,
): void {
  const index = defined++;
  test(title, async ({ page, context, browser }, info) => {
    await context.setExtraHTTPHeaders({ 'x-real-ip': `198.51.100.${1 + index * 3 + info.retry}` });
    await body({ page, context, browser }, info);
  });
}

/** Sets the look the next page load opens in: the last look set wins, since init scripts run in the order they were added. */
async function useLook(page: Page, look: Look): Promise<void> {
  await page.addInitScript((l) => { window.localStorage.setItem('paracosm-theme', l); }, look);
}

/** Opens /sim at one size in one look; resolves once the page shows that look. */
async function openRun(page: Page, size: { width: number; height: number }, look: Look): Promise<Locator> {
  await page.setViewportSize(size);
  await useLook(page, look);
  await page.goto('/sim');
  await page.waitForFunction((l) => document.documentElement.classList.contains('light') === (l === 'light'), look);
  return page.locator(FIRST_SCREEN);
}

/** Opens /sim and waits for the scenario line to show the scenario's name. */
async function openReady(page: Page, size: { width: number; height: number }, look: Look, name = 'Mars Genesis'): Promise<Locator> {
  const root = await openRun(page, size, look);
  await expect(root.getByRole('heading', { level: 1, name })).toBeVisible();
  // The served faces lay the words out; measure after they load.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(root.getByTestId('scenario-figures')).toBeVisible();
  return root;
}

const picture = (page: Page, name: string) =>
  page.screenshot({ path: `${PICTURES}/${name}.png`, animations: 'disabled' });

/** The page's Start key while it can be pressed. None may be active until the scenario has loaded. */
const activeStart = (root: Locator): Locator => root.getByRole('button', { name: /^start\b/i, disabled: false });

/** Each word of a part's text: the top of its first line box, and how many line boxes it spans. */
const wordLines = (part: Locator) => part.evaluate((el) => {
  const out: Array<{ word: string; top: number; boxes: number }> = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? '';
    const words = /\S+/g;
    for (let m = words.exec(text); m; m = words.exec(text)) {
      const range = document.createRange();
      range.setStart(n, m.index);
      range.setEnd(n, m.index + m[0].length);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (rects.length === 0) continue;
      out.push({ word: m[0], top: Math.round(rects[0].top), boxes: new Set(rects.map((r) => Math.round(r.top))).size });
    }
  }
  return out;
});

/** The words on a part's last line. */
async function lastLine(part: Locator): Promise<string[]> {
  const words = await wordLines(part);
  const lowest = Math.max(...words.map((w) => w.top));
  return words.filter((w) => Math.abs(w.top - lowest) <= 2).map((w) => w.word);
}

/** How many lines a part's words stand on. */
async function lineCount(part: Locator): Promise<number> {
  const tops: number[] = [];
  for (const w of await wordLines(part)) if (!tops.some((t) => Math.abs(t - w.top) <= 2)) tops.push(w.top);
  return tops.length;
}

const box = async (part: Locator) => {
  const b = await part.boundingBox();
  if (!b) throw new Error('the part is not laid out');
  return b;
};

/** Moves the page's context to another bundled scenario, through the server's own switch. */
async function switchScenario(page: Page, id: string): Promise<void> {
  const res = await page.request.post(`${SERVER}/scenario/switch`, { data: { id } });
  expect(res.ok(), `the server switches to ${id}`).toBe(true);
}

screenTest('feature 3: one h1, the paragraph and the figures on a free run', async ({ page }) => {
  test.setTimeout(120_000);
  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        const root = await openReady(page, size, look);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mars Genesis');
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(root.getByTestId('scenario-sentences')).toHaveText(PAIR_SENTENCES);
        await expect(root.getByTestId('scenario-figures')).toHaveText(FREE_FIGURES);
        await expect(root.locator('img')).toHaveCount(0);

        // Feature 3, QA step 14: the sizes.
        const sentences = await root.getByTestId('scenario-sentences').evaluate((el) => {
          const cs = getComputedStyle(el);
          return { size: parseFloat(cs.fontSize), lineHeight: parseFloat(cs.lineHeight) };
        });
        expect(sentences.size).toBe(18);
        expect(sentences.lineHeight / sentences.size).toBeGreaterThanOrEqual(1.5);
        expect(await root.getByTestId('scenario-figures').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(15);
        expect(await page.getByRole('heading', { level: 1 }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(28);
        const mark = root.getByTestId('scenario-mark');
        await expect(mark).toHaveText('SCENARIO');
        const markStyle = await mark.evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), face: getComputedStyle(el).fontFamily }));
        expect(markStyle.size).toBe(15);
        expect(markStyle.face).toContain('JetBrains Mono');

        await picture(page, `scenario-line-${size.width}-${look}`);
      });
    }
  }
});

screenTest('feature 3: own key reads the scenario figures', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    window.localStorage.setItem('paracosm:keyOverrides', '{"openai":"sk-test"}');
  });
  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        const root = await openReady(page, size, look);
        await expect(root.getByTestId('scenario-figures')).toHaveText(OWN_KEY_FIGURES);
        await expect(root.getByTestId('scenario-sentences')).toHaveText(PAIR_SENTENCES);
        await picture(page, `scenario-line-own-key-${size.width}-${look}`);
      });
    }
  }
});

screenTest('feature 3: shapes first, then the words with no jump', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const w = window as unknown as { firstScreenShift: number };
    w.firstScreenShift = 0;
    new PerformanceObserver((list) => {
      const root = document.querySelector('[data-testid="run-first-screen"]');
      for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean; sources?: Array<{ node?: Node | null }> }>) {
        if (entry.hadRecentInput || !root) continue;
        if ((entry.sources ?? []).some((s) => s.node && root.contains(s.node))) w.firstScreenShift += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  for (const look of LOOKS) {
    await test.step(`390 in the ${look} look`, async () => {
      let release: () => void = () => {};
      const answered = new Promise<void>((resolve) => { release = resolve; });
      await page.route('**/scenario', async (route: Route) => {
        const response = await route.fetch();
        await answered;
        await route.fulfill({ response });
      });
      const root = await openRun(page, PHONE, look);
      const busy = root.locator('[aria-busy="true"]');
      await expect(busy).toBeVisible();
      // The mark, the heading, the sentences and the figures, each as a shape.
      expect(await root.locator('[data-shape]').count()).toBeGreaterThanOrEqual(4);
      await expect(root.getByRole('heading', { level: 1 })).toHaveCount(0);
      const before = await box(busy);
      await picture(page, `scenario-line-loading-390-${look}`);

      release();
      await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis' })).toBeVisible();
      await expect(root.locator('[aria-busy="true"]')).toHaveCount(0);
      const after = await box(root.getByTestId('scenario-line'));
      // Nothing moves when the words replace the shapes: under a tenth of the window.
      expect(Math.abs(after.height - before.height)).toBeLessThan(PHONE.height * 0.1);
      const shift = await page.evaluate(() => (window as unknown as { firstScreenShift: number }).firstScreenShift);
      expect(shift).toBeLessThan(0.1);
      await page.unroute('**/scenario');
    });
  }
});

screenTest('feature 3: never paints another scenario first', async ({ page }) => {
  await switchScenario(page, 'lunar-outpost');
  // The screen's words, Other scenarios left out: once Lunar Outpost shows, that list
  // names Mars Genesis as a scenario a press loads, which is no painting of it.
  await page.addInitScript(() => {
    const w = window as unknown as { marsPainted: boolean };
    w.marsPainted = false;
    new MutationObserver(() => {
      const root = document.querySelector('[data-testid="run-first-screen"]');
      if (!root) return;
      let words = '';
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.parentElement?.closest('[data-testid="other-scenarios"]')) words += n.textContent ?? '';
      }
      if (words.includes('Mars Genesis')) w.marsPainted = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  for (const look of LOOKS) {
    await test.step(`390 in the ${look} look`, async () => {
      let release: () => void = () => {};
      const answered = new Promise<void>((resolve) => { release = resolve; });
      await page.route('**/scenario', async (route: Route) => {
        const response = await route.fetch();
        await answered;
        await route.fulfill({ response });
      });
      const root = await openRun(page, PHONE, look);
      await expect(root.locator('[aria-busy="true"]')).toBeVisible();
      await expect(root).not.toContainText('Mars Genesis');
      release();
      await expect(root.getByRole('heading', { level: 1, name: 'Lunar Outpost' })).toBeVisible();
      await expect(root.getByTestId('scenario-figures')).toHaveText(FREE_FIGURES);
      expect(await page.evaluate(() => (window as unknown as { marsPainted: boolean }).marsPainted)).toBe(false);
      await page.unroute('**/scenario');
    });
  }
});

screenTest('feature 3: did not load, retry, offline', async ({ page, context }) => {
  test.setTimeout(150_000);
  for (const look of LOOKS) {
    await test.step(`did not load and Try now, 390 in the ${look} look`, async () => {
      let mode: 'blocked' | 'slow' = 'blocked';
      await page.route('**/scenario', async (route: Route) => {
        if (mode === 'blocked') return route.abort('failed');
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return route.continue();
      });
      const root = await openRun(page, PHONE, look);
      await expect(root.getByRole('status')).toHaveText(DID_NOT_LOAD);
      // The scenario line's own mark: Start's band draws one beside its offline sentence too.
      await expect(root.getByTestId('scenario-line').locator('[data-mark="broken-link"]')).toBeVisible();
      const tryNow = root.getByRole('button', { name: 'Try now' });
      await expect(tryNow).toBeVisible();
      await expect(activeStart(root)).toHaveCount(0);
      await picture(page, `scenario-line-did-not-load-390-${look}`);

      mode = 'slow';
      await tryNow.click();
      const trying = root.getByRole('button', { name: 'Trying…' });
      await expect(trying).toBeVisible();
      await expect(trying).toBeDisabled();
      await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis' })).toBeVisible();
      await expect(root.getByTestId('scenario-sentences')).toHaveText(PAIR_SENTENCES);
      await expect(root.getByTestId('scenario-figures')).toHaveText(FREE_FIGURES);
      await page.unroute('**/scenario');
    });

    await test.step(`offline, 390 in the ${look} look`, async () => {
      let offline = false;
      // The page's first scenario request, held until the page is offline.
      const first: { route?: Route } = {};
      let held: () => void = () => {};
      const arrived = new Promise<void>((resolve) => { held = resolve; });
      await page.route('**/scenario', async (route: Route) => {
        if (offline) return route.abort('internetdisconnected');
        if (!first.route) {
          first.route = route;
          held();
          return;
        }
        return route.continue();
      });
      const root = await openRun(page, PHONE, look);
      await arrived;
      offline = true;
      await context.setOffline(true);
      await first.route?.abort('internetdisconnected');
      await expect(root.getByRole('status')).toHaveText(OFFLINE);
      await expect(root.getByTestId('scenario-line').locator('[data-mark="broken-link"]')).toBeVisible();
      await expect(root.getByRole('button', { name: 'Try now' })).toBeVisible();
      await expect(activeStart(root)).toHaveCount(0);
      await picture(page, `scenario-line-offline-390-${look}`);

      // Back online, the scenario loads by itself.
      offline = false;
      await context.setOffline(false);
      await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis' })).toBeVisible({ timeout: 20_000 });
      await page.unroute('**/scenario');
    });
  }
});

screenTest('feature 3: a scenario with no place phrase and no events cap', async ({ page }) => {
  test.setTimeout(120_000);
  // A scenario a visitor compiled names no place and no events cap.
  await page.route('**/scenario', async (route: Route) => {
    const response = await route.fetch();
    const scenario = await response.json() as { id: string; labels: Record<string, unknown>; setup: Record<string, unknown> };
    scenario.id = 'harbour-trial';
    scenario.labels = { ...scenario.labels, name: 'Harbour Trial' };
    delete scenario.setup.maxEventsPerTurn;
    await route.fulfill({ response, json: scenario });
  });
  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        const root = await openReady(page, size, look, 'Harbour Trial');
        await expect(root.getByTestId('scenario-sentences')).toHaveText(PAIR_SENTENCES);
        // A pattern is matched against the text as the page holds it, where a
        // no-break space joins the figure to its unit.
        await expect(root.getByTestId('scenario-figures')).toHaveText(/ · up to 2\sevents a turn$/);
      });
    }
  }
});

screenTest('feature 3: the layout at each width', async ({ page }) => {
  test.setTimeout(240_000);
  for (const scenario of [{ id: 'mars-genesis', name: 'Mars Genesis' }, { id: 'dual-superintelligence-council', name: 'Dual Superintelligence Council' }]) {
    await switchScenario(page, scenario.id);
    for (const width of [320, 600, 1100, 1440]) {
      for (const look of LOOKS) {
        await test.step(`${scenario.name} at ${width} in the ${look} look`, async () => {
          const root = await openReady(page, sizeAt(width), look, scenario.name);
          const heading = root.getByRole('heading', { level: 1 });
          // The heading whole: no word cut across lines, nothing clipped.
          for (const w of await wordLines(heading)) expect(w.boxes, `"${w.word}" stands on one line`).toBe(1);
          expect(await heading.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
          // No sideways scroll.
          expect(await root.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

          const cells = root.getByTestId('scenario-figures').locator('[data-figure]');
          await expect(cells).toHaveCount(4);
          const [people, departments, turns, events] = await Promise.all([0, 1, 2, 3].map((i) => box(cells.nth(i))));
          if (width < 600) {
            // A two by two grid: people over turns at the left, departments over events at the right.
            expect(Math.abs(people.y - departments.y)).toBeLessThanOrEqual(2);
            expect(turns.y).toBeGreaterThan(people.y + people.height - 2);
            expect(Math.abs(people.x - turns.x)).toBeLessThanOrEqual(2);
            expect(Math.abs(departments.x - events.x)).toBeLessThanOrEqual(2);
          } else {
            // One line.
            for (const cell of [departments, turns, events]) expect(Math.abs(cell.y - people.y)).toBeLessThanOrEqual(2);
          }

          const headingBox = await box(heading);
          const sentencesBox = await box(root.getByTestId('scenario-sentences'));
          if (width >= 1100) {
            // One band: the heading at the left, the sentences in a column at the right.
            expect(sentencesBox.x).toBeGreaterThanOrEqual(headingBox.x + headingBox.width - 1);
          } else {
            expect(sentencesBox.y).toBeGreaterThanOrEqual(headingBox.y + headingBox.height - 1);
          }
          await picture(page, `scenario-line-layout-${scenario.id}-${width}-${look}`);
        });
      }
    }
  }
});

screenTest('feature 3: no line ends on a single word', async ({ page }) => {
  test.setTimeout(150_000);
  for (const width of [320, 390, 768, 1100, 1440]) {
    for (const look of LOOKS) {
      await test.step(`${width} in the ${look} look`, async () => {
        const root = await openReady(page, sizeAt(width), look);
        expect((await lastLine(root.getByTestId('scenario-sentences'))).length).toBeGreaterThanOrEqual(2);
        const heading = root.getByRole('heading', { level: 1 });
        if ((await lineCount(heading)) > 1) expect((await lastLine(heading)).length).toBeGreaterThanOrEqual(2);
      });
    }
  }
});

screenTest('feature 3: title and description', async ({ page }) => {
  for (const look of LOOKS) {
    await test.step(`1440 in the ${look} look`, async () => {
      await openReady(page, WIDE, look);
      expect(await page.evaluate(() => document.title)).toBe(TITLE);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', DESCRIPTION);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }
});

screenTest('feature 3: what a screen reader reads', async ({ page }) => {
  for (const look of LOOKS) {
    await test.step(`1440 in the ${look} look`, async () => {
      const root = await openReady(page, WIDE, look);
      const read = (await root.ariaSnapshot()).replace(/\u00a0/g, ' ');
      const heading = read.indexOf('heading "Mars Genesis" [level=1]');
      const sentences = read.indexOf(PAIR_SENTENCES);
      const figures = read.indexOf(FREE_FIGURES_SPOKEN);
      expect(heading, read).toBeGreaterThanOrEqual(0);
      expect(sentences, read).toBeGreaterThan(heading);
      expect(figures, read).toBeGreaterThan(sentences);
      // The mark is hidden, so the heading reads once; the figures read as a sentence, not as dots.
      expect(read).not.toContain('SCENARIO');
      expect(read).not.toContain('·');
    });
  }
});

/** A written leader as GET /scenario sends it. */
interface WrittenLeader { name: string; archetype: string; hexaco: Record<string, number>; instructions: string }
/** A key person as GET /scenario sends it. */
interface KeyPerson { name: string; department: string; role: string; specialization: string; age: number; featured: boolean }
interface ScenarioAnswer {
  id: string;
  labels: Record<string, unknown>;
  presets: Array<{ id: string; leaders?: WrittenLeader[]; actors?: WrittenLeader[]; personnel?: KeyPerson[] }>;
}

/** The scenario as the server answers it for this test's visitor. */
async function serverScenario(page: Page): Promise<ScenarioAnswer> {
  const res = await page.request.get(`${SERVER}/scenario`);
  expect(res.ok(), 'the server answers GET /scenario').toBe(true);
  return await res.json() as ScenarioAnswer;
}

const writtenOf = (scenario: ScenarioAnswer): WrittenLeader[] => scenario.presets[0]?.leaders ?? scenario.presets[0]?.actors ?? [];
const keyPeopleOf = (scenario: ScenarioAnswer): KeyPerson[] =>
  (scenario.presets.find((p) => p.id === 'default') ?? scenario.presets[0])?.personnel ?? [];

/** Answers GET /scenario with the server's own answer after `change` has edited it. */
async function routeScenario(page: Page, change: (scenario: ScenarioAnswer) => void): Promise<void> {
  await page.route('**/scenario', async (route: Route) => {
    const response = await route.fetch();
    const scenario = await response.json() as ScenarioAnswer;
    change(scenario);
    await route.fulfill({ response, json: scenario });
  });
}

/** Holds GET /scenario's answer until `release` is called. */
async function holdScenario(page: Page): Promise<() => void> {
  let release: () => void = () => {};
  const answered = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/scenario', async (route: Route) => {
    const response = await route.fetch();
    await answered;
    await route.fulfill({ response });
  });
  return release;
}

/** Before any page script runs: adds up the layout shifts of parts inside the first screen. */
async function watchShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { firstScreenShift: number };
    w.firstScreenShift = 0;
    new PerformanceObserver((list) => {
      const root = document.querySelector('[data-testid="run-first-screen"]');
      for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean; sources?: Array<{ node?: Node | null }> }>) {
        if (entry.hadRecentInput || !root) continue;
        if ((entry.sources ?? []).some((s) => s.node && root.contains(s.node))) w.firstScreenShift += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}
const shiftOf = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { firstScreenShift: number }).firstScreenShift);

/** A token's colour as the page computes it in the look it shows. */
const tokenColour = (page: Page, token: string): Promise<string> => page.evaluate((t) => {
  const probe = document.createElement('span');
  probe.style.color = `var(${t})`;
  document.body.appendChild(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, token);

const styleOf = (part: Locator) => part.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { size: parseFloat(cs.fontSize), face: cs.fontFamily, colour: cs.color, ground: cs.backgroundColor, align: cs.textAlign, weight: cs.fontWeight };
});

/** No sideways scroll: neither the first screen nor the page is wider than its box. */
async function expectNoSidewaysScroll(page: Page, root: Locator): Promise<void> {
  expect(await root.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'the first screen has no sideways scroll').toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'the page has no sideways scroll').toBe(true);
}

/** A score's bar inside a row or a cell: its track, its fill and the two ticks of the middle band. */
async function barOf(holder: Locator): Promise<{ track: number; fill: number; colour: string; ticks: number[] }> {
  return holder.evaluate((el) => {
    const track = el.querySelector('[data-score-track]');
    if (!track) throw new Error('no score track');
    const t = track.getBoundingClientRect();
    const fill = track.querySelector('[data-meter-fill]');
    const ticks = Array.from(track.querySelectorAll('[data-band-tick]')).map((tick) => {
      const r = tick.getBoundingClientRect();
      return ((r.left + r.right) / 2 - t.left) / t.width;
    });
    return {
      track: t.width,
      fill: fill ? fill.getBoundingClientRect().width / t.width : 0,
      colour: fill ? getComputedStyle(fill).backgroundColor : '',
      ticks,
    };
  });
}

/**
 * Where a part stands on the page, whatever is scrolled: its top in the
 * window, the same top with every scroll offset above it added back, and
 * those offsets themselves (the window's, then each part's above it).
 */
const placeOf = (part: Locator): Promise<{ viewTop: number; top: number; scrolls: string }> => part.evaluate((el) => {
  const viewTop = el.getBoundingClientRect().top;
  const offsets = [window.scrollY];
  for (let above = el.parentElement; above; above = above.parentElement) offsets.push(above.scrollTop);
  return { viewTop, top: viewTop + offsets.reduce((sum, n) => sum + n, 0), scrolls: offsets.join(',') };
});

/** A score's row in the pair's score table, by its place in the order the scores are drawn. */
const scoreRow = (table: Locator, index: number): Locator => table.locator('tbody tr').nth(index);

/** A part's words as they are shown: a soft hyphen, which shows only where a word wraps, left out. */
const shownText = (part: Locator): Promise<string> => part.evaluate((el) => (el.textContent ?? '').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim());

screenTest('feature 5: two cards at a pair', async ({ page }) => {
  test.setTimeout(180_000);
  const written = writtenOf(await serverScenario(page));
  expect(written.map((l) => l.name)).toEqual([ARIA.name, DIETRICH.name]);
  for (const width of [1100, 1440]) {
    for (const look of LOOKS) {
      await test.step(`${width} in the ${look} look`, async () => {
        const root = await openReady(page, sizeAt(width), look);
        const leaders = root.getByTestId('leaders');
        const cards = leaders.getByRole('article');
        await expect(cards).toHaveCount(2);
        // No switch from the desktop width: both cards show.
        await expect(leaders.getByRole('tab')).toHaveCount(0);
        const ink = await tokenColour(page, '--text-1');

        const nameStarts: number[] = [];
        for (const [i, who] of PAIR.entries()) {
          const card = leaders.getByRole('article', { name: who.name });
          const name = card.getByRole('heading', { level: 2 });
          await expect(name).toHaveText(who.name);
          await expect(card.getByTestId('leader-title')).toHaveText(who.title);

          // The place figure: plain figures in JetBrains Mono at 15 px in the ink, no box, right-aligned in a column three figures wide.
          const place = card.getByTestId('leader-place');
          await expect(place).toHaveText(who.place);
          const mark = await place.evaluate((el) => {
            const cs = getComputedStyle(el);
            return {
              size: parseFloat(cs.fontSize),
              face: cs.fontFamily,
              colour: cs.color,
              align: cs.textAlign,
              width: el.getBoundingClientRect().width,
              edges: ['top', 'right', 'bottom', 'left'].map((side) => parseFloat(cs.getPropertyValue(`border-${side}-width`))),
              ground: cs.backgroundColor,
            };
          });
          expect(mark.size).toBe(15);
          expect(mark.face).toContain('JetBrains Mono');
          expect(mark.colour).toBe(ink);
          expect(mark.align).toBe('right');
          expect(mark.width).toBeGreaterThanOrEqual(24);
          expect(mark.width).toBeLessThanOrEqual(32);
          expect(mark.edges).toEqual([0, 0, 0, 0]);
          expect(mark.ground).toBe('rgba(0, 0, 0, 0)');
          // The figure is read as "Leader 1": the figure itself is hidden from a screen reader, and the words stand beside it.
          await expect(place).toHaveAttribute('aria-hidden', 'true');
          await expect(card.getByText(`Leader ${who.place}`, { exact: true })).toHaveCount(1);
          nameStarts.push((await box(name)).x - (await box(card)).x);

          // The orders whole, byte for byte, and the note under them; no temperament line yet.
          const orders = card.getByTestId('leader-orders');
          expect(await orders.evaluate((el) => el.textContent)).toBe(written[i].instructions);
          expect(await orders.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1), 'the orders are not cut').toBe(true);
          await expect(card.getByTestId('hexaco-note')).toHaveText(HEXACO_NOTE);
          expect((await box(card.getByTestId('hexaco-note'))).y).toBeGreaterThanOrEqual((await box(orders)).y + (await box(orders)).height - 1);
          await expect(card.getByTestId('leader-temperament')).toHaveCount(0);

          // Six scores, each its whole name, a bar and a figure to two places.
          const rows = card.getByTestId('score-rows').getByRole('listitem');
          await expect(rows).toHaveCount(6);
          for (const [t, trait] of TRAITS.entries()) {
            expect(await shownText(rows.nth(t).getByTestId('score-name'))).toBe(trait);
            await expect(rows.nth(t).getByTestId('score-figure')).toHaveText(who.scores[t]);
            const bar = await barOf(rows.nth(t));
            expect(Math.abs(bar.fill - Number(who.scores[t]))).toBeLessThanOrEqual(0.03);
          }

          // Feature 5, QA step 25: the sizes.
          expect((await styleOf(orders)).size).toBe(18);
          expect((await styleOf(name)).size).toBe(20);
          expect((await styleOf(card.getByTestId('leader-title'))).size).toBe(15);
          expect((await styleOf(rows.nth(0).getByTestId('score-name'))).size).toBe(15);
          expect((await styleOf(rows.nth(0).getByTestId('score-figure'))).size).toBe(15);
        }
        // Every name starts at the same line.
        expect(Math.abs(nameStarts[0] - nameStarts[1])).toBeLessThanOrEqual(1);

        // Side by side in two equal columns of one height, each score at the same height on both.
        const [a, b] = await Promise.all([box(cards.nth(0)), box(cards.nth(1))]);
        expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
        expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
        expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
        for (let t = 0; t < TRAITS.length; t += 1) {
          const [ra, rb] = await Promise.all([0, 1].map((c) => box(cards.nth(c).getByTestId('score-rows').getByRole('listitem').nth(t))));
          expect(Math.abs(ra.y - rb.y), `${TRAITS[t]} reads across both cards`).toBeLessThanOrEqual(1);
        }

        // At the wide width each card stands in two columns, the orders beside the scores; at the desktop width the orders stand under them.
        const scores = await box(cards.nth(0).getByTestId('score-rows'));
        const orders = await box(cards.nth(0).getByTestId('leader-orders'));
        if (width >= 1440) expect(orders.x).toBeGreaterThanOrEqual(scores.x + scores.width - 1);
        else expect(orders.y).toBeGreaterThanOrEqual(scores.y + scores.height - 1);

        // No picture of a leader, and no colony field on a card.
        await expect(leaders.locator('img, canvas, svg[role="img"]')).toHaveCount(0);
        await expectNoSidewaysScroll(page, root);
        await leaders.scrollIntoViewIfNeeded();
        await picture(page, `leaders-pair-${width}-${look}`);
      });
    }
  }
});

screenTest('feature 5: the middle band', async ({ page }) => {
  test.setTimeout(150_000);
  for (const look of LOOKS) {
    await test.step(`1440 in the ${look} look`, async () => {
      const root = await openReady(page, WIDE, look);
      const leaders = root.getByTestId('leaders');
      const amber = await tokenColour(page, '--amber');
      const edge = await tokenColour(page, '--edge-control');
      // One quiet line over each block of six score rows.
      await expect(leaders.getByTestId('middle-band')).toHaveText([MIDDLE_BAND, MIDDLE_BAND]);
      for (const who of PAIR) {
        const rows = leaders.getByRole('article', { name: who.name }).getByTestId('score-rows').getByRole('listitem');
        for (const [t, figure] of who.scores.entries()) {
          const score = Number(figure);
          const bar = await barOf(rows.nth(t));
          // Outside 0.35 to 0.65 the bar fills in the accent; inside the band or on its edge, in the control edge.
          expect(bar.colour, `${who.name}, ${TRAITS[t]} ${figure}`).toBe(score < 0.35 || score > 0.65 ? amber : edge);
          // The two ticks mark the band's edges.
          expect(bar.ticks).toHaveLength(2);
          expect(Math.abs(bar.ticks[0] - 0.35)).toBeLessThanOrEqual(0.02);
          expect(Math.abs(bar.ticks[1] - 0.65)).toBeLessThanOrEqual(0.02);
        }
      }
      // Aria Chen's Openness (0.95) and Conscientiousness (0.35), named.
      const aria = leaders.getByRole('article', { name: ARIA.name }).getByTestId('score-rows').getByRole('listitem');
      expect((await barOf(aria.nth(0))).colour).toBe(amber);
      expect((await barOf(aria.nth(1))).colour).toBe(edge);
    });

    await test.step(`390 in the ${look} look`, async () => {
      const root = await openReady(page, PHONE, look);
      const leaders = root.getByTestId('leaders');
      const amber = await tokenColour(page, '--amber');
      const edge = await tokenColour(page, '--edge-control');
      // One table of both leaders' scores, so one line over it.
      await expect(leaders.getByTestId('middle-band')).toHaveText([MIDDLE_BAND]);
      const table = leaders.getByRole('table');
      for (const [t, trait] of TRAITS.entries()) {
        const cells = scoreRow(table, t).getByRole('cell');
        for (const [c, who] of PAIR.entries()) {
          const score = Number(who.scores[t]);
          const bar = await barOf(cells.nth(c));
          expect(bar.colour, `${who.name}, ${trait} ${who.scores[t]}`).toBe(score < 0.35 || score > 0.65 ? amber : edge);
          expect(Math.abs(bar.track - 48)).toBeLessThanOrEqual(1);
        }
      }
    });
  }
});

screenTest('feature 5: one card at a time on a phone', async ({ page }) => {
  test.setTimeout(240_000);
  const written = writtenOf(await serverScenario(page));
  for (const width of [320, 390, 600]) {
    for (const look of LOOKS) {
      await test.step(`${width} in the ${look} look`, async () => {
        const root = await openReady(page, sizeAt(width), look);
        const leaders = root.getByTestId('leaders');

        // The switch: two keys in one row, each half the column and 48 px high or more.
        const tabs = leaders.getByRole('tablist').getByRole('tab');
        await expect(tabs).toHaveText(['1 Aria Chen', '2 Dietrich Voss']);
        const showAria = leaders.getByRole('tab', { name: SHOW_ARIA, exact: true });
        const showDietrich = leaders.getByRole('tab', { name: SHOW_DIETRICH, exact: true });
        await expect(showAria).toHaveAttribute('aria-selected', 'true');
        await expect(showDietrich).toHaveAttribute('aria-selected', 'false');
        const [k1, k2] = await Promise.all([box(tabs.nth(0)), box(tabs.nth(1))]);
        expect(Math.abs(k1.y - k2.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(k1.width - k2.width)).toBeLessThanOrEqual(1);
        expect(k1.height).toBeGreaterThanOrEqual(48);
        expect(Math.abs(k1.height - k2.height)).toBeLessThanOrEqual(1);
        const column = await box(leaders);
        expect(k1.width + k2.width).toBeGreaterThanOrEqual(column.width - 16);
        // The shown leader's key: the 600 weight over the accent underline.
        expect((await styleOf(tabs.nth(0))).weight).toBe('600');
        expect(await tabs.nth(0).evaluate((el) => getComputedStyle(el).borderBottomColor)).toBe(await tokenColour(page, '--amber'));
        expect(await tabs.nth(0).evaluate((el) => parseFloat(getComputedStyle(el).borderBottomWidth))).toBe(3);

        // One card, which does not repeat the leader's place and name: the switch key carries them.
        const card = leaders.getByRole('tabpanel');
        await expect(card).toHaveCount(1);
        await expect(leaders.getByRole('article')).toHaveCount(0);
        await expect(card.getByRole('heading', { level: 2 })).toHaveCount(0);
        await expect(card.getByTestId('leader-place')).toHaveCount(0);
        await expect(card.getByTestId('leader-head')).toHaveText(ARIA.title);
        expect(await card.getByTestId('leader-orders').evaluate((el) => el.textContent)).toBe(written[0].instructions);
        await expect(card.getByTestId('hexaco-note')).toHaveText(HEXACO_NOTE);
        expect((await styleOf(card.getByTestId('leader-orders'))).size).toBe(18);

        // One table of the six scores, a column a leader, so the pair compares with no press.
        const table = card.getByRole('table');
        await expect(table.getByRole('columnheader')).toHaveText(['1 Aria Chen', '2 Dietrich Voss']);
        for (const [t, trait] of TRAITS.entries()) {
          const row = scoreRow(table, t);
          expect(await shownText(row.getByRole('rowheader'))).toBe(trait);
          await expect(row.getByRole('cell')).toHaveText([ARIA.scores[t], DIETRICH.scores[t]]);
        }
        await expectNoSidewaysScroll(page, root);
        await tabs.nth(0).scrollIntoViewIfNeeded();
        await picture(page, `leaders-phone-${width}-${look}-leader-1`);

        // Pressing the second key shows the second leader's card.
        await showDietrich.click();
        await expect(showDietrich).toHaveAttribute('aria-selected', 'true');
        await expect(showAria).toHaveAttribute('aria-selected', 'false');
        await expect(card).toHaveCount(1);
        await expect(card.getByTestId('leader-head')).toHaveText(DIETRICH.title);
        expect(await card.getByTestId('leader-orders').evaluate((el) => el.textContent)).toBe(written[1].instructions);
        // The table is the same whichever card shows.
        await expect(card.getByRole('table').getByRole('columnheader')).toHaveText(['1 Aria Chen', '2 Dietrich Voss']);
        await expect(scoreRow(card.getByRole('table'), 0).getByRole('cell')).toHaveText(['0.95', '0.25']);
        await showDietrich.scrollIntoViewIfNeeded();
        await picture(page, `leaders-phone-${width}-${look}-leader-2`);

        // The arrow keys move between the two keys.
        await showDietrich.press('ArrowLeft');
        await expect(showAria).toBeFocused();
        await expect(showAria).toHaveAttribute('aria-selected', 'true');
        await expect(card.getByTestId('leader-head')).toHaveText(ARIA.title);

        // A press changes the card and leaves the page where it was: nothing
        // scrolls and the switch stays put. The press is made in the page, so
        // the only movement read is the page's own.
        const before = await placeOf(showDietrich);
        await showDietrich.evaluate((el) => (el as HTMLElement).click());
        await expect(showDietrich).toHaveAttribute('aria-selected', 'true');
        await expect(card.getByTestId('leader-head')).toHaveText(DIETRICH.title);
        const after = await placeOf(showDietrich);
        expect(after.scrolls).toBe(before.scrolls);
        expect(Math.abs(after.viewTop - before.viewTop)).toBeLessThanOrEqual(1);
      });
    }
  }
});

screenTest('feature 5: no written leaders', async ({ page }) => {
  test.setTimeout(150_000);
  // A scenario a visitor compiled has no written leaders and names no key people.
  await routeScenario(page, (scenario) => {
    scenario.id = 'harbour-trial';
    scenario.labels = { ...scenario.labels, name: 'Harbour Trial' };
    scenario.presets = [];
  });
  for (const look of LOOKS) {
    await test.step(`1440 in the ${look} look`, async () => {
      const root = await openReady(page, WIDE, look, 'Harbour Trial');
      const leaders = root.getByTestId('leaders');
      await expect(leaders.getByRole('article')).toHaveCount(2);
      for (const name of ['Leader 1', 'Leader 2']) {
        const card = leaders.getByRole('article', { name, exact: true });
        await expect(card.getByRole('heading', { level: 2 })).toHaveText(name);
        await expect(card.locator('[data-score-track]')).toHaveCount(6);
        await expect(card.locator('[data-meter-fill]')).toHaveCount(0);
        await expect(card.getByTestId('score-figure')).toHaveCount(0);
        await expect(card.getByTestId('no-written-leaders')).toHaveText(NO_WRITTEN_LEADERS);
        await expect(card.getByTestId('leader-orders')).toHaveCount(0);
        await expect(card.getByRole('button')).toHaveCount(0);
      }
      await leaders.scrollIntoViewIfNeeded();
      await picture(page, `leaders-none-written-1440-${look}`);
    });

    await test.step(`390 in the ${look} look`, async () => {
      const root = await openReady(page, PHONE, look, 'Harbour Trial');
      const leaders = root.getByTestId('leaders');
      await expect(leaders.getByRole('tab', { name: 'Show Leader 1' })).toHaveAttribute('aria-selected', 'true');
      await expect(leaders.getByRole('tab', { name: 'Show Leader 2' })).toHaveAttribute('aria-selected', 'false');
      const card = leaders.getByRole('tabpanel');
      await expect(card).toHaveCount(1);
      // Six empty tracks a leader, in the one table.
      await expect(card.locator('[data-score-track]')).toHaveCount(12);
      await expect(card.locator('[data-meter-fill]')).toHaveCount(0);
      await expect(card.getByTestId('no-written-leaders')).toHaveText(NO_WRITTEN_LEADERS);
      await expect(card.getByTestId('leader-orders')).toHaveCount(0);
      await leaders.scrollIntoViewIfNeeded();
      await picture(page, `leaders-none-written-390-${look}`);
    });
  }
});

screenTest('feature 5: loading shapes', async ({ page }) => {
  test.setTimeout(150_000);
  await watchShift(page);
  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        const release = await holdScenario(page);
        const root = await openRun(page, size, look);
        const leaders = root.getByTestId('leaders');
        // Card shapes of the final size: two side by side from the desktop width, one under the switch's shape below it.
        const shapes = leaders.locator('[data-leader-shape]');
        await expect(shapes).toHaveCount(size.width >= 1100 ? 2 : 1);
        await expect(shapes.first()).toBeVisible();
        expect(await shapes.first().locator('[data-score-track]').count()).toBeGreaterThanOrEqual(6);
        expect(await shapes.first().locator('[data-shape]').count()).toBeGreaterThanOrEqual(3);
        await expect(leaders.getByRole('article')).toHaveCount(0);
        await expect(leaders.getByRole('tab')).toHaveCount(0);
        await leaders.scrollIntoViewIfNeeded();
        await picture(page, `leaders-loading-${size.width}-${look}`);
        const before = { height: (await box(leaders)).height, place: await placeOf(leaders) };

        release();
        await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis' })).toBeVisible();
        await expect(shapes).toHaveCount(0);
        if (size.width >= 1100) await expect(leaders.getByRole('article')).toHaveCount(2);
        else await expect(leaders.getByRole('tabpanel')).toHaveCount(1);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const after = { height: (await box(leaders)).height, place: await placeOf(leaders) };
        // The cards replace the shapes with no jump: under a tenth of the window, and a shift score under 0.1.
        expect(Math.abs(after.height - before.height)).toBeLessThan(size.height * 0.1);
        expect(Math.abs(after.place.top - before.place.top)).toBeLessThan(size.height * 0.1);
        expect(await shiftOf(page)).toBeLessThan(0.1);
        await page.unroute('**/scenario');
      });
    }
  }
});

/** The shared colony panel's canvas pixels as one string: two frames are the same frame when their strings are equal. */
const frameOf = (canvas: Locator): Promise<string> => canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());

/**
 * How many solid squares of one colour the canvas holds, each 12 pixels or
 * more: the Game of Life cells. Rings and lines are thinner than that.
 */
function countTiles(el: Element): number {
  const canvas = el as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return 0;
  const { width, height } = canvas;
  const px = ctx.getImageData(0, 0, width, height).data;
  const B = 12;
  let found = 0;
  for (let y = 0; y + B <= height; y += B) {
    for (let x = 0; x + B <= width; x += B) {
      const i0 = (y * width + x) * 4;
      if (px[i0 + 3] === 0) continue;
      let same = true;
      for (let dy = 0; dy < B && same; dy += 3) {
        for (let dx = 0; dx < B; dx += 3) {
          const i = ((y + dy) * width + x + dx) * 4;
          if (px[i] !== px[i0] || px[i + 1] !== px[i0 + 1] || px[i + 2] !== px[i0 + 2] || px[i + 3] !== px[i0 + 3]) { same = false; break; }
        }
      }
      if (same) found += 1;
    }
  }
  return found;
}

/** Opens /sim, waits for the scenario line and for the shared colony panel's canvas to hold its cells. */
async function openColony(page: Page, size: { width: number; height: number }, look: Look, name = 'Mars Genesis'): Promise<{ root: Locator; colony: Locator; canvas: Locator }> {
  const root = await openReady(page, size, look, name);
  const colony = root.getByTestId('shared-colony');
  const canvas = colony.locator('canvas');
  await expect(canvas).toHaveCount(1);
  await expect.poll(() => canvas.evaluate(countTiles), { message: 'the panel draws its Game of Life cells' }).toBeGreaterThan(0);
  return { root, colony, canvas };
}

/** The panel's field: the grid's own canvas area, or the frame that stands for it while no grid is drawn. */
const fieldOf = (colony: Locator): Locator => colony.locator('[data-testid="living-colony-field-rest"], [data-testid="colony-field"]');

/** The people set over the field as text, each with its box. */
async function nameBoxes(colony: Locator): Promise<Array<{ name: string; left: number; top: number; right: number; bottom: number; size: number; colour: string; opacity: number }>> {
  return colony.locator('[data-person][data-featured="true"]').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { name: (el.textContent ?? '').trim(), left: r.left, top: r.top, right: r.right, bottom: r.bottom, size: parseFloat(cs.fontSize), colour: cs.color, opacity: Number(cs.opacity) };
  }));
}

screenTest('feature 14: one colony field, the key people, no ticks', async ({ page }) => {
  test.setTimeout(300_000);
  const people = keyPeopleOf(await serverScenario(page));
  expect(people).toHaveLength(5);
  expect(new Set(people.map((p) => p.department)).size).toBe(4);

  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        // The pointer rests away from the panel, so no person is hovered.
        await page.mouse.move(0, 0);
        const { root, colony, canvas } = await openColony(page, size, look);
        // Exactly one colony field on the screen, inside the panel; no card carries one.
        await expect(root.locator('canvas')).toHaveCount(1);
        await expect(root.getByTestId('leaders').locator('canvas')).toHaveCount(0);

        // The header, in the live grid's own type, the caption and the key line.
        const turn = colony.getByTestId('colony-turn');
        await expect(turn).toHaveText('TURN 0');
        const turnStyle = await styleOf(turn);
        expect(turnStyle.face).toContain('JetBrains Mono');
        expect(turnStyle.size).toBe(15);
        await expect(colony.getByTestId('colony-figures')).toHaveText(COLONY_FIGURES);
        await expect(colony.getByTestId('colony-caption')).toHaveText(COLONY_CAPTION);
        await expect(colony.getByTestId('colony-key').getByRole('listitem')).toHaveText(COLONY_KEY);
        await expect(colony.getByRole('img', { name: COLONY_SPOKEN })).toHaveCount(1);

        // Each featured person's name is text at 15 px or more in the ink, inside the field, and no two overlap.
        const ink = await tokenColour(page, '--text-1');
        await expect(fieldOf(colony)).toHaveCount(1);
        const field = await box(fieldOf(colony));
        const names = await nameBoxes(colony);
        expect(names.map((n) => n.name)).toEqual(people.filter((p) => p.featured).map((p) => p.name));
        for (const n of names) {
          expect(n.size, `${n.name} is set at 15 px or more`).toBeGreaterThanOrEqual(15);
          expect(n.colour, `${n.name} is set in the ink`).toBe(ink);
          expect(n.opacity).toBe(1);
          expect(n.right - n.left).toBeGreaterThan(20);
          expect(n.left).toBeGreaterThanOrEqual(field.x - 1);
          expect(n.right).toBeLessThanOrEqual(field.x + field.width + 1);
          expect(n.top).toBeGreaterThanOrEqual(field.y - 1);
          expect(n.bottom).toBeLessThanOrEqual(field.y + field.height + 1);
        }
        for (let i = 0; i < names.length; i += 1) {
          for (let j = i + 1; j < names.length; j += 1) {
            const a = names[i];
            const b = names[j];
            const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
            expect(apart, `${a.name} and ${b.name} do not overlap`).toBe(true);
          }
        }

        // The cells draw in the grid's first colour, the accent amber, and the panel rests: two frames two seconds apart are the same frame.
        const vis = await tokenColour(page, '--vis');
        const tile = await canvas.evaluate((el) => {
          const c = el as HTMLCanvasElement;
          const ctx = c.getContext('2d');
          if (!ctx) return '';
          const px = ctx.getImageData(0, 0, c.width, c.height).data;
          const counts = new Map<string, number>();
          for (let i = 0; i < px.length; i += 4 * 7) {
            if (px[i + 3] === 0) continue;
            const key = `rgb(${px[i]}, ${px[i + 1]}, ${px[i + 2]})`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
          return [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
        });
        expect(tile, 'the cells draw in the accent amber').toBe(vis);
        const first = await frameOf(canvas);
        await colony.scrollIntoViewIfNeeded();
        await picture(page, `colony-${size.width}-${look}-f1`);
        await page.waitForTimeout(2_000);
        expect(await frameOf(canvas), 'two frames two seconds apart are the same frame').toBe(first);
        await picture(page, `colony-${size.width}-${look}-f2`);

        // The panel stands above the leaders, the column's width.
        const [panel, leaders, column] = await Promise.all([box(colony), box(root.getByTestId('leaders')), box(root)]);
        expect(panel.y + panel.height).toBeLessThanOrEqual(leaders.y + 1);
        expect(Math.abs(field.width - column.width)).toBeLessThanOrEqual(1);

        if (size.width < 1100) {
          // Feature 14, QA step 4: switching the leader leaves the panel as it was.
          await root.getByTestId('leaders').getByRole('tab', { name: SHOW_DIETRICH, exact: true }).click();
          await expect(root.getByTestId('leaders').getByTestId('leader-head')).toHaveText(DIETRICH.title);
          expect(await frameOf(canvas)).toBe(first);
          const still = await box(fieldOf(colony));
          expect(Math.abs(still.height - field.height)).toBeLessThanOrEqual(1);
          expect(Math.abs(still.width - field.width)).toBeLessThanOrEqual(1);
        }

        // A person is one press: the name opens the grid's own popover, and Escape closes it.
        const person = colony.locator('[data-person]').first();
        await person.click();
        const popover = colony.getByRole('dialog', { name: `${people[0].name} drilldown` });
        await expect(popover).toBeVisible();
        await expect(popover).toContainText(people[0].department);
        await page.keyboard.press('Escape');
        await expect(popover).toHaveCount(0);

        // The panel is one stop: the arrow keys move between the people.
        await expect(colony.locator('[data-person][tabindex="0"]')).toHaveCount(1);
        await person.focus();
        await page.keyboard.press('ArrowRight');
        await expect(colony.locator('[data-person]').nth(1)).toBeFocused();
        await expect(colony.locator('[data-person][tabindex="0"]')).toHaveCount(1);
        await page.keyboard.press('ArrowLeft');
        await expect(person).toBeFocused();
      });
    }
  }

  // Feature 14, QA step 13 at a pair: the field's height at each width, with no sideways scroll.
  await page.mouse.move(0, 0);
  for (const [width, height] of FIELD_HEIGHTS) {
    await test.step(`the field at ${width}`, async () => {
      const { root, colony } = await openColony(page, sizeAt(width), 'dark');
      const field = await box(fieldOf(colony));
      expect(Math.abs(field.height - height)).toBeLessThanOrEqual(1);
      expect(Math.abs(field.width - (await box(root)).width)).toBeLessThanOrEqual(1);
      await expectNoSidewaysScroll(page, root);
      await expect(root.locator('canvas')).toHaveCount(1);
    });
  }

  // A person who is not featured shows no name at rest; the name shows on focus.
  await test.step('a person who is not featured, 1440 in the dark look', async () => {
    await page.mouse.move(0, 0);
    await routeScenario(page, (scenario) => {
      const preset = scenario.presets.find((p) => p.id === 'default') ?? scenario.presets[0];
      if (preset?.personnel?.[1]) preset.personnel[1].featured = false;
    });
    const { colony } = await openColony(page, WIDE, 'dark');
    await expect(colony.locator('[data-person][data-featured="true"]')).toHaveCount(4);
    const quiet = colony.locator('[data-person][data-featured="false"]');
    await expect(quiet).toHaveCount(1);
    await expect(quiet).toHaveText(people[1].name);
    expect(await quiet.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
    await colony.locator('[data-person]').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(quiet).toBeFocused();
    await expect.poll(() => quiet.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect((await styleOf(quiet)).size).toBeGreaterThanOrEqual(15);
    await page.unroute('**/scenario');
  });
});

screenTest('feature 14: under reduced motion', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // From the page's start: every frame of the panel's canvas and of the cover that would fade it in.
  await page.addInitScript(() => {
    const out: { frames: Array<{ url: string; cover: number; w: number; h: number }>; done: boolean } = { frames: [], done: false };
    (window as unknown as { colonyFrames: typeof out }).colonyFrames = out;
    let began = 0;
    const loop = () => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="shared-colony"] canvas');
      const now = performance.now();
      if (canvas) {
        if (!began) began = now;
        const cover = canvas.parentElement?.querySelector('[class*="revealCover"]');
        out.frames.push({ url: canvas.toDataURL(), cover: cover ? Number(getComputedStyle(cover).opacity) : 0, w: canvas.width, h: canvas.height });
        if (now - began > 1500) { out.done = true; return; }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  for (const look of LOOKS) {
    await test.step(`1440 in the ${look} look`, async () => {
      const { colony, canvas } = await openColony(page, WIDE, look);
      await page.waitForFunction(() => (window as unknown as { colonyFrames: { done: boolean } }).colonyFrames.done, undefined, { timeout: 20_000 });
      const frames = await page.evaluate(() => (window as unknown as { colonyFrames: { frames: Array<{ url: string; cover: number; w: number; h: number }> } }).colonyFrames.frames);
      expect(frames.length).toBeGreaterThan(5);
      const settled = await frameOf(canvas);
      const last = frames[frames.length - 1];
      expect(last.url).toBe(settled);
      // No fade: the cover is never part way, and it ends clear.
      expect(frames.map((f) => f.cover).filter((cover) => cover > 0 && cover < 1), 'no frame shows the panel part way through a fade').toEqual([]);
      expect(last.cover).toBe(0);
      // The settled frame draws at once: at the canvas's final size it is either not drawn yet or the settled frame, never a frame between.
      const sized = frames.filter((f) => f.w === last.w && f.h === last.h);
      expect(new Set(sized.map((f) => f.url)).size).toBeLessThanOrEqual(2);
      const firstSettled = sized.findIndex((f) => f.url === settled);
      expect(firstSettled).toBeGreaterThanOrEqual(0);
      expect(sized.slice(firstSettled).every((f) => f.url === settled)).toBe(true);
      // Nothing ticks afterwards.
      await page.waitForTimeout(1_000);
      expect(await frameOf(canvas)).toBe(settled);
      await colony.scrollIntoViewIfNeeded();
      await picture(page, `colony-reduced-motion-1440-${look}`);
    });
  }
});

screenTest('feature 14: the light canvas ground', async ({ page }) => {
  test.setTimeout(120_000);
  for (const size of [PHONE, WIDE]) {
    await test.step(`${size.width} in the light look`, async () => {
      const { colony, canvas } = await openColony(page, size, 'light');
      const read = await canvas.evaluate((el) => {
        const canvasEl = el as HTMLCanvasElement;
        type RGB = [number, number, number];
        type RGBA = [number, number, number, number];
        const probe = document.createElement('canvas');
        probe.width = 1;
        probe.height = 1;
        const pctx = probe.getContext('2d', { willReadFrequently: true });
        /** Any computed colour as red, green, blue and alpha. */
        const parse = (css: string): RGBA => {
          const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(css.trim());
          if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
          const s = /^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(css.trim());
          if (s) return [Number(s[1]) * 255, Number(s[2]) * 255, Number(s[3]) * 255, s[4] === undefined ? 1 : Number(s[4])];
          if (!pctx) return [0, 0, 0, 0];
          pctx.clearRect(0, 0, 1, 1);
          pctx.fillStyle = css;
          pctx.fillRect(0, 0, 1, 1);
          const d = pctx.getImageData(0, 0, 1, 1).data;
          return [d[0], d[1], d[2], d[3] / 255];
        };
        const over = (top: RGBA, under: RGB): RGB => [
          top[0] * top[3] + under[0] * (1 - top[3]),
          top[1] * top[3] + under[1] * (1 - top[3]),
          top[2] * top[3] + under[2] * (1 - top[3]),
        ];
        const lin = (c: number): number => {
          const v = c / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        const lum = (c: RGB): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
        const ratio = (a: RGB, b: RGB): number => {
          const x = lum(a);
          const y = lum(b);
          return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
        };
        const token = (name: string): RGBA => {
          const span = document.createElement('span');
          span.style.color = `var(${name})`;
          document.body.appendChild(span);
          const colour = parse(getComputedStyle(span).color);
          span.remove();
          return colour;
        };

        // The canvas ground: the nearest opaque ground behind the canvas, with every wash between laid over it.
        const layers: RGBA[] = [];
        let ground: RGB = [255, 255, 255];
        for (let node: Element | null = canvasEl.parentElement; node; node = node.parentElement) {
          const bg = parse(getComputedStyle(node).backgroundColor);
          if (bg[3] >= 0.999) { ground = [bg[0], bg[1], bg[2]]; break; }
          if (bg[3] > 0) layers.push(bg);
        }
        for (let i = layers.length - 1; i >= 0; i -= 1) ground = over(layers[i], ground);

        const ctx = canvasEl.getContext('2d');
        if (!ctx) throw new Error('the canvas has no context');
        const { width, height } = canvasEl;
        const px = ctx.getImageData(0, 0, width, height).data;
        const at = (x: number, y: number): RGBA => {
          const i = (Math.round(y) * width + Math.round(x)) * 4;
          return [px[i], px[i + 1], px[i + 2], px[i + 3] / 255];
        };

        // A Game of Life cell, at a known point: the middle of the first solid square found.
        let tile: RGBA | null = null;
        const B = 12;
        for (let y = 0; y + B <= height && !tile; y += B) {
          for (let x = 0; x + B <= width && !tile; x += B) {
            const first = at(x, y);
            if (first[3] === 0) continue;
            let same = true;
            for (let dy = 0; dy < B && same; dy += 3) {
              for (let dx = 0; dx < B; dx += 3) {
                const p = at(x + dx, y + dy);
                if (p[0] !== first[0] || p[1] !== first[1] || p[2] !== first[2] || p[3] !== first[3]) { same = false; break; }
              }
            }
            if (same) tile = at(x + B / 2, y + B / 2);
          }
        }

        // A person's ring, at a known point: the strongest pixel on the ring of the first person the panel names.
        const person = document.querySelector<HTMLElement>('[data-testid="shared-colony"] [data-person][data-featured="true"]');
        const scale = width / canvasEl.getBoundingClientRect().width;
        let ring: RGBA | null = null;
        if (person) {
          const cx = Number(person.dataset.ringX) * scale;
          const cy = Number(person.dataset.ringY) * scale;
          for (let a = 0; a < 360; a += 2) {
            for (let r = 3.5 * scale; r <= 6.5 * scale; r += 0.5) {
              const x = cx + Math.cos((a * Math.PI) / 180) * r;
              const y = cy + Math.sin((a * Math.PI) / 180) * r;
              if (x < 0 || y < 0 || x >= width || y >= height) continue;
              const p = at(x, y);
              if (!ring || p[3] > ring[3]) ring = p;
            }
          }
        }

        const wrap = canvasEl.parentElement;
        const fieldEdge = wrap ? parse(getComputedStyle(wrap).borderTopColor) : ([0, 0, 0, 0] as RGBA);
        return {
          ground: ground.map((c) => Math.round(c)),
          tile: tile ? ratio(over(tile, ground), ground) : 0,
          ring: ring ? ratio(over(ring, ground), ground) : 0,
          amber: ratio(over(token('--vis'), ground), ground),
          teal: ratio(over(token('--eng'), ground), ground),
          edge: ratio(over(token('--edge-control'), ground), ground),
          fieldEdge: ratio(over(fieldEdge, ground), ground),
        };
      });
      const said = JSON.stringify(read);
      // On the light canvas ground: the cells and rings, place 2's teal and the band edge each read 4.5 to 1 or more.
      expect(read.tile, said).toBeGreaterThanOrEqual(4.5);
      expect(read.ring, said).toBeGreaterThanOrEqual(4.5);
      expect(read.amber, said).toBeGreaterThanOrEqual(4.5);
      expect(read.teal, said).toBeGreaterThanOrEqual(4.5);
      expect(read.edge, said).toBeGreaterThanOrEqual(4.5);
      expect(read.fieldEdge, said).toBeGreaterThanOrEqual(4.5);
      // The field is flat, edged in the control edge.
      const wrap = canvas.locator('xpath=..');
      expect(await wrap.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await tokenColour(page, '--edge-control'));
      expect(await wrap.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
      await colony.scrollIntoViewIfNeeded();
      await picture(page, `colony-light-ground-${size.width}`);
    });
  }
});

screenTest('feature 14: waits for the scenario', async ({ page }) => {
  test.setTimeout(120_000);
  const mars = keyPeopleOf(await serverScenario(page)).map((p) => p.name);
  expect(mars).toHaveLength(5);
  await switchScenario(page, 'lunar-outpost');
  const lunar = keyPeopleOf(await serverScenario(page));
  expect(lunar.map((p) => p.name)).not.toEqual(mars);
  await page.addInitScript((names) => {
    const w = window as unknown as { marsPeoplePainted: boolean; colonyEmptyPainted: boolean };
    w.marsPeoplePainted = false;
    w.colonyEmptyPainted = false;
    new MutationObserver(() => {
      const text = document.querySelector('[data-testid="shared-colony"]')?.textContent ?? '';
      if (names.some((name) => text.includes(name))) w.marsPeoplePainted = true;
      if (text.includes('names no key people')) w.colonyEmptyPainted = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, mars);
  for (const look of LOOKS) {
    await test.step(`390 in the ${look} look`, async () => {
      const release = await holdScenario(page);
      const root = await openRun(page, PHONE, look);
      const colony = root.getByTestId('shared-colony');
      // While the scenario loads: the panel's frame at its final size, with no canvas, no name and no empty-state sentence.
      const field = colony.getByTestId('colony-field');
      await expect(field).toBeVisible();
      expect(Math.abs((await box(field)).height - 190)).toBeLessThanOrEqual(1);
      await expect(root.locator('canvas')).toHaveCount(0);
      await expect(colony.locator('[data-person]')).toHaveCount(0);
      await expect(colony).not.toContainText('names no key people');
      for (const name of mars) await expect(colony).not.toContainText(name);
      const before = await box(colony);

      release();
      await expect(root.getByRole('heading', { level: 1, name: 'Lunar Outpost' })).toBeVisible();
      await expect(colony.locator('[data-person]')).toHaveText(lunar.map((p) => p.name));
      await expect(colony.getByTestId('colony-figures')).toHaveText(`${lunar.length} key people · ${new Set(lunar.map((p) => p.department)).size} departments`);
      await expect(root.locator('canvas')).toHaveCount(1);
      const after = await box(colony);
      expect(Math.abs(after.height - before.height)).toBeLessThan(PHONE.height * 0.1);
      const painted = await page.evaluate(() => {
        const w = window as unknown as { marsPeoplePainted: boolean; colonyEmptyPainted: boolean };
        return { mars: w.marsPeoplePainted, empty: w.colonyEmptyPainted };
      });
      expect(painted).toEqual({ mars: false, empty: false });
      await page.unroute('**/scenario');
    });
  }
});

screenTest('feature 14: a scenario with no key people', async ({ page }) => {
  test.setTimeout(120_000);
  await routeScenario(page, (scenario) => {
    for (const preset of scenario.presets) delete preset.personnel;
  });
  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        const root = await openReady(page, size, look);
        const colony = root.getByTestId('shared-colony');
        // Still the screen's one colony field: the frame, the header and the key line, with the sentence and no canvas.
        await expect(colony).toHaveCount(1);
        const field = colony.getByTestId('colony-field');
        await expect(field).toBeVisible();
        expect(Math.abs((await box(field)).height - (size.width < 600 ? 190 : 280))).toBeLessThanOrEqual(1);
        await expect(colony.getByTestId('colony-turn')).toHaveText('TURN 0');
        await expect(colony.getByTestId('colony-key').getByRole('listitem')).toHaveText(COLONY_KEY);
        await expect(colony.getByTestId('colony-empty')).toHaveText(NO_KEY_PEOPLE);
        await expect(root.locator('canvas')).toHaveCount(0);
        await expect(colony.locator('[data-person]')).toHaveCount(0);
        // The two written leaders still show under it.
        await expect(root.getByTestId('leaders')).toContainText(ARIA.title);
        expect(await measureReadability(page)).toEqual([]);
        await colony.scrollIntoViewIfNeeded();
        await picture(page, `colony-no-key-people-${size.width}-${look}`);
      });
    }
  }
});

/* The run's size (feature 4), the screen at 24 and 300 leaders, and Start (feature 10). */

/** A server of this suite that is not the hosted demo: it runs on its own keys and has no free runs to count. */
const SELF_HOSTED = 'http://127.0.0.1:3456';
const FREE_SIZE_LINE = 'A free run has 2 leaders. With your own API key, a run can have up to 300.';
const CHOOSE_SIZE = 'Choose 2 to 300 leaders.';
const SETTINGS_NOT_READ = 'The server’s settings could not be read. The server checks the size when you press Start.';
const writesAll = (n: number) => `Paracosm writes all ${n} leaders from this scenario when the run starts, in place of these two.`;
const cohortSentences = (n: number) => `${n} AI leaders each run this scenario for 6 turns, each under its own orders. Press Start to watch them decide. At the end, a report ranks them on morale, population and deaths.`;
const cohortCaption = (n: number) => `All ${n} colonies start with the same 100 people, these 5 among them. Each leader’s decisions make them diverge.`;

const START_FREE = 'Start Mars Genesis: 6 turns, about 3 and a half minutes';
const FREE_SECOND_LINE = '6 turns, about 3½ minutes';
const FREE_RUN = 'This run is free: we pay for it.';
const AI_AGENTS = 'The leaders are AI agents.';
const AFTER_NO_SAVED_RUN = 'After that, add your own API key in Settings to run again today. Your provider bills you for those runs.';
const OWN_KEY_NOTICE = 'This run uses your OpenAI API key, and your provider bills you. Runs on your key skip the daily limit and do not use your free runs. They are not held to this demo’s size, so they can be larger than the free run.';
const SERVER_NOTICE = 'This run uses this server’s API keys.';
const CHECKING = 'Checking your free runs…';
const STARTING = 'Starting…';

/** A provider key saved in Settings, as this browser keeps it: the run is the visitor's own. */
async function saveKey(page: Page): Promise<void> {
  await page.addInitScript(() => { window.localStorage.setItem('paracosm:keyOverrides', '{"openai":"sk-test"}'); });
}

/** The visitor's last launch, as Settings keeps it. */
async function saveLastLaunch(page: Page, config: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => { window.localStorage.setItem('paracosm:lastLaunchConfig', value); }, JSON.stringify(config));
}

const consentAnswered = new WeakSet<Page>();
/** Answers the hosted demo's consent bar once a page, so it covers no part of a picture. */
async function answerConsent(page: Page): Promise<void> {
  if (consentAnswered.has(page)) return;
  const bar = page.locator('#pcc');
  // The bar is built a moment after the page is ready, once its words are hashed.
  await bar.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (await bar.isVisible()) await bar.getByRole('button', { name: 'Reject all' }).click();
  await expect(bar).toBeHidden();
  consentAnswered.add(page);
}

/** Opens an address of the Run tab, waits for the scenario line, and answers the consent bar. */
async function openReadyAt(page: Page, path: string, size: { width: number; height: number }, look: Look, name: string | null = 'Mars Genesis'): Promise<Locator> {
  await page.setViewportSize(size);
  await useLook(page, look);
  await page.goto(path);
  await page.waitForFunction((l) => document.documentElement.classList.contains('light') === (l === 'light'), look);
  const root = page.locator(FIRST_SCREEN);
  // A server of its own (an address with its host) may hold any scenario, and shows no consent bar.
  await expect(root.getByRole('heading', name === null ? { level: 1 } : { level: 1, name })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(root.getByTestId('scenario-figures')).toBeVisible();
  if (path.startsWith('/')) await answerConsent(page);
  return root;
}

/** A request held until `open` is called. */
function gate(): { open: () => void; opened: Promise<void> } {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { open, opened };
}

/** A press made in the page, which reaches a key that says it is unavailable. */
const pressInPage = (key: Locator): Promise<void> => key.evaluate((el) => (el as HTMLElement).click());

/** The parts of the run's size. */
const sizeParts = (root: Locator) => {
  const part = root.getByTestId('run-size');
  return {
    part,
    fewer: part.getByRole('button', { name: 'Fewer leaders', exact: true }),
    field: part.getByRole('spinbutton', { name: 'Number of leaders', exact: true }),
    more: part.getByRole('button', { name: 'More leaders', exact: true }),
  };
};

/** The parts of the Start band. */
const startParts = (root: Locator) => ({
  key: root.getByTestId('start-key'),
  bar: root.getByTestId('start-bar'),
  barLines: root.getByTestId('start-bar-lines'),
  notice: root.getByTestId('start-notice'),
  runLine: root.getByTestId('run-line'),
});

/** The day's count for this test's internet address, asked from the page so it carries the page's address. */
const dayCount = (page: Page): Promise<{ remaining: number; limit: number; resetAt: number }> =>
  page.evaluate(async () => (await fetch('/rate-limit', { cache: 'no-store' })).json());

/** A reset time as the browser prints it: a clock time with its time zone. */
const clockTime = (page: Page, at: number): Promise<string> => page.evaluate(
  (ms) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ms)),
  at,
);

/** Scrolls the first screen's end to the foot of the visible area, where the Start band rests in its place. */
const scrollToBandPlace = (root: Locator): Promise<void> => root.evaluate((el) => { el.scrollIntoView({ block: 'end' }); });

/** An internet address of its own for a second visitor inside one test: one a step and a retry. */
async function secondAddress(context: BrowserContext, info: TestInfo, step: number): Promise<void> {
  await context.setExtraHTTPHeaders({ 'x-real-ip': `203.0.113.${1 + step * 3 + info.retry}` });
}

screenTest('feature 4: a free run names its size', async ({ page }) => {
  test.setTimeout(180_000);
  for (const width of [390, 1100, 1440]) {
    for (const look of LOOKS) {
      await test.step(`${width} in the ${look} look`, async () => {
        const root = await openReadyAt(page, '/sim', sizeAt(width), look);
        const { part } = sizeParts(root);
        const mark = part.getByTestId('leaders-mark');
        await expect(mark).toHaveText('LEADERS');
        const markStyle = await styleOf(mark);
        expect(markStyle.size).toBe(15);
        expect(markStyle.face).toContain('JetBrains Mono');
        // A run on the host's keys is a pair, said in words: no field and no key.
        const value = part.getByTestId('run-size-value');
        await expect(value).toHaveText('2 leaders');
        const line = part.getByTestId('run-size-line');
        await expect(line).toHaveText(FREE_SIZE_LINE);
        await expect(root.getByRole('spinbutton')).toHaveCount(0);
        await expect(part.getByRole('button')).toHaveCount(0);
        // Feature 4, QA step 18: the sizes.
        expect((await styleOf(value)).size).toBe(18);
        expect((await styleOf(line)).size).toBe(15);
        // The size stands in the leaders' heading row: under the shared colony, over the leaders.
        const [colony, size, leaders] = await Promise.all([box(root.getByTestId('shared-colony')), box(part), box(root.getByTestId('leaders'))]);
        expect(size.y).toBeGreaterThanOrEqual(colony.y + colony.height - 1);
        expect(size.y + size.height).toBeLessThanOrEqual(leaders.y + 1);
        // A pair: no row about writing leaders.
        await expect(root.getByTestId('writes-all')).toHaveCount(0);
        await expectNoSidewaysScroll(page, root);
        await part.scrollIntoViewIfNeeded();
        await picture(page, `run-size-free-${width}-${look}`);
      });
    }
  }

  // Feature 4, QA step 16: with the day's free run used and no key, the size reads the same.
  await page.route('**/rate-limit', (route: Route) => route.fulfill({ json: { allowed: false, remaining: 0, limit: 1, resetAt: Date.UTC(2026, 10, 22) } }));
  for (const look of LOOKS) {
    await test.step(`no free run left, 390 in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim', PHONE, look);
      const { part } = sizeParts(root);
      await expect(part.getByTestId('run-size-value')).toHaveText('2 leaders');
      await expect(part.getByTestId('run-size-line')).toHaveText(FREE_SIZE_LINE);
      await expect(root.getByRole('spinbutton')).toHaveCount(0);
      await expect(part.getByRole('button')).toHaveCount(0);
    });
  }
});

screenTest('feature 4: the control with a key', async ({ page, context }) => {
  test.setTimeout(240_000);
  await saveKey(page);
  for (const width of [390, 1100, 1440]) {
    for (const look of LOOKS) {
      await test.step(`${width} in the ${look} look`, async () => {
        const root = await openReadyAt(page, '/sim', sizeAt(width), look);
        const { part, fewer, field, more } = sizeParts(root);
        await expect(part.getByTestId('leaders-mark')).toHaveText('LEADERS');
        await expect(part.getByTestId('run-size-value')).toHaveCount(0);
        // At 2 the fewer key is unavailable, and says why.
        await expect(field).toHaveValue('2');
        await expect(field).toHaveAttribute('aria-valuemin', '2');
        await expect(field).toHaveAttribute('aria-valuemax', '300');
        await expect(field).toHaveAttribute('aria-valuenow', '2');
        await expect(fewer).toBeDisabled();
        await expect(more).toBeEnabled();
        await expect(part.getByTestId('run-size-bound')).toHaveText('2 is the fewest a run takes.');
        await expect(fewer).toHaveAccessibleDescription('2 is the fewest a run takes.');
        expect((await styleOf(field)).size).toBe(18);

        // The keyboard: up, Page Up, End and Home.
        await field.focus();
        await field.press('ArrowUp');
        await expect(field).toHaveValue('3');
        await expect(fewer).toBeEnabled();
        await expect(part.getByTestId('run-size-bound')).toHaveCount(0);
        await field.press('PageUp');
        await expect(field).toHaveValue('13');
        await field.press('End');
        await expect(field).toHaveValue('300');
        await expect(field).toHaveAttribute('aria-valuenow', '300');
        await expect(more).toBeDisabled();
        await expect(part.getByTestId('run-size-bound')).toHaveText('300 is the most a run takes.');
        await field.press('Home');
        await expect(field).toHaveValue('2');

        // A number out of range says so, and the field returns to the nearest bound when it loses focus.
        await field.fill('1');
        const refusal = part.getByTestId('run-size-error');
        await expect(refusal).toHaveText(CHOOSE_SIZE);
        await expect(refusal.locator('[data-mark="warning"]')).toBeVisible();
        await field.blur();
        await expect(field).toHaveValue('2');
        await expect(refusal).toHaveText(CHOOSE_SIZE);
        await field.fill('400');
        await expect(refusal).toHaveText(CHOOSE_SIZE);
        await field.blur();
        await expect(field).toHaveValue('300');
        // A number in range clears the sentence.
        await field.fill('24');
        await field.blur();
        await expect(field).toHaveValue('24');
        await expect(refusal).toHaveCount(0);
        // A number that is not whole keeps the last good one.
        await field.fill('2.5');
        await expect(refusal).toHaveText(CHOOSE_SIZE);
        await field.blur();
        await expect(field).toHaveValue('24');

        // The keys: fewer and more, one leader a press.
        await field.fill('2');
        await field.blur();
        for (let i = 0; i < 22; i += 1) await more.click();
        await expect(field).toHaveValue('24');
        await fewer.click();
        await expect(field).toHaveValue('23');
        await part.scrollIntoViewIfNeeded();
        await picture(page, `run-size-control-${width}-${look}`);
      });
    }
  }

  await test.step('the keys and the field at 320: 44 px targets, 8 px apart, one row', async () => {
    const root = await openReadyAt(page, '/sim', sizeAt(320), 'dark');
    const { part, fewer, field, more } = sizeParts(root);
    const [f, n, m] = await Promise.all([box(fewer), box(field), box(more)]);
    for (const key of [f, m]) {
      expect(key.width).toBeGreaterThanOrEqual(44);
      expect(key.height).toBeGreaterThanOrEqual(44);
    }
    expect(n.height).toBeGreaterThanOrEqual(44);
    expect(n.width).toBeGreaterThanOrEqual(72);
    expect(n.x - (f.x + f.width)).toBeGreaterThanOrEqual(8);
    expect(m.x - (n.x + n.width)).toBeGreaterThanOrEqual(8);
    expect(Math.abs(f.y - m.y)).toBeLessThanOrEqual(1);
    // The mark LEADERS and the three controls on one row.
    const mark = await box(part.getByTestId('leaders-mark'));
    expect(mark.y).toBeLessThan(f.y + f.height);
    expect(mark.y + mark.height).toBeGreaterThan(f.y);
    await expectNoSidewaysScroll(page, root);
    await part.scrollIntoViewIfNeeded();
    await picture(page, 'run-size-control-320-dark');
  });

  await test.step('offline, the control still works', async () => {
    const root = await openReadyAt(page, '/sim', PHONE, 'dark');
    const { field, more } = sizeParts(root);
    await expect(field).toHaveValue('2');
    await context.setOffline(true);
    await more.click();
    await expect(field).toHaveValue('3');
    await context.setOffline(false);
  });

  await test.step('the size reads as words until the server has answered, then the control shows once', async () => {
    const held = gate();
    await page.route('**/rate-limit', async (route: Route) => { await held.opened; await route.continue(); });
    await page.route('**/admin-config', async (route: Route) => { await held.opened; await route.continue(); });
    const root = await openReadyAt(page, '/sim', PHONE, 'light');
    const { part, field } = sizeParts(root);
    await expect(part.getByTestId('run-size-value')).toHaveText('2 leaders');
    await expect(root.getByRole('spinbutton')).toHaveCount(0);
    held.open();
    await expect(field).toBeVisible();
    await expect(part.getByTestId('run-size-value')).toHaveCount(0);
    await page.unroute('**/rate-limit');
    await page.unroute('**/admin-config');
  });
});

screenTest('feature 4: self-hosted takes 2 to 300 with no key', async ({ page }) => {
  test.setTimeout(120_000);
  const config = await (await page.request.get(`${SELF_HOSTED}/admin-config`)).json() as { hostedDemo?: unknown };
  expect(config.hostedDemo).toBe(false);
  for (const look of LOOKS) {
    await test.step(`1440 in the ${look} look`, async () => {
      const root = await openReadyAt(page, `${SELF_HOSTED}/sim`, WIDE, look, null);
      const { part, fewer, field, more } = sizeParts(root);
      await expect(part.getByTestId('run-size-value')).toHaveCount(0);
      await expect(field).toHaveValue('2');
      await expect(fewer).toBeDisabled();
      await field.focus();
      await field.press('End');
      await expect(field).toHaveValue('300');
      await expect(more).toBeDisabled();
      await field.press('Home');
      await expect(field).toHaveValue('2');
      await part.scrollIntoViewIfNeeded();
      await picture(page, `run-size-self-hosted-1440-${look}`);
    });
  }
});

screenTest('feature 4: settings could not be read', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/admin-config', (route: Route) => route.abort('failed'));
  await test.step('with no key, the pair as words', async () => {
    const root = await openRun(page, PHONE, 'dark');
    await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis' })).toBeVisible();
    const { part } = sizeParts(root);
    await expect(part.getByTestId('run-size-value')).toHaveText('2 leaders');
    await expect(root.getByRole('spinbutton')).toHaveCount(0);
    await expect(part.getByTestId('run-size-settings')).toHaveCount(0);
  });
  await saveKey(page);
  for (const look of LOOKS) {
    await test.step(`with a key, 390 in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim', PHONE, look);
      const { part, field } = sizeParts(root);
      await expect(field).toHaveValue('2');
      const said = part.getByTestId('run-size-settings');
      await expect(said).toHaveText(SETTINGS_NOT_READ);
      expect((await styleOf(said)).size).toBe(15);
      await part.scrollIntoViewIfNeeded();
      await picture(page, `run-size-settings-not-read-390-${look}`);
    });
  }
});

screenTest('scale: the first screen at 24 and 300', async ({ page }) => {
  test.setTimeout(300_000);
  await saveKey(page);
  for (const n of [24, 300]) {
    for (const size of [PHONE, WIDE]) {
      for (const look of LOOKS) {
        await test.step(`${n} leaders at ${size.width} in the ${look} look`, async () => {
          const root = await openReadyAt(page, `/sim?size=${n}`, size, look);
          const { field } = sizeParts(root);
          await expect(field).toHaveValue(String(n));
          // The scenario line is written for the run's size.
          await expect(root.getByTestId('scenario-sentences')).toHaveText(cohortSentences(n));
          await expect(root.getByTestId('scenario-figures')).toHaveText(OWN_KEY_FIGURES);
          // The two written leaders, and one row saying Paracosm writes them all.
          const leaders = root.getByTestId('leaders');
          await expect(leaders.getByTestId('writes-all')).toHaveText(writesAll(n));
          if (size.width >= 1100) await expect(leaders.getByRole('article')).toHaveCount(2);
          else await expect(leaders.getByRole('tab')).toHaveCount(2);
          await expect(leaders).toContainText(ARIA.title);
          // Exactly one colony field, whatever the size.
          const colony = root.getByTestId('shared-colony');
          await expect(root.locator('canvas')).toHaveCount(1);
          await expect(colony.locator('canvas')).toHaveCount(1);
          await expect(colony.getByTestId('colony-caption')).toHaveText(cohortCaption(n));
          expect(await measureReadability(page)).toEqual([]);
          expect(await axeFindings(page)).toEqual([]);
          await expectNoSidewaysScroll(page, root);
          await root.getByTestId('run-size').scrollIntoViewIfNeeded();
          await picture(page, `scale-${n}-${size.width}-${look}`);
        });
      }
    }
  }

  await test.step('every row is one row at six widths with the control shown', async () => {
    for (const width of [320, 360, 390, 430, 480, 768]) {
      const root = await openReadyAt(page, '/sim?size=24', sizeAt(width), 'dark');
      await expect(sizeParts(root).field).toHaveValue('24');
      expect(await rowsOnOneRow(page), `at ${width}`).toEqual([]);
      await expectNoSidewaysScroll(page, root);
    }
  });

  await test.step('the size is kept in the address', async () => {
    const root = await openReadyAt(page, '/sim?size=300', WIDE, 'dark');
    const { field } = sizeParts(root);
    await expect(field).toHaveValue('300');
    await page.reload();
    await expect(field).toHaveValue('300');
    // A change of the size is written to the address, so a reload keeps it.
    await field.focus();
    await field.press('Home');
    await field.press('PageUp');
    await expect(field).toHaveValue('12');
    expect(new URL(page.url()).searchParams.get('size')).toBe('12');
    await page.reload();
    await expect(field).toHaveValue('12');
    await expect(root.getByTestId('scenario-sentences')).toHaveText(cohortSentences(12));
  });

  await test.step('a size the address cannot hold falls back to 2, with no error', async () => {
    for (const bad of ['999', '1', '2.5', 'many']) {
      const root = await openReadyAt(page, `/sim?size=${bad}`, WIDE, 'dark');
      const { part, field } = sizeParts(root);
      await expect(field).toHaveValue('2');
      await expect(part.getByTestId('run-size-error')).toHaveCount(0);
      await expect(root.getByTestId('scenario-sentences')).toHaveText(PAIR_SENTENCES);
    }
  });
});

screenTest('feature 10: Start on a free run', async ({ page }) => {
  test.setTimeout(180_000);
  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        const root = await openReadyAt(page, '/sim', size, look);
        const { key, notice } = startParts(root);
        // The one filled key, named for the scenario and the run's length.
        await expect(root.getByRole('button', { name: START_FREE, exact: true })).toHaveCount(1);
        await expect(key).toHaveAccessibleName(START_FREE);
        await expect(key).toBeEnabled();
        const first = key.getByTestId('start-first');
        const second = key.getByTestId('start-second');
        await expect(first).toHaveText('Start');
        await expect(second).toHaveText(FREE_SECOND_LINE);
        expect(await key.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await tokenColour(page, '--rust'));
        expect((await styleOf(first)).colour).toBe(await tokenColour(page, '--text-contrast'));
        // Feature 10, QA step 19: the sizes.
        const firstStyle = await styleOf(first);
        expect(firstStyle.size).toBeGreaterThanOrEqual(18);
        expect(firstStyle.face).toContain('JetBrains Mono');
        expect(await first.evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase');
        expect((await styleOf(second)).size).toBe(15);
        expect((await box(key)).height).toBeGreaterThanOrEqual(size.width < 600 ? 64 : 56);
        if (size.width < 600) expect((await box(key)).width).toBeGreaterThanOrEqual((await box(root)).width - 1);
        else expect((await box(key)).width).toBeGreaterThanOrEqual(320);

        // The notice: who pays, the day's count with its reset time, and what comes after.
        await scrollToBandPlace(root);
        const count = await dayCount(page);
        expect(count.limit).toBe(1);
        expect(count.remaining).toBe(1);
        const ink = await tokenColour(page, '--text-1');
        const pays = notice.getByTestId('notice-pays');
        await expect(pays).toHaveText(FREE_RUN);
        expect(await styleOf(pays)).toMatchObject({ size: 18, colour: ink });
        const counted = notice.getByTestId('notice-count');
        await expect(counted).toHaveText(`Free runs left today on your internet address: 1 of 1, shared by everyone using it. They reset at ${await clockTime(page, count.resetAt)}. A new run or a fork uses one.`);
        await expect(counted).toHaveAttribute('role', 'status');
        await expect(notice.getByTestId('notice-after')).toHaveText(AFTER_NO_SAVED_RUN);
        // No sentence names a provider yet, and no dollar or token figure shows on a free run.
        await expect(notice).not.toContainText('It runs on');
        await expect(root).not.toContainText('USD');
        // A sample scenario's own name in the paste form's menu is no figure of a run's cost.
        expect(await wordsOf(root)).not.toContain('$');
        await expect(root.getByTestId('start-estimate')).toHaveCount(0);
        await picture(page, `start-free-${size.width}-${look}`);
      });
    }
  }

  await test.step('a day\'s limit of 3: the count reads what the server answers', async () => {
    const resetAt = Date.UTC(2026, 10, 22);
    await page.route('**/rate-limit', (route: Route) => route.fulfill({ json: { allowed: true, remaining: 3, limit: 3, resetAt } }));
    const root = await openReadyAt(page, '/sim', PHONE, 'dark');
    const { key, notice } = startParts(root);
    await expect(key).toHaveAccessibleName(START_FREE);
    await expect(notice.getByTestId('notice-count')).toHaveText(`Free runs left today on your internet address: 3 of 3, shared by everyone using it. They reset at ${await clockTime(page, resetAt)}. A new run or a fork uses one.`);
    await page.unroute('**/rate-limit');
  });
});

screenTest('feature 10: one press, three stages, then Watch', async ({ page, context }, info) => {
  test.setTimeout(180_000);
  const written = writtenOf(await serverScenario(page));
  try {
    await test.step('390 in the dark look: checking, starting, one request, then Watch', async () => {
      let holdCheck = false;
      const check = gate();
      const setup = gate();
      await page.route('**/rate-limit', async (route: Route) => { if (holdCheck) await check.opened; await route.continue(); });
      await page.route('**/setup', async (route: Route) => { await setup.opened; await route.continue(); });
      const posted: Array<Record<string, unknown>> = [];
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/setup') posted.push(request.postDataJSON() as Record<string, unknown>);
      });

      const root = await openReadyAt(page, '/sim', PHONE, 'dark');
      const { key } = startParts(root);
      await expect(key).toHaveAccessibleName(START_FREE);
      holdCheck = true;
      await key.click();
      // The day's count is read again before anything is posted.
      await expect(key).toHaveText(CHECKING);
      await expect(key).toBeDisabled();
      await pressInPage(key);
      expect(posted).toHaveLength(0);
      holdCheck = false;
      check.open();
      await expect(key).toHaveText(STARTING);
      await expect(key).toBeDisabled();
      // A second press while the run starts posts nothing.
      await pressInPage(key);
      await pressInPage(key);
      // The first screen stays, with its colony field, until the page moves to Watch.
      await expect(root.getByTestId('shared-colony').locator('canvas')).toBeVisible();
      await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis' })).toBeVisible();
      expect(new URL(page.url()).searchParams.get('tab')).not.toBe('sim');
      await picture(page, 'start-starting-390-dark');
      setup.open();
      await page.waitForURL((url) => url.searchParams.get('tab') === 'sim');
      expect(posted).toHaveLength(1);

      const body = posted[0];
      expect(body.turns).toBe(6);
      expect(body.seed).toBe(950);
      expect(body.captureSnapshots).toBe(true);
      expect(body.quickstart).toEqual({ scenarioId: 'mars-genesis' });
      expect(body.actors).toEqual(written.map((l) => ({ name: l.name, archetype: l.archetype, hexaco: l.hexaco, instructions: l.instructions })));
      // A run on the host's keys posts no key.
      expect(body.apiKey).toBeUndefined();
      expect(body.anthropicKey).toBeUndefined();
      await page.unroute('**/rate-limit');
      await page.unroute('**/setup');
    });

    await test.step('1440 in the dark look: one press, then Watch', async () => {
      await page.request.post(`${SERVER}/clear`);
      await secondAddress(context, info, 0);
      const root = await openReadyAt(page, '/sim', WIDE, 'dark');
      const { key } = startParts(root);
      await expect(key).toHaveAccessibleName(START_FREE);
      await key.click();
      await page.waitForURL((url) => url.searchParams.get('tab') === 'sim');
    });
  } finally {
    // The stub run holds a run slot until its visitor clears it.
    await page.request.post(`${SERVER}/clear`).catch(() => undefined);
  }
});

screenTest('feature 10: checking and offline', async ({ page, context }) => {
  test.setTimeout(180_000);
  for (const look of LOOKS) {
    await test.step(`checking, 390 in the ${look} look`, async () => {
      const held = gate();
      await page.route('**/rate-limit', async (route: Route) => { await held.opened; await route.continue(); });
      const root = await openReadyAt(page, '/sim', PHONE, look);
      const { key, runLine } = startParts(root);
      // An inactive Start has no fill: the control edge, its words in the quiet tone, and it says what it waits for.
      await expect(key).toHaveText(CHECKING);
      await expect(key).toBeDisabled();
      const quiet = await tokenColour(page, look === 'light' ? '--text-3' : '--text-2');
      const edge = await tokenColour(page, '--edge-control');
      const drawn = await key.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { ground: cs.backgroundColor, edge: cs.borderTopColor, edgeWidth: parseFloat(cs.borderTopWidth) };
      });
      expect(drawn.ground).not.toBe(await tokenColour(page, '--rust'));
      expect(drawn.edge).toBe(edge);
      expect(drawn.edgeWidth).toBeGreaterThanOrEqual(1);
      expect((await styleOf(key.getByTestId('start-words'))).colour).toBe(quiet);
      // The wait is drawn too: the run line's six marks as empty outlines in the control edge.
      await scrollToBandPlace(root);
      const marks = runLine.locator('[data-run-mark]');
      await expect(marks).toHaveCount(6);
      for (const mark of await marks.evaluateAll((els) => els.map((el) => {
        const cs = getComputedStyle(el);
        return { ground: cs.backgroundColor, edge: cs.borderTopColor, edgeWidth: parseFloat(cs.borderTopWidth) };
      }))) {
        expect(mark.ground).toBe('rgba(0, 0, 0, 0)');
        expect(mark.edge).toBe(edge);
        expect(mark.edgeWidth).toBeGreaterThanOrEqual(1);
      }
      expect(await measureReadability(page)).toEqual([]);
      await picture(page, `start-checking-390-${look}`);

      held.open();
      await expect(key).toHaveAccessibleName(START_FREE);
      await expect(key).toBeEnabled();
      // At rest the marks are filled in the control edge.
      expect(await marks.first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(edge);
      await page.unroute('**/rate-limit');
    });

    await test.step(`offline, 390 in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim', PHONE, look);
      const { key } = startParts(root);
      await expect(key).toHaveAccessibleName(START_FREE);
      await context.setOffline(true);
      await expect(key).toHaveText('You are offline');
      await expect(key).toBeDisabled();
      const beside = root.getByTestId('start-offline');
      await expect(beside).toHaveText('Start works when you are back online.');
      await expect(beside.locator('[data-mark="broken-link"]')).toBeVisible();
      // The leaders' orders stay readable.
      await expect(root.getByTestId('leaders').getByTestId('leader-orders')).toBeVisible();
      await picture(page, `start-offline-390-${look}`);
      await context.setOffline(false);
      await expect(key).toHaveAccessibleName(START_FREE);
      await expect(key).toBeEnabled();
    });
  }
});

screenTest('feature 10: own key and self-hosted', async ({ page }) => {
  test.setTimeout(240_000);
  await test.step('a self-hosted server, with no key', async () => {
    const config = await (await page.request.get(`${SELF_HOSTED}/admin-config`)).json() as { hostedDemo?: unknown };
    expect(config.hostedDemo).toBe(false);
    for (const look of LOOKS) {
      const root = await openReadyAt(page, `${SELF_HOSTED}/sim`, WIDE, look, null);
      const name = (await root.getByRole('heading', { level: 1 }).textContent() ?? '').trim();
      const { key, notice } = startParts(root);
      await expect(key.getByTestId('start-second')).toHaveText('6 turns, on this server’s API keys');
      await expect(key).toHaveAccessibleName(`Start ${name}: 6 turns, on this server’s API keys`);
      await scrollToBandPlace(root);
      await expect(notice.getByTestId('notice-pays')).toHaveText(SERVER_NOTICE);
      await expect(notice.getByTestId('notice-count')).toHaveCount(0);
      await expect(root.getByTestId('start-estimate')).toHaveCount(0);
      await picture(page, `start-self-hosted-1440-${look}`);
    }
    // From 3 leaders up the estimate names this server's keys and its models.
    const root = await openReadyAt(page, `${SELF_HOSTED}/sim?size=24`, WIDE, 'dark', null);
    await expect(startParts(root).key.getByTestId('start-second')).toHaveText('24 leaders, 6 turns, on this server’s API keys');
    await expect(root.getByTestId('start-estimate')).toHaveText('Estimated cost: about 14.50 USD on this server’s keys, from the mean cost of four pair runs measured on the hosted demo’s economy models. The server’s models set the real price.');
  });

  await saveKey(page);
  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`own key at a pair, ${size.width} in the ${look} look`, async () => {
        const root = await openReadyAt(page, '/sim', size, look);
        const { key, notice, runLine } = startParts(root);
        await expect(key.getByTestId('start-first')).toHaveText('Start');
        await expect(key.getByTestId('start-second')).toHaveText('6 turns, on your own API key');
        await expect(key).toHaveAccessibleName('Start Mars Genesis: 6 turns, on your own API key');
        await expect(key).toBeEnabled();
        await scrollToBandPlace(root);
        await expect(notice.getByTestId('notice-pays')).toHaveText(OWN_KEY_NOTICE);
        // A run on the visitor's key counts no free run, and a pair shows no estimate.
        await expect(notice.getByTestId('notice-count')).toHaveCount(0);
        await expect(notice).not.toContainText('Free runs left');
        await expect(root.getByTestId('start-estimate')).toHaveCount(0);
        await expect(runLine.getByTestId('run-end')).toHaveText('Verdict');
        expect(await measureReadability(page)).toEqual([]);
        await picture(page, `start-own-key-${size.width}-${look}`);
      });

      await test.step(`own key at 24, ${size.width} in the ${look} look`, async () => {
        const root = await openReadyAt(page, '/sim?size=24', size, look);
        const { key } = startParts(root);
        await expect(key.getByTestId('start-second')).toHaveText('24 leaders, 6 turns, on your own API key');
        await expect(key).toHaveAccessibleName('Start Mars Genesis: 24 leaders, 6 turns, on your own API key');
        await scrollToBandPlace(root);
        // With no provider and models saved, the estimate leaves the sentence that names them out.
        const estimate = root.getByTestId('start-estimate');
        await expect(estimate).toHaveText('Estimated cost: about 14.50 USD on your key, from the mean cost of four pair runs measured on this demo’s economy models.');
        expect((await styleOf(estimate)).size).toBe(18);
        await picture(page, `start-own-key-24-${size.width}-${look}`);
      });
    }
  }

  await test.step('own key at 300', async () => {
    const root = await openReadyAt(page, '/sim?size=300', WIDE, 'dark');
    await expect(startParts(root).key.getByTestId('start-second')).toHaveText('300 leaders, 6 turns, on your own API key');
    await expect(root.getByTestId('start-estimate')).toContainText('about 180.10 USD on your key');
  });

  await test.step('the estimate names the provider and models the visitor saved', async () => {
    await saveLastLaunch(page, { scenarioId: 'mars-genesis', provider: 'openai', models: { commander: 'model-a', departments: 'model-b' } });
    const root = await openReadyAt(page, '/sim?size=24', WIDE, 'dark');
    await expect(root.getByTestId('start-estimate')).toHaveText('Estimated cost: about 14.50 USD on your key, from the mean cost of four pair runs measured on this demo’s economy models. Your run uses OpenAI (model-a, model-b) from your Settings, which set the real price.');
  });
});

screenTest('feature 10: a keyed run of 3 writes its leaders, then starts', async ({ page }) => {
  test.setTimeout(120_000);
  await saveKey(page);
  const three = ['One', 'Two', 'Three'].map((word, i) => ({
    name: `Leader ${word}`,
    archetype: `The ${word}`,
    unit: `Unit ${i + 1}`,
    hexaco: { openness: 0.2 + i * 0.3, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
    instructions: `You are Leader ${word}.`,
  }));
  const writing = gate();
  const setup = gate();
  const asked: Array<Record<string, unknown>> = [];
  const posted: Array<Record<string, unknown>> = [];
  // The model that writes the leaders is stood in for; the page's own requests are recorded.
  await page.route('**/api/quickstart/generate-actors', async (route: Route) => {
    asked.push(route.request().postDataJSON() as Record<string, unknown>);
    await writing.opened;
    await route.fulfill({ json: { actors: three } });
  });
  await page.route('**/setup', async (route: Route) => {
    posted.push(route.request().postDataJSON() as Record<string, unknown>);
    await setup.opened;
    await route.fulfill({ json: { redirect: '/sim' } });
  });

  const root = await openReadyAt(page, '/sim?size=3', WIDE, 'dark');
  const { key } = startParts(root);
  const { field, fewer, more } = sizeParts(root);
  await expect(key.getByTestId('start-second')).toHaveText('3 leaders, 6 turns, on your own API key');
  await key.click();
  await expect(key).toHaveText('Writing 3 leaders…');
  await expect(key).toBeDisabled();
  // The size is locked while the leaders are written.
  await expect(field).toBeDisabled();
  await expect(fewer).toBeDisabled();
  await expect(more).toBeDisabled();
  expect(posted).toHaveLength(0);
  await picture(page, 'start-writing-1440-dark');
  writing.open();
  await expect(key).toHaveText(STARTING);
  await pressInPage(key);
  setup.open();
  await page.waitForURL((url) => url.searchParams.get('tab') === 'sim');

  expect(asked).toEqual([{ scenarioId: 'mars-genesis', count: 3, apiKey: 'sk-test' }]);
  expect(posted).toHaveLength(1);
  // The three leaders as they were written, and every other field as the launch works it out.
  expect(posted[0]).toEqual({
    apiKey: 'sk-test',
    actors: three,
    turns: 6,
    seed: 950,
    captureSnapshots: true,
    quickstart: { scenarioId: 'mars-genesis' },
  });
});

screenTest('feature 10: the run line', async ({ page }) => {
  test.setTimeout(240_000);
  for (const width of [320, 390, 600, 1100, 1440]) {
    for (const look of LOOKS) {
      await test.step(`a pair at ${width} in the ${look} look`, async () => {
        const root = await openReadyAt(page, '/sim', sizeAt(width), look);
        const { key, runLine } = startParts(root);
        await scrollToBandPlace(root);
        await expect(runLine).toHaveCount(1);
        // One mark a turn, in one row, to the plain word Verdict; nothing on the line is pressed.
        const marks = runLine.locator('[data-run-mark]');
        await expect(marks).toHaveCount(6);
        const end = runLine.getByTestId('run-end');
        await expect(end).toHaveText('Verdict');
        expect(await end.evaluate((el) => {
          const cs = getComputedStyle(el);
          return ['top', 'right', 'bottom', 'left'].map((side) => parseFloat(cs.getPropertyValue(`border-${side}-width`)));
        })).toEqual([0, 0, 0, 0]);
        await expect(runLine.locator('button, a, [tabindex]')).toHaveCount(0);
        await expect(runLine).toHaveAttribute('aria-hidden', 'true');
        const boxes = await marks.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
        for (const top of boxes) expect(Math.abs(top - boxes[0])).toBeLessThanOrEqual(1);
        const [line, word, start] = await Promise.all([box(runLine), box(end), box(key)]);
        expect(word.x).toBeGreaterThanOrEqual((await box(marks.last())).x);
        if (width < 600) {
          // On a phone the line stands in the page, directly above Start's place.
          expect(line.y + line.height).toBeLessThanOrEqual(start.y + 1);
        } else {
          // From the tablet width the line runs from the key's side to its end word, in the key's row.
          expect(line.x).toBeGreaterThanOrEqual(start.x + start.width - 1);
          expect(line.y).toBeLessThan(start.y + start.height);
          expect(line.y + line.height).toBeGreaterThan(start.y);
        }
        await picture(page, `run-line-pair-${width}-${look}`);
      });
    }
  }

  await saveKey(page);
  await test.step('a cohort ends in a report', async () => {
    for (const size of [PHONE, WIDE]) {
      const root = await openReadyAt(page, '/sim?size=24', size, 'dark');
      const { runLine } = startParts(root);
      await scrollToBandPlace(root);
      await expect(runLine.locator('[data-run-mark]')).toHaveCount(6);
      await expect(runLine.getByTestId('run-end')).toHaveText('Report');
    }
  });

  await test.step('past 20 turns, a ruler with a tick every 10 turns', async () => {
    await saveLastLaunch(page, { scenarioId: 'mars-genesis', turns: 40 });
    for (const size of [PHONE, WIDE]) {
      for (const look of LOOKS) {
        const root = await openReadyAt(page, '/sim?size=24', size, look);
        const { key, runLine } = startParts(root);
        await expect(key.getByTestId('start-second')).toHaveText('24 leaders, 40 turns, on your own API key');
        await scrollToBandPlace(root);
        await expect(runLine.locator('[data-run-mark]')).toHaveCount(0);
        await expect(runLine.getByTestId('run-ruler')).toBeVisible();
        await expect(runLine.locator('[data-run-tick]')).toHaveCount(4);
        await expect(runLine.getByTestId('run-first-turn')).toHaveText('1');
        await expect(runLine.getByTestId('run-last-turn')).toHaveText('40');
        await expect(runLine.getByTestId('run-end')).toHaveText('Report');
        expect(await rowsOnOneRow(page)).toEqual([]);
        expect(await measureReadability(page)).toEqual([]);
        await picture(page, `run-line-ruler-${size.width}-${look}`);
      }
    }
  });
});

screenTest('feature 10: the bar and the band', async ({ page }) => {
  test.setTimeout(300_000);
  const windowHeight = () => page.evaluate(() => window.innerHeight);

  await test.step('a first visit on a phone: the Start bar stands whole above the consent bar', async () => {
    const root = await openReady(page, PHONE, 'dark');
    const consent = page.locator('#pcc');
    await expect(consent).toBeVisible();
    const { key, bar } = startParts(root);
    await expect(key).toHaveAccessibleName(START_FREE);
    await expect(bar).toHaveAttribute('data-stuck', 'true');
    await expect.poll(async () => (await box(bar)).y + (await box(bar)).height - (await box(consent)).y, { message: 'the Start bar ends where the consent bar starts' }).toBeLessThanOrEqual(1);
    const [b, c] = await Promise.all([box(bar), box(consent)]);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(c.y + c.height).toBeLessThanOrEqual(await windowHeight() + 1);
    // Reached by keyboard, Start is in view above both bars.
    await key.focus();
    await expect(key).toBeFocused();
    const k = await box(key);
    expect(k.y).toBeGreaterThanOrEqual(0);
    expect(k.y + k.height).toBeLessThanOrEqual((await box(consent)).y + 1);
    await picture(page, 'start-bar-with-consent-390-dark');
  });

  for (const look of LOOKS) {
    await test.step(`390 by 844 in the ${look} look: stuck, then resting in its place`, async () => {
      const root = await openReadyAt(page, '/sim', PHONE, look);
      const { key, bar, barLines, notice, runLine } = startParts(root);
      // Before any scroll: the bar at the bottom edge, its two lines over Start.
      await expect(bar).toHaveAttribute('data-stuck', 'true');
      await expect(barLines.locator('p')).toHaveText([FREE_RUN, AI_AGENTS]);
      for (const line of await barLines.locator('p').all()) expect((await styleOf(line)).size).toBe(15);
      const quiet = await tokenColour(page, look === 'light' ? '--text-3' : '--text-2');
      expect((await styleOf(barLines.locator('p').first())).colour).toBe(quiet);
      const [lines, start, held] = await Promise.all([box(barLines), box(key), box(bar)]);
      expect(lines.y + lines.height).toBeLessThanOrEqual(start.y + 1);
      expect(held.y + held.height).toBeLessThanOrEqual(await windowHeight() + 1);
      expect(start.height).toBeGreaterThanOrEqual(64);
      // The bar is solid, on the card ground, and its lines are not a live region.
      expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await tokenColour(page, '--bg-card'));
      await expect(barLines).not.toHaveAttribute('role', 'status');
      await picture(page, `start-bar-stuck-390-${look}`);

      // A control reached by keyboard is never under the bar, whose two lines are its top.
      const tab = root.getByTestId('leaders').getByRole('tab').first();
      await tab.focus();
      const [focused, over] = await Promise.all([box(tab), box(barLines)]);
      expect(focused.y + focused.height).toBeLessThanOrEqual(over.y + 1);

      // Scrolled to its place, the bar rests there holding the key alone, the whole notice and the run line directly above it.
      await scrollToBandPlace(root);
      await expect(bar).toHaveAttribute('data-stuck', 'false');
      await expect(barLines).toHaveCount(0);
      await expect(key).toBeVisible();
      const [resting, said, line] = await Promise.all([box(bar), box(notice), box(runLine)]);
      expect(said.y + said.height).toBeLessThanOrEqual(line.y + 1);
      expect(line.y + line.height).toBeLessThanOrEqual(resting.y + 1);
      await expect(notice.getByTestId('notice-pays')).toHaveText(FREE_RUN);
      await picture(page, `start-bar-resting-390-${look}`);
    });
  }

  await test.step('320 by 568 in the dark look: stuck, then resting in its place', async () => {
    const small = { width: 320, height: 568 };
    const root = await openReadyAt(page, '/sim', small, 'dark');
    const { key, bar, barLines } = startParts(root);
    await expect(bar).toHaveAttribute('data-stuck', 'true');
    await expect(barLines.locator('p')).toHaveText([FREE_RUN, AI_AGENTS]);
    // The key's two lines fit inside it, and the bar is whole in the window.
    const [start, held] = await Promise.all([box(key), box(bar)]);
    for (const line of [key.getByTestId('start-first'), key.getByTestId('start-second')]) {
      const b = await box(line);
      expect(b.x).toBeGreaterThanOrEqual(start.x);
      expect(b.x + b.width).toBeLessThanOrEqual(start.x + start.width + 1);
      expect(b.y).toBeGreaterThanOrEqual(start.y);
      expect(b.y + b.height).toBeLessThanOrEqual(start.y + start.height + 1);
    }
    expect(held.y + held.height).toBeLessThanOrEqual(await windowHeight() + 1);
    await expectNoSidewaysScroll(page, root);
    await picture(page, 'start-bar-stuck-320x568-dark');
    await scrollToBandPlace(root);
    await expect(bar).toHaveAttribute('data-stuck', 'false');
    await expect(barLines).toHaveCount(0);
    await expect(key).toBeVisible();
  });

  await test.step('Start is on screen at first paint in four windows', async () => {
    for (const size of [{ width: 1440, height: 900 }, { width: 1100, height: 800 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      for (const look of LOOKS) {
        const root = await openReadyAt(page, '/sim', size, look);
        const { key } = startParts(root);
        await expect(key).toHaveAccessibleName(START_FREE);
        const k = await box(key);
        expect(k.y, `Start at ${size.width} by ${size.height}`).toBeGreaterThanOrEqual(0);
        expect(k.y + k.height, `Start at ${size.width} by ${size.height}`).toBeLessThanOrEqual(await windowHeight());
        expect(k.x).toBeGreaterThanOrEqual(0);
        expect(k.x + k.width).toBeLessThanOrEqual(size.width);
        await picture(page, `start-first-paint-${size.width}x${size.height}-${look}`);
      }
    }
  });

  for (const look of LOOKS) {
    await test.step(`600 in the ${look} look`, async () => {
      // The bar's two lines over a row of the 320 px key and the run line to Verdict.
      const root = await openReadyAt(page, '/sim', sizeAt(600), look);
      const { key, bar, barLines, runLine } = startParts(root);
      await expect(bar).toHaveAttribute('data-stuck', 'true');
      await expect(barLines.locator('p')).toHaveText([FREE_RUN, AI_AGENTS]);
      const [lines, start, line] = await Promise.all([box(barLines), box(key), box(runLine)]);
      expect(Math.abs(start.width - 320)).toBeLessThanOrEqual(1);
      expect(lines.y + lines.height).toBeLessThanOrEqual(start.y + 1);
      expect(line.x).toBeGreaterThanOrEqual(start.x + start.width - 1);
      await expect(runLine.getByTestId('run-end')).toHaveText('Verdict');
      await picture(page, `start-bar-600-${look}`);
    });

    await test.step(`768 in the ${look} look`, async () => {
      // One row 72 px high, the key at the left and the two lines at its right.
      const root = await openReadyAt(page, '/sim', { width: 768, height: 1024 }, look);
      const { key, bar, barLines } = startParts(root);
      await expect(bar).toHaveAttribute('data-stuck', 'true');
      const held = await box(bar);
      expect(Math.abs(held.height - 72)).toBeLessThanOrEqual(2);
      const [lines, start] = await Promise.all([box(barLines), box(key)]);
      expect(lines.x).toBeGreaterThanOrEqual(start.x + start.width - 1);
      expect(lines.y).toBeLessThan(start.y + start.height);
      expect(lines.y + lines.height).toBeGreaterThan(start.y);
      expect(start.height).toBeGreaterThanOrEqual(56);
      await picture(page, `start-bar-768-${look}`);
    });

    await test.step(`1440 by 900 in the ${look} look: the band held at the bottom edge, then in its place`, async () => {
      const root = await openReadyAt(page, '/sim', WIDE, look);
      const { key, bar, barLines, notice, runLine } = startParts(root);
      // Held: Start with its second line, six marks to Verdict, and the two first sentences.
      await expect(bar).toHaveAttribute('data-stuck', 'true');
      await expect(key.getByTestId('start-second')).toHaveText(FREE_SECOND_LINE);
      await expect(runLine.locator('[data-run-mark]')).toHaveCount(6);
      await expect(runLine.getByTestId('run-end')).toHaveText('Verdict');
      await expect(barLines.locator('p')).toHaveText([FREE_RUN, AI_AGENTS]);
      const held = await box(bar);
      expect(held.y + held.height).toBeLessThanOrEqual(await windowHeight() + 1);
      for (const part of [key, runLine, barLines]) {
        const b = await box(part);
        expect(b.y).toBeGreaterThanOrEqual(held.y - 1);
        expect(b.y + b.height).toBeLessThanOrEqual(held.y + held.height + 1);
      }
      await picture(page, `start-band-held-1440-${look}`);

      // In its place: the key at the left, the run line in the middle, the whole notice in a 420 px column at the right.
      await scrollToBandPlace(root);
      await expect(bar).toHaveAttribute('data-stuck', 'false');
      await expect(barLines).toHaveCount(0);
      const [start, line, said] = await Promise.all([box(key), box(runLine), box(notice)]);
      expect(Math.abs(start.width - 360)).toBeLessThanOrEqual(1);
      expect(line.x).toBeGreaterThanOrEqual(start.x + start.width - 1);
      expect(said.x).toBeGreaterThanOrEqual(line.x + line.width - 1);
      expect(Math.abs(said.width - 420)).toBeLessThanOrEqual(1);
      expect(Math.abs(said.y - start.y)).toBeLessThanOrEqual(24);
      await expect(notice.getByTestId('notice-after')).toHaveText(AFTER_NO_SAVED_RUN);
      expect(await measureReadability(page)).toEqual([]);
      await picture(page, `start-band-resting-1440-${look}`);
    });
  }

  await test.step('1100: the key 340 px wide, the run line to its end word, the whole notice under the run line', async () => {
    const root = await openReadyAt(page, '/sim', sizeAt(1100), 'dark');
    const { key, bar, notice, runLine } = startParts(root);
    await scrollToBandPlace(root);
    await expect(bar).toHaveAttribute('data-stuck', 'false');
    const [start, line, said] = await Promise.all([box(key), box(runLine), box(notice)]);
    expect(Math.abs(start.width - 340)).toBeLessThanOrEqual(1);
    expect(line.x).toBeGreaterThanOrEqual(start.x + start.width - 1);
    expect(said.y).toBeGreaterThanOrEqual(line.y + line.height - 1);
    expect(said.x).toBeGreaterThanOrEqual(start.x + start.width - 1);
    await picture(page, 'start-band-resting-1100-dark');
  });
});

/* At the day's limit, the failures and the reset clock (feature 10). */

/** Midnight UTC on 22 Nov 2026: 4:00 PM on the day before in Los Angeles, 01:00 in Berlin. */
const RESET_AT = Date.UTC(2026, 10, 22);
const AT_LIMIT_SENTENCES = 'Two AI leaders each run this scenario for 6 turns, each under its own orders. At the end, a verdict says who won and why.';
const NO_RUN_LEFT = 'Your internet address has no free runs left today.';
const atLimitReset = (time: string) => `${NO_RUN_LEFT} They reset at ${time}.`;
const REPLAY_FREE = 'You can replay a saved run for free.';
const ADD_KEY_PARAGRAPH = 'To start a new run now, add your own API key in Settings: your provider bills you, and the run is not held to this demo’s size.';
const ADD_KEY_LINK = 'Add your API key in Settings';
const WATCH_LAST = 'Watch your last run again';
const WATCH_TEAM = 'Watch our team’s run';
const WATCH_TEAM_SPOKEN = 'Watch our team’s run: Mars Genesis, 6 turns';
const COULD_NOT_REACH = 'Could not reach the server. Check your connection and press Start again.';
const SERVER_BUSY = 'The server is busy. Press Start again in a moment.';
const SLOTS_IN_USE = 'Every run slot on the server is in use. Press Start again in a minute.';
const DID_NOT_START = 'The run did not start. Press Start again.';
const SAVED_RUNS_FAILED = 'Your saved runs did not load.';
const COUNT_UNAVAILABLE = 'Free runs left today: unavailable.';
const START_OWN_KEY = 'Start Mars Genesis: 6 turns, on your own API key';

/** A saved Mars Genesis pair as GET /sessions lists it. */
const savedRun = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt: Date.UTC(2026, 10, 21, 12),
  scenarioId: 'mars-genesis',
  scenarioName: 'Mars Genesis',
  leaderA: 'Aria Chen',
  leaderB: 'Dietrich Voss',
  turnCount: 6,
  eventCount: 40,
  ...extra,
});

/** GET /sessions answers these rows. */
const routeSessions = (page: Page, rows: unknown[]): Promise<void> =>
  page.route('**/sessions', (route: Route) => route.fulfill({ json: { sessions: rows } }));

/** GET /rate-limit answers that this internet address has no free run left. */
const routeNoRunLeft = (page: Page): Promise<void> =>
  page.route('**/rate-limit', (route: Route) => route.fulfill({ json: { allowed: false, remaining: 0, limit: 1, resetAt: RESET_AT } }));

/** The replay address the page builds for a saved run: this address with the run's id, on the Watch tab. */
const replayAddress = (page: Page, id: string): string => {
  const url = new URL(page.url());
  url.searchParams.set('replay', id);
  url.searchParams.set('tab', 'sim');
  return url.toString();
};

/** How many links and keys of the first screen are filled in the primary key's rust. */
async function filledKeys(page: Page, root: Locator): Promise<number> {
  const rust = await tokenColour(page, '--rust');
  return root.locator('a, button').evaluateAll((els, fill) => els.filter((el) => getComputedStyle(el).backgroundColor === fill).length, rust);
}

/** The clock face beside the reset sentence: hidden from a screen reader, its hands set to the reset time in the browser's own zone. */
async function expectClockAt(page: Page, root: Locator, resetAt: number): Promise<void> {
  const clock = root.getByTestId('reset-clock');
  await expect(clock).toBeVisible();
  await expect(clock).toHaveAttribute('aria-hidden', 'true');
  const want = await page.evaluate((ms) => {
    const parts: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms))) parts[p.type] = p.value;
    return { hour: Number(parts.hour), minute: Number(parts.minute) };
  }, resetAt);
  await expect(clock).toHaveAttribute('data-time', `${String(want.hour).padStart(2, '0')}:${String(want.minute).padStart(2, '0')}`);
  const angle = (hand: string): Promise<number> => clock.locator(`[data-hand="${hand}"]`).evaluate((el) => Number(/rotate\(\s*([-\d.]+)/.exec(el.getAttribute('transform') ?? '')?.[1]));
  expect(await angle('hour')).toBeCloseTo((want.hour % 12) * 30 + want.minute / 2, 3);
  expect(await angle('minute')).toBeCloseTo(want.minute * 6, 3);
}

screenTest('feature 10: no free run left', async ({ page, browser }, info) => {
  test.setTimeout(360_000);
  try {
    await test.step('a press takes the day’s one run', async () => {
      const root = await openReadyAt(page, '/sim', PHONE, 'dark');
      const { key } = startParts(root);
      await expect(key).toHaveAccessibleName(START_FREE);
      await key.click();
      await page.waitForURL((url) => url.searchParams.get('tab') === 'sim');
      // The stub run holds a run slot until its visitor clears it; the day's count stays spent.
      await page.request.post(`${SERVER}/clear`);
      expect((await dayCount(page)).remaining).toBe(0);
    });

    for (const size of [PHONE, WIDE]) {
      for (const look of LOOKS) {
        await test.step(`${size.width} in the ${look} look`, async () => {
          const root = await openReadyAt(page, '/sim', size, look);
          const count = await dayCount(page);
          expect(count.remaining).toBe(0);
          const time = await clockTime(page, count.resetAt);
          const { bar, barLines } = startParts(root);
          await expect(root.getByTestId('start-band')).toHaveAttribute('data-state', 'limit');
          // Feature 3, QA step 15: the paragraph without the sentence that names Start.
          await expect(root.getByTestId('scenario-sentences')).toHaveText(AT_LIMIT_SENTENCES);
          // Feature 10, QA step 25: no saved run and no team's run, so no key stands in Start's place and no filled key asks for a key.
          await expect(root.getByTestId('start-key')).toHaveCount(0);
          await expect(root.getByTestId('replay-key')).toHaveCount(0);
          expect(await filledKeys(page, root)).toBe(0);
          const addKey = root.getByTestId('start-band').getByRole('link', { name: ADD_KEY_LINK, exact: true });
          await expect(addKey).toBeVisible();
          expect(new URL((await addKey.getAttribute('href')) ?? '', page.url()).searchParams.get('tab')).toBe('settings');
          expect((await box(addKey)).height).toBeGreaterThanOrEqual(44);
          if (size.width < 600) {
            // Feature 10, QA step 29: before any scroll the bar holds the reset sentence over the link.
            await expect(bar).toHaveAttribute('data-stuck', 'true');
            await expect(barLines).toHaveText(atLimitReset(time));
            expect((await box(barLines)).y + (await box(barLines)).height).toBeLessThanOrEqual((await box(addKey)).y + 1);
            await picture(page, `at-limit-bar-${size.width}-${look}`);
          }

          // Feature 10, QA step 4: the two paragraphs, the first beside a clock face set to the reset time.
          await scrollToBandPlace(root);
          const reset = root.getByTestId('at-limit-reset');
          const after = root.getByTestId('at-limit-after');
          await expect(reset).toHaveText(atLimitReset(time));
          await expect(reset).toHaveAttribute('role', 'status');
          await expect(after).toHaveText(ADD_KEY_PARAGRAPH);
          await expectClockAt(page, root, count.resetAt);
          // The clock sits beside the first paragraph alone; the second spans the column under them.
          const [clock, said, rest] = await Promise.all([box(root.getByTestId('reset-clock')), box(reset), box(after)]);
          expect(said.x).toBeGreaterThanOrEqual(clock.x + clock.width - 1);
          expect(rest.y).toBeGreaterThanOrEqual(Math.max(clock.y + clock.height, said.y + said.height) - 1);
          expect(rest.x).toBeLessThanOrEqual(clock.x + 1);
          expect(await styleOf(reset)).toMatchObject({ size: 18, colour: await tokenColour(page, '--text-1') });
          await expectNoSidewaysScroll(page, root);
          expect(await measureReadability(page)).toEqual([]);
          // Feature 3, QA step 17: the automated check at the no-run-left state.
          expect(await axeFindings(page)).toEqual([]);
          await picture(page, `at-limit-${size.width}-${look}`);

          // Feature 5, QA step 27: the leaders read as with a free run left.
          const leaders = root.getByTestId('leaders');
          if (size.width < 1100) {
            await leaders.getByRole('tab', { name: SHOW_DIETRICH, exact: true }).click();
            await expect(leaders.getByRole('tabpanel').getByTestId('leader-head')).toHaveText(DIETRICH.title);
            await expect(leaders.getByRole('tabpanel').getByTestId('leader-orders')).toBeVisible();
          } else {
            await expect(leaders.getByRole('article')).toHaveCount(2);
            await expect(leaders.getByTestId('leader-orders')).toHaveCount(2);
            for (const orders of await leaders.getByTestId('leader-orders').all()) await expect(orders).toBeVisible();
          }
        });
      }
    }

    await test.step('with a key saved, Start and all three sentences return', async () => {
      await saveKey(page);
      const root = await openReadyAt(page, '/sim', PHONE, 'dark');
      await expect(startParts(root).key).toHaveAccessibleName(START_OWN_KEY);
      await expect(root.getByTestId('scenario-sentences')).toHaveText(PAIR_SENTENCES);
      await expect(root.getByTestId('at-limit-reset')).toHaveCount(0);
    });
  } finally {
    await page.request.post(`${SERVER}/clear`).catch(() => undefined);
  }

  // Feature 10, QA step 28: the reset time in the browser's own zone and format, and the clock face's hands with it.
  for (const [i, [zone, locale, shown, zoneName]] of ([
    ['America/Los_Angeles', 'en-US', '16:00', 'PST'],
    ['Europe/Berlin', 'en-GB', '01:00', 'CET'],
  ] as const).entries()) {
    await test.step(`the reset time in ${zone}`, async () => {
      const zoned = await browser.newContext({
        baseURL: SERVER,
        deviceScaleFactor: 2,
        timezoneId: zone,
        locale,
        extraHTTPHeaders: { 'x-real-ip': `192.0.2.${1 + i + info.retry * 2}` },
      });
      try {
        const zp = await zoned.newPage();
        await routeNoRunLeft(zp);
        const root = await openReadyAt(zp, '/sim', PHONE, 'dark');
        const time = await clockTime(zp, RESET_AT);
        expect(time).toContain(zoneName);
        await scrollToBandPlace(root);
        await expect(root.getByTestId('at-limit-reset')).toHaveText(atLimitReset(time));
        await expect(root.getByTestId('reset-clock')).toHaveAttribute('data-time', shown);
        await expectClockAt(zp, root, RESET_AT);
        await picture(zp, `at-limit-${zoneName}-390-dark`);
      } finally {
        await zoned.close();
      }
    });
  }
});

screenTest('feature 10: at the limit with a saved run, with a team run, with neither', async ({ page }) => {
  test.setTimeout(300_000);
  // No press here starts a run or writes a leader: a replay calls no model.
  const posted: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && (path === '/setup' || path.startsWith('/api/quickstart/'))) posted.push(path);
  });
  const own = savedRun('run-own-1');
  const team = savedRun('run-team-1', { pinned: true, createdAt: Date.UTC(2026, 10, 20, 9) });
  await routeNoRunLeft(page);

  // Feature 10, QA step 4: the visitor's own run comes first, before the team's.
  await routeSessions(page, [own, team]);
  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`a saved run, ${size.width} in the ${look} look`, async () => {
        const root = await openReadyAt(page, '/sim', size, look);
        await scrollToBandPlace(root);
        const replay = root.getByTestId('replay-key');
        await expect(replay).toHaveText(WATCH_LAST);
        await expect(replay).toHaveAccessibleName(WATCH_LAST);
        expect(await replay.evaluate((el) => el.tagName)).toBe('A');
        expect(await replay.getAttribute('href')).toBe(replayAddress(page, own.id));
        // The filled key in Start's place, at Start's size.
        expect(await replay.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await tokenColour(page, '--rust'));
        expect((await box(replay)).height).toBeGreaterThanOrEqual(size.width < 600 ? 64 : 56);
        await expect(root.getByTestId('start-key')).toHaveCount(0);
        await expect(root.getByTestId('at-limit-reset')).toHaveText(atLimitReset(await clockTime(page, RESET_AT)));
        await expect(root.getByTestId('at-limit-after')).toHaveText(`${REPLAY_FREE} ${ADD_KEY_PARAGRAPH}`);
        // The link to Settings under the key.
        const addKey = root.getByTestId('start-band').getByRole('link', { name: ADD_KEY_LINK, exact: true });
        const [k, link] = await Promise.all([box(replay), box(addKey)]);
        expect(link.y).toBeGreaterThanOrEqual(k.y + k.height - 1);
        expect(link.height).toBeGreaterThanOrEqual(44);
        expect(await measureReadability(page)).toEqual([]);
        expect(await axeFindings(page)).toEqual([]);
        await picture(page, `at-limit-saved-run-${size.width}-${look}`);
      });
    }
  }

  await test.step('press it: the saved run replays, with no model call', async () => {
    const root = await openReadyAt(page, '/sim', PHONE, 'dark');
    await scrollToBandPlace(root);
    await root.getByTestId('replay-key').click();
    await page.waitForURL((url) => url.searchParams.get('replay') === own.id && url.searchParams.get('tab') === 'sim');
    expect(posted).toEqual([]);
  });

  // Feature 10, QA step 5: with no run of its own, this browser is offered the team's run of a pair.
  await page.unroute('**/sessions');
  await routeSessions(page, [team]);
  for (const look of LOOKS) {
    await test.step(`the team's run, 390 in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim', PHONE, look);
      await scrollToBandPlace(root);
      const replay = root.getByTestId('replay-key');
      await expect(replay).toHaveAccessibleName(WATCH_TEAM_SPOKEN);
      await expect(replay.getByTestId('replay-first')).toHaveText(WATCH_TEAM);
      await expect(replay.getByTestId('replay-second')).toHaveText('Mars Genesis, 6 turns');
      expect(await replay.getAttribute('href')).toBe(replayAddress(page, team.id));
      expect(await replay.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await tokenColour(page, '--rust'));
      await expect(root.getByTestId('at-limit-after')).toHaveText(`${REPLAY_FREE} ${ADD_KEY_PARAGRAPH}`);
      expect(await measureReadability(page)).toEqual([]);
      expect(await axeFindings(page)).toEqual([]);
      await picture(page, `at-limit-team-run-390-${look}`);
    });
  }

  await test.step('press the team’s run: it replays, with no model call', async () => {
    const root = await openReadyAt(page, '/sim', PHONE, 'light');
    await scrollToBandPlace(root);
    await root.getByTestId('replay-key').click();
    await page.waitForURL((url) => url.searchParams.get('replay') === team.id && url.searchParams.get('tab') === 'sim');
    expect(posted).toEqual([]);
  });

  // Feature 10, QA steps 25 and 40: neither, so the link to Settings alone and no replay sentence.
  await page.unroute('**/sessions');
  await routeSessions(page, []);
  for (const look of LOOKS) {
    await test.step(`neither, 390 in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim', PHONE, look);
      await scrollToBandPlace(root);
      await expect(root.getByTestId('replay-key')).toHaveCount(0);
      expect(await filledKeys(page, root)).toBe(0);
      await expect(root.getByTestId('start-band').getByRole('link', { name: ADD_KEY_LINK, exact: true })).toBeVisible();
      await expect(root.getByTestId('at-limit-after')).toHaveText(ADD_KEY_PARAGRAPH);
    });
  }

  // Feature 10, QA step 7: with a free run left, a saved run's link beside Start.
  await page.unroute('**/rate-limit');
  await page.unroute('**/sessions');
  await routeSessions(page, [own]);
  await test.step('a free run left and a saved run: the link beside Start replays it', async () => {
    const root = await openReadyAt(page, '/sim', PHONE, 'dark');
    const { key } = startParts(root);
    await expect(key).toHaveAccessibleName(START_FREE);
    await expect(key).toBeEnabled();
    await scrollToBandPlace(root);
    const last = root.getByRole('link', { name: WATCH_LAST, exact: true });
    await expect(last).toBeVisible();
    expect(await last.getAttribute('href')).toBe(replayAddress(page, own.id));
    expect((await box(last)).height).toBeGreaterThanOrEqual(44);
    await picture(page, 'start-with-last-run-390-dark');
    await last.click();
    await page.waitForURL((url) => url.searchParams.get('replay') === own.id && url.searchParams.get('tab') === 'sim');
    expect(posted).toEqual([]);
  });
});

screenTest('feature 10: a limit met between the read and the press', async ({ page }) => {
  test.setTimeout(300_000);
  try {
    await test.step('a first press spends the day’s one run', async () => {
      const root = await openReadyAt(page, '/sim', PHONE, 'dark');
      await startParts(root).key.click();
      await page.waitForURL((url) => url.searchParams.get('tab') === 'sim');
      await page.request.post(`${SERVER}/clear`);
    });

    // The page's reads before the press still say one run is left, while the server's own count is spent.
    for (const afterRefusal of ['let through', 'aborted', 'every read blocked'] as const) {
      await test.step(`the read after the refusal ${afterRefusal}`, async () => {
        let setupSent = false;
        const onRequest = (request: { method(): string; url(): string }) => {
          if (request.method() === 'POST' && new URL(request.url()).pathname === '/setup') setupSent = true;
        };
        page.on('request', onRequest);
        await page.route('**/rate-limit', async (route: Route) => {
          if (afterRefusal === 'every read blocked') return route.abort();
          if (!setupSent) return route.fulfill({ json: { allowed: true, remaining: 1, limit: 1, resetAt: RESET_AT } });
          return afterRefusal === 'aborted' ? route.abort() : route.continue();
        });
        try {
          const root = await openReadyAt(page, '/sim', PHONE, 'dark');
          const { key, notice } = startParts(root);
          await expect(key).toHaveAccessibleName(START_FREE);
          await expect(key).toBeEnabled();
          if (afterRefusal === 'every read blocked') {
            // Feature 10, QA step 9: a count that cannot be read leaves Start active, and the server checks the limit.
            await expect(notice.getByTestId('notice-count')).toHaveText(COUNT_UNAVAILABLE);
          }
          const refusal = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/setup');
          await key.click();
          expect((await refusal).status()).toBe(429);
          await expect(root.getByTestId('start-band')).toHaveAttribute('data-state', 'limit');
          await scrollToBandPlace(root);
          const reset = root.getByTestId('at-limit-reset');
          if (afterRefusal === 'let through') {
            const count = await dayCount(page);
            await expect(reset).toHaveText(atLimitReset(await clockTime(page, count.resetAt)));
            await expectClockAt(page, root, count.resetAt);
          } else {
            await expect(reset).toHaveText(NO_RUN_LEFT);
            await expect(root.getByTestId('reset-clock')).toHaveCount(0);
          }
          await expect(root.getByTestId('at-limit-after')).toHaveText(ADD_KEY_PARAGRAPH);
          await expect(root.getByTestId('scenario-sentences')).toHaveText(AT_LIMIT_SENTENCES);
          // The refusal is said in the page's own words: no raw server text and no failure sentence.
          await expect(page.locator('body')).not.toContainText('Rate limit exceeded');
          await expect(page.locator('body')).not.toContainText('simulations per day');
          await expect(root.getByTestId('start-failure')).toHaveCount(0);
          await picture(page, `at-limit-after-refusal-${afterRefusal.replace(/ /g, '-')}-390-dark`);
        } finally {
          page.off('request', onRequest);
          await page.unroute('**/rate-limit');
        }
      });
    }
  } finally {
    await page.request.post(`${SERVER}/clear`).catch(() => undefined);
  }
});

screenTest('feature 10: failure sentences', async ({ page }) => {
  test.setTimeout(240_000);
  const answers: Array<{ name: string; answer: (route: Route) => Promise<void>; words: string; mark: string }> = [
    { name: 'no-connection', answer: (route) => route.abort(), words: COULD_NOT_REACH, mark: 'broken-link' },
    { name: 'busy', answer: (route) => route.fulfill({ status: 503, json: { error: 'x' } }), words: SERVER_BUSY, mark: 'warning' },
    { name: 'run-slots', answer: (route) => route.fulfill({ status: 503, json: { error: 'x', runsInFlight: 3, maxRuns: 3 } }), words: SLOTS_IN_USE, mark: 'warning' },
    { name: 'other', answer: (route) => route.fulfill({ status: 500, json: { error: 'x' } }), words: DID_NOT_START, mark: 'warning' },
  ];
  for (const look of LOOKS) {
    await test.step(`390 in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim', PHONE, look);
      const { key } = startParts(root);
      for (const a of answers) {
        await page.route('**/setup', a.answer);
        try {
          await expect(key).toHaveAccessibleName(START_FREE);
          await key.click();
          // Feature 10, QA step 11: one sentence above the key, beside its drawn mark.
          const said = root.getByTestId('start-failure');
          await expect(said).toHaveText(a.words);
          await expect(said.locator(`[data-mark="${a.mark}"]`)).toBeVisible();
          await expect(page.locator('body')).not.toContainText('"error"');
          // The key is back at rest, so the next press works.
          await expect(key).toBeEnabled();
          await expect(key).toHaveAccessibleName(START_FREE);
          const [s, k] = await Promise.all([box(said), box(key)]);
          expect(s.y + s.height).toBeLessThanOrEqual(k.y + 1);
          expect(await styleOf(said)).toMatchObject({ size: 18, colour: await tokenColour(page, '--text-1') });
          expect(await measureReadability(page)).toEqual([]);
          await picture(page, `start-failure-${a.name}-390-${look}`);
        } finally {
          await page.unroute('**/setup');
        }
      }
    });
  }
});

screenTest('feature 10: count unavailable and saved runs did not load', async ({ page }) => {
  test.setTimeout(300_000);
  await test.step('a count that cannot be read leaves Start active', async () => {
    await page.route('**/rate-limit', (route: Route) => route.abort());
    const root = await openReadyAt(page, '/sim', PHONE, 'dark');
    const { key, notice } = startParts(root);
    await expect(key).toHaveAccessibleName(START_FREE);
    await expect(key).toBeEnabled();
    await scrollToBandPlace(root);
    await expect(notice.getByTestId('notice-count')).toHaveText(COUNT_UNAVAILABLE);
    await page.unroute('**/rate-limit');
  });

  await test.step('an empty list and a free run left: no replay clause', async () => {
    await routeSessions(page, []);
    const root = await openReadyAt(page, '/sim', PHONE, 'light');
    await scrollToBandPlace(root);
    await expect(startParts(root).notice.getByTestId('notice-after')).toHaveText(AFTER_NO_SAVED_RUN);
    await page.unroute('**/sessions');
  });

  // Feature 10, QA step 39: at the limit, a saved-run list that did not load, then a press of Try again.
  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`saved runs that did not load, ${size.width} in the ${look} look`, async () => {
        await routeNoRunLeft(page);
        let failing = true;
        const held = gate();
        await page.route('**/sessions', async (route: Route) => {
          if (failing) return route.abort();
          await held.opened;
          return route.fulfill({ json: { sessions: [savedRun('run-own-1')] } });
        });
        try {
          const root = await openReadyAt(page, '/sim', size, look);
          await scrollToBandPlace(root);
          const failed = root.getByTestId('sessions-failed');
          await expect(failed).toContainText(SAVED_RUNS_FAILED);
          await expect(failed.locator('[data-mark="broken-link"]')).toBeVisible();
          const retry = failed.getByRole('button');
          await expect(retry).toHaveText('Try again');
          const r = await box(retry);
          expect(r.height).toBeGreaterThanOrEqual(44);
          expect(r.width).toBeGreaterThanOrEqual(96);
          await expect(root.getByTestId('replay-key')).toHaveCount(0);
          // Above the link to Settings, and the second paragraph without the replay sentence.
          const addKey = root.getByTestId('start-band').getByRole('link', { name: ADD_KEY_LINK, exact: true });
          expect((await box(addKey)).y).toBeGreaterThanOrEqual(r.y + r.height - 1);
          await expect(root.getByTestId('at-limit-after')).toHaveText(ADD_KEY_PARAGRAPH);
          expect(await measureReadability(page)).toEqual([]);
          await picture(page, `at-limit-saved-runs-failed-${size.width}-${look}`);

          failing = false;
          await retry.click();
          await expect(retry).toHaveText('Trying…');
          await expect(retry).toBeDisabled();
          held.open();
          await expect(root.getByTestId('replay-key')).toHaveText(WATCH_LAST);
          await expect(failed).toHaveCount(0);
        } finally {
          held.open();
          await page.unroute('**/sessions');
          await page.unroute('**/rate-limit');
        }
      });
    }
  }
});

/* The grid on the Sim tab once the run starts, one Start, and no tour. */

/** The server of stored runs of 3, 24 and 300 leaders (tests-e2e/support/cohort-replay-server.ts). */
const REPLAYS = 'http://127.0.0.1:3471';
/** Where the first screen's server answers what each run's snapshots held. */
const ROSTERS = 'http://127.0.0.1:3472';

/** The Sim tab's grid panels of a pair, the first leader's first. */
const watchPanels = (page: Page): Locator => page.getByTestId('watch-grid-panel');
/** The Sim tab's track of one panel a leader, from 3 leaders. */
const watchTrack = (page: Page): Locator => page.getByTestId('watch-grid-track');

/**
 * A canvas's drawing: how many of its sampled pixels hold any, and how many
 * of those stand near each of two colours, given as the page computes them.
 */
const drawingOf = (canvas: Locator, first: string, second: string): Promise<{ drawn: number; first: number; second: number }> =>
  canvas.evaluate((el, colours) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext('2d');
    const out = { drawn: 0, first: 0, second: 0 };
    if (!ctx || c.width === 0 || c.height === 0) return out;
    const [a, b] = colours.map((colour) => (colour.match(/\d+/g) ?? []).slice(0, 3).map(Number));
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const near = (i: number, to: number[]) => Math.abs(px[i] - to[0]) <= 24 && Math.abs(px[i + 1] - to[1]) <= 24 && Math.abs(px[i + 2] - to[2]) <= 24;
    for (let i = 0; i < px.length; i += 4 * 7) {
      // A pixel drawn faintly holds too little of its colour to tell.
      if (px[i + 3] < 24) continue;
      out.drawn += 1;
      if (near(i, a)) out.first += 1;
      if (near(i, b)) out.second += 1;
    }
    return out;
  }, [first, second]);

/** What one run's snapshots held, as the first screen's server answers it. */
interface RosterRecord { population: number; leaders: Record<string, string[]> }

/** Presses Start on the ready first screen and waits for the page to open the run on the Sim tab. */
async function startAndWatch(page: Page, root: Locator): Promise<void> {
  const { key } = startParts(root);
  await expect(key).toHaveAccessibleName(START_FREE);
  await key.click();
  await page.waitForURL((url) => url.searchParams.get('tab') === 'sim');
}

screenTest('feature 14: Watch shows the pair on the first frame', async ({ page, context }, info) => {
  test.setTimeout(240_000);
  const featured = keyPeopleOf(await serverScenario(page)).filter((p) => p.featured).map((p) => p.name);
  expect(featured.length).toBeGreaterThan(0);
  try {
    for (const [index, size] of [WIDE, PHONE].entries()) {
      await test.step(`${size.width} in the dark look`, async () => {
        if (index > 0) {
          // A second run needs a visitor of its own: the day holds one run for an internet address.
          await page.request.post(`${SERVER}/clear`);
          await secondAddress(context, info, index);
        }
        const root = await openReadyAt(page, '/sim', size, 'dark');
        // The people the shared panel names before the press.
        await expect
          .poll(async () => (await nameBoxes(root.getByTestId('shared-colony'))).map((n) => n.name), { message: 'the shared panel names the featured key people' })
          .toEqual(featured);
        await startAndWatch(page, root);
        // The pointer rests away from the panels, so no person is hovered.
        await page.mouse.move(0, 0);

        // Feature 14, QA step 3: two panels, the first leader's in the amber and the second's in teal.
        const panels = watchPanels(page);
        await expect(panels).toHaveCount(2);
        const vis = await tokenColour(page, '--vis');
        const eng = await tokenColour(page, '--eng');
        for (const [place, panel] of [panels.nth(0), panels.nth(1)].entries()) {
          const canvas = panel.locator('canvas');
          await expect(canvas).toHaveCount(1);
          await panel.scrollIntoViewIfNeeded();
          // The field keeps a height its cells can be read at, under the figures strip, at every width.
          expect((await box(panel.locator('[data-testid^="living-colony-field-"]'))).height, `panel ${place + 1}'s field`).toBeGreaterThanOrEqual(189);
          await expect.poll(() => canvas.evaluate(countTiles), { message: `panel ${place + 1} draws its Game of Life cells`, timeout: 30_000 }).toBeGreaterThan(0);
          // The cells ease in, so the colours are read until they show: how far the panel's own colour leads the other's.
          await expect
            .poll(async () => {
              const drawing = await drawingOf(canvas, vis, eng);
              return place === 0 ? drawing.first - drawing.second : drawing.second - drawing.first;
            }, { message: place === 0 ? 'the first leader\'s panel draws in the amber' : 'the second leader\'s panel draws in teal', timeout: 15_000 })
            .toBeGreaterThan(0);
          // Each panel names its leader.
          await expect(panel.getByRole('img', { name: new RegExp(`^${PAIR[place].name} `) })).toHaveCount(1);
        }
        const [first, second] = await Promise.all([box(panels.nth(0)), box(panels.nth(1))]);
        if (size.width >= 768) {
          expect(Math.abs(first.y - second.y), 'the two panels stand side by side').toBeLessThanOrEqual(1);
          expect(first.x + first.width).toBeLessThanOrEqual(second.x + 1);
        } else {
          expect(second.y, 'the two panels stack').toBeGreaterThanOrEqual(first.y + first.height - 1);
          expect(Math.abs(first.x - second.x)).toBeLessThanOrEqual(1);
        }
        for (const b of [first, second]) {
          expect(b.x).toBeGreaterThanOrEqual(-1);
          expect(b.x + b.width).toBeLessThanOrEqual(size.width + 1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'the page has no sideways scroll').toBe(true);
        await panels.nth(0).scrollIntoViewIfNeeded();
        await picture(page, `watch-pair-${size.width}-dark`);
      });
    }

    // Feature 14, QA step 12 with the key people as the starting data: every
    // name the shared panel showed is in both leaders' rosters at turn 1.
    const answer = await page.request.get(`${ROSTERS}/roster`);
    expect(answer.ok(), 'the roster port answers').toBe(true);
    const records = (await answer.json() as RosterRecord[])
      .filter((r) => r.population === 30 && PAIR.every((leader) => Array.isArray(r.leaders[leader.name])));
    expect(records.length, 'a run of the pair at 30 people sent its rosters').toBeGreaterThan(0);
    for (const record of records) {
      for (const leader of PAIR) {
        expect(record.leaders[leader.name].length, `${leader.name}'s colony holds its 30 people`).toBeGreaterThanOrEqual(30);
        for (const name of featured) expect(record.leaders[leader.name], `${leader.name}'s colony holds ${name}`).toContain(name);
      }
    }
  } finally {
    // The stub run holds a run slot until its visitor clears it.
    await page.request.post(`${SERVER}/clear`).catch(() => undefined);
  }
});

screenTest('feature 14: Watch from 3, at 24 and at 300', async ({ page }) => {
  test.setTimeout(600_000);
  const listed = await page.request.get(`${REPLAYS}/sessions`);
  expect(listed.ok(), 'the server of stored runs lists them').toBe(true);
  const { sessions } = await listed.json() as { sessions: Array<{ id: string; scenarioName?: string }> };
  for (const leaders of [3, 24, 300]) {
    const run = sessions.find((row) => row.scenarioName === `Mars Genesis · ${leaders} leaders`);
    expect(run, `a stored run of ${leaders} leaders`).toBeDefined();
    for (const size of [WIDE, PHONE]) {
      await test.step(`${leaders} leaders at ${size.width} in the dark look`, async () => {
        await page.setViewportSize(size);
        await useLook(page, 'dark');
        await page.goto(`${REPLAYS}/sim?replay=${encodeURIComponent(run!.id)}&tab=sim`);
        // The page is busy while a run of 300 plays in, so each check waits longer.
        const track = watchTrack(page);
        await expect(track).toBeVisible({ timeout: 120_000 });
        // One panel a leader, the first ones drawn.
        await expect(track.locator('[aria-label^="Living swarm grid for actor "]')).toHaveCount(leaders, { timeout: 120_000 });
        await expect(track.getByText('Aria Chen', { exact: true }).first()).toBeVisible();
        const canvas = track.locator('canvas').first();
        await track.scrollIntoViewIfNeeded();
        await expect.poll(() => canvas.evaluate(countTiles), { message: 'the first leader\'s panel draws its Game of Life cells', timeout: 30_000 }).toBeGreaterThan(0);
        // The track keeps to the page's width, and the page does not scroll sideways.
        const place = await box(track);
        expect(place.x).toBeGreaterThanOrEqual(-1);
        expect(place.x + place.width).toBeLessThanOrEqual(size.width + 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'the page has no sideways scroll').toBe(true);
        await picture(page, `watch-${leaders}-${size.width}-dark`);
      });
    }
  }
});

screenTest('feature 14: still frames under reduced motion', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    const root = await openReadyAt(page, '/sim', WIDE, 'light');
    await startAndWatch(page, root);
    // The pointer rests away from the panels, so no person is hovered.
    await page.mouse.move(0, 0);
    const panels = watchPanels(page);
    await expect(panels).toHaveCount(2);
    const canvases = [panels.nth(0).locator('canvas'), panels.nth(1).locator('canvas')];
    for (const canvas of canvases) {
      await expect.poll(() => canvas.evaluate(countTiles), { message: 'the panel draws its Game of Life cells', timeout: 30_000 }).toBeGreaterThan(0);
    }
    // The run is live and its turn stands: each panel is a still frame.
    await page.waitForTimeout(1_000);
    const first = await Promise.all(canvases.map((canvas) => frameOf(canvas)));
    await panels.nth(0).scrollIntoViewIfNeeded();
    await picture(page, 'watch-reduced-motion-1440-light-f1');
    await page.waitForTimeout(2_000);
    expect(await Promise.all(canvases.map((canvas) => frameOf(canvas))), 'two frames two seconds apart are the same frame').toEqual(first);
    await picture(page, 'watch-reduced-motion-1440-light-f2');
  } finally {
    await page.request.post(`${SERVER}/clear`).catch(() => undefined);
  }
});

screenTest('one Start', async ({ page }) => {
  test.setTimeout(180_000);
  /** A control named for starting a run: its name begins Start, Run or Launch. */
  const startsARun = /^\W*(start|run|launch)\b/i;
  for (const size of [PHONE, WIDE]) {
    await test.step(`${size.width} in the dark look`, async () => {
      // The Sim tab with no run: its empty state offers no run and no tour.
      await page.setViewportSize(size);
      await useLook(page, 'dark');
      await page.goto('/sim?tab=sim');
      const sim = page.locator('#tabpanel-sim');
      await expect(sim.getByText('No simulation running', { exact: true })).toBeVisible();
      await expect(sim.getByRole('button', { name: startsARun })).toHaveCount(0);
      await expect(sim.getByText(/guided tour/i)).toHaveCount(0);
      await expect(sim.getByRole('button', { name: 'Load Prior Run', exact: true })).toBeVisible();

      const header = page.getByRole('banner');
      await expect(header.getByRole('button', { name: 'RUN', exact: true })).toHaveCount(0);
      await openTab(page, 'library');
      await expect(page.getByRole('heading', { name: 'Saved runs' })).toBeVisible();
      await openTab(page, 'studio');
      await expect(page.getByRole('button', { name: 'Open a run file' })).toBeVisible();
      // No key of the header opens a tour.
      await expect(header.getByRole('button', { name: /tour/i })).toHaveCount(0);

      // Feature 12, QA step 2: from the header down to the end of the first
      // screen, one control starts a run, and it is Start.
      const root = await openReadyAt(page, '/sim', size, 'dark');
      const { key } = startParts(root);
      await expect(key).toHaveAccessibleName(START_FREE);
      const named = await root.getByRole('button').or(root.getByRole('link')).evaluateAll((els) => els.map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()));
      expect(named.filter((name) => startsARun.test(name))).toHaveLength(1);
      await expect(root.getByRole('button', { name: startsARun })).toHaveCount(1);
      await expect(header.getByRole('button', { name: startsARun })).toHaveCount(0);
      await expect(page.getByText(/guided tour/i).filter({ visible: true })).toHaveCount(0);
    });
  }
});

screenTest('no tour', async ({ page }) => {
  test.setTimeout(180_000);
  // Feature 11, QA steps 4 and 11: a first visit, left alone for 30 seconds:
  // no tour, and no card, opens by itself.
  for (const size of [PHONE, WIDE]) {
    await test.step(`${size.width} in the dark look`, async () => {
      await page.setViewportSize(size);
      await useLook(page, 'dark');
      await page.goto('/sim');
      // Nothing in this browser says a tour was seen.
      expect(await page.evaluate(() => window.localStorage.getItem('paracosm:tourSeen'))).toBeNull();
      const root = page.locator(FIRST_SCREEN);
      await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis' })).toBeVisible();
      const tour = page.locator('[data-tour-overlay], [role="dialog"][aria-label="Guided tour"]');
      const began = Date.now();
      while (Date.now() - began < 30_000) {
        expect(await tour.count(), 'no part of the guided tour is on the page').toBe(0);
        expect(await howCard(page).count(), 'the How it works card does not open by itself').toBe(0);
        await page.waitForTimeout(1_000);
      }
      await expect(tour).toHaveCount(0);
      await expect(howCard(page)).toHaveCount(0);
      await expect(howKey(page)).toHaveAttribute('aria-expanded', 'false');
      // The first screen is still what the page shows.
      await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis' })).toBeVisible();
      expect(new URL(page.url()).searchParams.get('tab') ?? 'quickstart').toBe('quickstart');
    });
  }
});

/* How it works (feature 11): the header's key opens one card, on every tab. */

const HOW_TITLE = 'How it works';
const HOW_CARD = '[data-testid="how-it-works-card"]';
/**
 * The card's six lines. The fourth names the run's turns and the scenario's
 * word for a settlement; with neither, it reads as it does before the
 * scenario has loaded.
 */
const howLines = (o: { turns?: number; settlement?: string } = {}): string[] => [
  'Each leader follows its own orders, shown on its card. “See the full prompt” shows everything it was given.',
  'On each turn an AI leader reads the event and its departments’ reports, picks a bold or a safe option and writes why. Its rule is to take the bold option when that option’s chance reaches the leader’s bar, a number set by its personality. It breaks the rule only for a fact the odds leave out, and names that fact.',
  'RISKY or SAFE says which option it took. WIN or LOSS says whether it paid off.',
  `After ${o.turns === undefined ? 'the last turn' : `turn ${o.turns}`} a verdict names the winner or a tie, says why, and scores each ${o.settlement ?? 'side'} 0 to 10 for survival, prosperity, morale and innovation.`,
  'With two leaders, picking a winner is optional and changes nothing in the run.',
  'With 3 or more leaders, each runs the scenario on its own. The report ranks them in quarters on morale, population and deaths, with no single winner.',
];
/** The three drawings of one sample turn, in the order of their lines (the second, third and fourth): what each says to a screen reader, and the words drawn on it. */
const HOW_DRAWINGS = [
  { alt: 'A sample turn: a bar set at 36 with a chance of 80, which reaches it', words: ['Sample turn', 'Bar 36', 'Chance 80'] },
  { alt: 'The stamp that turn earns: RISKY WIN, the bold option taken, and it paid off', words: ['Sample turn', 'RISKY WIN'] },
  { alt: 'Four sample scores out of 10: survival 7, prosperity 6, morale 8, innovation 5', words: ['Sample turn', 'Survival 7', 'Prosperity 6', 'Morale 8', 'Innovation 5'] },
] as const;
const MARS_LINES = howLines({ turns: 6, settlement: 'colony' });

/** The header's key that opens the card. */
const howKey = (page: Page): Locator => page.getByRole('banner').getByRole('button', { name: HOW_TITLE, exact: true });
const howCard = (page: Page): Locator => page.getByTestId('how-it-works-card');
const howClose = (page: Page): Locator => howCard(page).getByRole('button', { name: 'Close', exact: true });

/**
 * The open card: a dialog named How it works, its six lines word for word as
 * one numbered list, its three drawings, each inside its own line's item and
 * marked Sample turn, and a Close key.
 */
async function expectHowCard(page: Page, lines: string[]): Promise<Locator> {
  const card = howCard(page);
  await expect(card).toBeVisible();
  await expect(card).toHaveRole('dialog');
  await expect(card).toHaveAccessibleName(HOW_TITLE);
  await expect(card.getByRole('heading', { level: 2, name: HOW_TITLE, exact: true })).toBeVisible();
  await expect(card.locator('ol')).toHaveCount(1);
  const items = card.locator('ol > li');
  await expect(items).toHaveCount(6);
  await expect(card.getByTestId('how-line')).toHaveText(lines);
  await expect(card.getByRole('img')).toHaveCount(3);
  for (const [i, drawing] of HOW_DRAWINGS.entries()) {
    const drawn = items.nth(i + 1).getByRole('img');
    await expect(drawn).toHaveCount(1);
    await expect(drawn).toHaveAccessibleName(drawing.alt);
    for (const word of drawing.words) await expect(drawn).toContainText(word);
  }
  await expect(howClose(page)).toBeVisible();
  return card;
}

/** Whether the page's focus is inside a part. */
const holdsFocus = (part: Locator): Promise<boolean> => part.evaluate((el) => el.contains(document.activeElement));

/** Moves focus with Tab until it is on a key, in at most `presses` presses. */
async function tabTo(page: Page, key: Locator, presses: number): Promise<void> {
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press('Tab');
    if (await key.evaluate((el) => el === document.activeElement)) return;
  }
  await expect(key).toBeFocused();
}

screenTest('feature 11: the card', async ({ page }) => {
  test.setTimeout(300_000);

  // Feature 11, QA steps 1 and 12, and feature 1, QA step 4.
  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`the card at ${size.width} in the ${look} look`, async () => {
        await openReadyAt(page, '/sim', size, look);
        const key = howKey(page);
        await expect(key).toBeVisible();
        await expect(key).toHaveAttribute('aria-expanded', 'false');
        await expect(howCard(page)).toHaveCount(0);
        await key.click();
        const card = await expectHowCard(page, MARS_LINES);
        await expect(key).toHaveAttribute('aria-expanded', 'true');

        // The six lines are body text at 18 px, and Close a key a thumb can press.
        for (const line of await card.getByTestId('how-line').all()) expect((await styleOf(line)).size).toBe(18);
        const [cardBox, closeBox] = await Promise.all([box(card), box(howClose(page))]);
        if (size === PHONE) {
          expect(closeBox.height).toBeGreaterThanOrEqual(48);
          expect(closeBox.width, 'Close goes across the sheet').toBeGreaterThanOrEqual(cardBox.width - 48);
        } else {
          expect(closeBox.height).toBeGreaterThanOrEqual(44);
          expect(closeBox.width).toBeGreaterThanOrEqual(96);
        }
        expect(await measureReadability(page, HOW_CARD)).toEqual([]);
        expect(await axeFindings(page, HOW_CARD)).toEqual([]);
        await picture(page, `how-it-works-${size.width}-${look}`);

        // The same press closes it. On a phone the sheet is modal, so the
        // press lands on the page behind it, which closes the sheet.
        if (size === PHONE) {
          const at = await box(key);
          await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
        } else {
          await key.click();
        }
        await expect(howCard(page)).toHaveCount(0);
        await expect(key).toHaveAttribute('aria-expanded', 'false');
      });
    }
  }

  // Feature 11, QA step 2: Close, the key again, Escape; focus is on the key after each close.
  await test.step('Close and Escape return focus to the key, 1440 in the dark look', async () => {
    await openReadyAt(page, '/sim', WIDE, 'dark');
    const key = howKey(page);
    await key.click();
    const card = howCard(page);
    await expect(card).toBeVisible();
    // From a tablet up the panel is not modal: the page behind it stays usable.
    await expect(card).not.toHaveAttribute('aria-modal', 'true');
    // Opening moves focus to the card's title, and Tab reaches Close.
    await expect(card.getByRole('heading', { level: 2, name: HOW_TITLE, exact: true })).toBeFocused();
    await tabTo(page, howClose(page), 2);
    await page.keyboard.press('Enter');
    await expect(card).toHaveCount(0);
    await expect(key).toBeFocused();
    await expect(key).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(card).toBeVisible();
    await expect(key).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(key).toBeFocused();
  });

  // Feature 11, QA step 6: a press outside the panel closes it and reaches the page.
  await test.step('a press outside closes it and reaches the page, 1440 in the light look', async () => {
    await openReadyAt(page, '/sim', WIDE, 'light');
    await howKey(page).click();
    await expect(howCard(page)).toBeVisible();
    await page.getByRole('banner').getByRole('button', { name: 'Switch to dark look', exact: true }).click();
    await expect(howCard(page)).toHaveCount(0);
    // The press reached the key it was made on: the page changed its look.
    await page.waitForFunction(() => !document.documentElement.classList.contains('light'));
    await expect(howKey(page)).toHaveAttribute('aria-expanded', 'false');
  });

  // Feature 11, QA step 7: on a phone the sheet holds focus until it closes.
  await test.step('Tab stays inside the sheet, 390 in the dark look', async () => {
    await openReadyAt(page, '/sim', PHONE, 'dark');
    await howKey(page).click();
    const card = howCard(page);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('aria-modal', 'true');
    await expect(card.getByRole('heading', { level: 2, name: HOW_TITLE, exact: true })).toBeFocused();
    await tabTo(page, howClose(page), 2);
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      expect(await holdsFocus(card), `focus is inside the sheet after Tab ${i + 1} past Close`).toBe(true);
    }
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await holdsFocus(card), `focus is inside the sheet after Shift+Tab ${i + 1}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(howKey(page)).toBeFocused();
  });

  // Feature 11, QA step 15: with the day's free run used, the same card, and no word about limits.
  await routeNoRunLeft(page);
  for (const look of LOOKS) {
    await test.step(`no free run left, 390 in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim', PHONE, look);
      await expect(root.getByTestId('at-limit-reset')).toBeVisible();
      await howKey(page).click();
      const card = await expectHowCard(page, MARS_LINES);
      await expect(card).not.toContainText(/free run|limit|reset/i);
      await page.keyboard.press('Escape');
      await expect(card).toHaveCount(0);
    });
  }
  await page.unroute('**/rate-limit');

  // Feature 11, QA step 16: on the visitor's own key at 24 leaders the card
  // reads the same; the sixth line says nothing of how many run at a time,
  // which no answer of the server gives yet.
  await saveKey(page);
  for (const [size, look] of [[PHONE, 'dark'], [WIDE, 'light']] as const) {
    await test.step(`own key at 24 leaders, ${size.width} in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim?size=24', size, look);
      await expect(sizeParts(root).field).toHaveValue('24');
      await howKey(page).click();
      const card = await expectHowCard(page, MARS_LINES);
      await expect(card).not.toContainText('at a time');
      await picture(page, `how-it-works-own-key-24-${size.width}-${look}`);
    });
  }
});

screenTest('feature 11: from Watch and Reports, offline, Lunar Outpost', async ({ page, context }) => {
  test.setTimeout(240_000);

  // Feature 11, QA step 3: the same card from the Watch tab and the Reports tab.
  for (const tab of ['sim', 'reports']) {
    await test.step(`from ?tab=${tab}, 390 in the dark look`, async () => {
      await page.setViewportSize(PHONE);
      await useLook(page, 'dark');
      await page.goto(`/sim?tab=${tab}`);
      await expect(page.locator(`#tabpanel-${tab}`)).toBeVisible();
      await answerConsent(page);
      const key = howKey(page);
      await key.click();
      await expectHowCard(page, MARS_LINES);
      await picture(page, `how-it-works-from-${tab}-390-dark`);
      await howClose(page).click();
      await expect(howCard(page)).toHaveCount(0);
      await expect(key).toBeFocused();
      // The tab the card was opened from is still the one on screen.
      await expect(page.locator(`#tabpanel-${tab}`)).toBeVisible();
    });
  }

  // Feature 11, QA step 8: the card asks the server for nothing, so it opens whole offline.
  for (const look of LOOKS) {
    await test.step(`offline, 390 in the ${look} look`, async () => {
      await openReadyAt(page, '/sim', PHONE, look);
      await context.setOffline(true);
      try {
        await howKey(page).click();
        await expectHowCard(page, MARS_LINES);
        await picture(page, `how-it-works-offline-390-${look}`);
      } finally {
        await context.setOffline(false);
      }
    });
  }

  // Feature 11, QA step 13: until the scenario has loaded, the fourth line names no turn and no settlement.
  await page.route('**/scenario', (route: Route) => route.abort('failed'));
  for (const look of LOOKS) {
    await test.step(`the scenario did not load, 390 in the ${look} look`, async () => {
      const root = await openRun(page, PHONE, look);
      await expect(root.getByTestId('scenario-line').getByRole('status')).toHaveText(DID_NOT_LOAD);
      await answerConsent(page);
      await howKey(page).click();
      await expectHowCard(page, howLines());
      await picture(page, `how-it-works-no-scenario-390-${look}`);
    });
  }
  await page.unroute('**/scenario');

  // Feature 11, QA step 5: with Lunar Outpost loaded the fourth line names
  // its run's turns and its word for a settlement. A free run is cut to the
  // host's 6 turns; on the visitor's own key the run takes the scenario's 8.
  await switchScenario(page, 'lunar-outpost');
  await test.step('Lunar Outpost on a free run, 1440 in the dark look', async () => {
    await openReadyAt(page, '/sim', WIDE, 'dark', 'Lunar Outpost');
    await howKey(page).click();
    await expectHowCard(page, howLines({ turns: 6, settlement: 'outpost' }));
  });
  await saveKey(page);
  await test.step('Lunar Outpost on the visitor’s own key, 1440 in the dark look', async () => {
    await openReadyAt(page, '/sim', WIDE, 'dark', 'Lunar Outpost');
    await howKey(page).click();
    await expectHowCard(page, howLines({ turns: 8, settlement: 'outpost' }));
    await picture(page, 'how-it-works-lunar-outpost-1440-dark');
  });
});

screenTest('feature 11: layouts', async ({ page }) => {
  test.setTimeout(300_000);
  type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
  /** The open card's parts as the page lays them out. */
  const layoutOf = (card: Locator) => card.evaluate((el) => {
    const boxOf = (part: Element): Box => {
      const b = part.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
    };
    const body = el.querySelector('[data-testid="how-it-works-body"]');
    const close = el.querySelector('[data-testid="how-it-works-close"]');
    if (!body || !close) throw new Error('the card has no body or no Close key');
    return {
      card: boxOf(el),
      lines: Array.from(el.querySelectorAll('[data-testid="how-line"]')).map(boxOf),
      drawings: Array.from(el.querySelectorAll('[role="img"]')).map(boxOf),
      close: boxOf(close),
      /** How far the card's words reach past its own height: above 0, the card scrolls. */
      scrolls: body.scrollHeight - body.clientHeight,
      sideways: Math.max(el.scrollWidth - el.clientWidth, body.scrollWidth - body.clientWidth),
      overscroll: getComputedStyle(body).overscrollBehaviorY,
      view: { width: window.innerWidth, height: window.innerHeight },
      pageSideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  /** Opens the card at one width; the key is pressed in the page, since under 360 px the header row is wider than the window. */
  const openCardAt = async (width: number, look: Look) => {
    await openReadyAt(page, '/sim', sizeAt(width), look);
    await pressInPage(howKey(page));
    const card = await expectHowCard(page, MARS_LINES);
    // The card has come to rest: its fade and rise are over.
    await card.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))));
    return card;
  };

  for (const look of LOOKS) {
    // Feature 11, QA step 9, on a phone: a sheet from the bottom edge, each drawing under its line.
    await test.step(`a sheet at 320 in the ${look} look`, async () => {
      const card = await openCardAt(320, look);
      await expect(card).toHaveAttribute('aria-modal', 'true');
      const at = await layoutOf(card);
      expect(Math.abs(at.card.left), 'the sheet starts at the window’s left edge').toBeLessThanOrEqual(1);
      expect(Math.abs(at.card.width - at.view.width), 'the sheet is the window’s width').toBeLessThanOrEqual(1);
      expect(Math.abs(at.card.bottom - at.view.height), 'the sheet stands on the window’s bottom edge').toBeLessThanOrEqual(1);
      expect(at.card.height, 'the sheet is at most four fifths of the window’s height').toBeLessThanOrEqual(at.view.height * 0.8 + 1);
      at.drawings.forEach((drawing, i) => {
        expect(drawing.top, `drawing ${i + 1} stands under its line`).toBeGreaterThanOrEqual(at.lines[i + 1].bottom - 1);
        expect(drawing.width, `drawing ${i + 1} is the sheet’s width`).toBeGreaterThanOrEqual(at.card.width - 48);
      });
      expect(at.close.height).toBeGreaterThanOrEqual(48);
      expect(at.sideways, 'the sheet does not scroll sideways').toBeLessThanOrEqual(1);
      expect(at.pageSideways, 'the page does not scroll sideways').toBeLessThanOrEqual(1);
      // The sheet's own scroll never moves the page behind it.
      expect(at.overscroll).toBe('contain');
      await picture(page, `how-it-works-320-${look}`);
    });

    // From a tablet up: a panel under the key at the right edge, each of lines 2, 3 and 4 beside its drawing.
    for (const [width, panel, column] of [[600, 480, 140], [1100, 760, 240]] as const) {
      await test.step(`a ${panel} px panel at ${width} in the ${look} look`, async () => {
        const card = await openCardAt(width, look);
        await expect(card).not.toHaveAttribute('aria-modal', 'true');
        const at = await layoutOf(card);
        const key = await box(howKey(page));
        expect(Math.abs(at.card.width - panel), `the panel is ${panel} px wide`).toBeLessThanOrEqual(1);
        expect(at.card.top, 'the panel stands under the key').toBeGreaterThanOrEqual(key.y + key.height - 1);
        expect(at.card.right, 'the panel is inside the window').toBeLessThanOrEqual(at.view.width);
        expect(at.card.right, 'the panel stands at the right edge').toBeGreaterThanOrEqual(at.view.width - 32);
        at.drawings.forEach((drawing, i) => {
          const line = at.lines[i + 1];
          expect(Math.abs(drawing.width - column), `drawing ${i + 1} has a ${column} px column`).toBeLessThanOrEqual(1);
          expect(drawing.left, `drawing ${i + 1} stands at its line’s right`).toBeGreaterThanOrEqual(line.right - 1);
          expect(drawing.top, `drawing ${i + 1} starts beside its line`).toBeLessThan(line.bottom);
          expect(drawing.bottom, `drawing ${i + 1} ends beside its line`).toBeGreaterThan(line.top);
        });
        expect(at.close.height).toBeGreaterThanOrEqual(44);
        expect(at.close.width).toBeGreaterThanOrEqual(96);
        expect(at.sideways).toBeLessThanOrEqual(1);
        await picture(page, `how-it-works-${width}-${look}`);
      });
    }

    // At the wide width: three drawings in one band over the six lines in two columns of three, the whole card in view.
    await test.step(`a 960 px panel at 1440 in the ${look} look`, async () => {
      const card = await openCardAt(1440, look);
      const at = await layoutOf(card);
      const key = await box(howKey(page));
      expect(Math.abs(at.card.width - 960), 'the panel is 960 px wide').toBeLessThanOrEqual(1);
      expect(at.card.top, 'the panel stands under the key').toBeGreaterThanOrEqual(key.y + key.height - 1);
      expect(at.card.right).toBeLessThanOrEqual(at.view.width);
      const [bar, stamp, scores] = at.drawings;
      expect(Math.abs(bar.top - stamp.top), 'the bar and the stamp share a band').toBeLessThanOrEqual(1);
      expect(Math.abs(stamp.top - scores.top), 'the stamp and the scores share a band').toBeLessThanOrEqual(1);
      expect(stamp.left, 'the stamp stands after the bar').toBeGreaterThanOrEqual(bar.right - 1);
      expect(scores.left, 'the scores stand after the stamp').toBeGreaterThanOrEqual(stamp.right - 1);
      const firstLineTop = Math.min(...at.lines.map((line) => line.top));
      for (const drawing of at.drawings) expect(drawing.bottom, 'the band stands over the lines').toBeLessThanOrEqual(firstLineTop + 1);
      const [one, two, three, four, five, six] = at.lines;
      for (const line of [two, three]) expect(Math.abs(line.left - one.left), 'lines 1 to 3 share a column').toBeLessThanOrEqual(1);
      for (const line of [five, six]) expect(Math.abs(line.left - four.left), 'lines 4 to 6 share a column').toBeLessThanOrEqual(1);
      expect(four.left, 'the second column stands at the first one’s right').toBeGreaterThanOrEqual(one.right - 1);
      expect(Math.abs(four.top - one.top), 'the two columns start at one height').toBeLessThanOrEqual(1);
      expect(two.top).toBeGreaterThan(one.top);
      expect(three.top).toBeGreaterThan(two.top);
      expect(at.scrolls, 'the whole card shows without scrolling').toBeLessThanOrEqual(1);
      expect(at.card.bottom, 'the card ends inside the window').toBeLessThanOrEqual(at.view.height);
      expect(at.sideways).toBeLessThanOrEqual(1);
      await picture(page, `how-it-works-1440-${look}-wide`);
    });
  }

  // Feature 11, QA step 10: at 200 per cent text a 320 px window lays the
  // page out in half its width and height. The card scrolls inside its own
  // height and Close stays in view at its foot.
  await test.step('200 per cent text at 320 in the light look', async () => {
    await openReadyAt(page, '/sim', sizeAt(320), 'light');
    await page.setViewportSize({ width: 160, height: 422 });
    await pressInPage(howKey(page));
    const card = await expectHowCard(page, MARS_LINES);
    await card.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))));
    const at = await layoutOf(card);
    expect(at.scrolls, 'the card scrolls inside its own height').toBeGreaterThan(0);
    expect(at.card.height).toBeLessThanOrEqual(at.view.height * 0.8 + 1);
    expect(at.close.top, 'Close is in view').toBeGreaterThanOrEqual(at.card.top);
    expect(at.close.bottom, 'Close is in view at the card’s foot').toBeLessThanOrEqual(at.view.height + 1);
    expect(at.close.height).toBeGreaterThanOrEqual(44);
    expect(at.sideways, 'no word is cut: the card does not scroll sideways').toBeLessThanOrEqual(1);
    await picture(page, 'how-it-works-200-per-cent-320-light');
    await page.keyboard.press('Escape');
    await expect(howCard(page)).toHaveCount(0);
  });

  // The card opens and closes with a 150 ms fade, at once under reduced motion.
  await test.step('motion, and its reduced form, 390 in the dark look', async () => {
    await openReadyAt(page, '/sim', PHONE, 'dark');
    const motionOf = (card: Locator) => card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { name: cs.animationName, seconds: parseFloat(cs.animationDuration) };
    });
    await howKey(page).click();
    const moving = await motionOf(howCard(page));
    expect(moving.name).not.toBe('none');
    expect(moving.seconds).toBeCloseTo(0.15, 3);
    await page.keyboard.press('Escape');
    await expect(howCard(page)).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await howKey(page).click();
    await expect(howCard(page)).toBeVisible();
    expect((await motionOf(howCard(page))).name).toBe('none');
    await page.keyboard.press('Escape');
    await expect(howCard(page)).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
});

/* Other scenarios, Write your own scenario, the notes and the foot (features 12 and 13). */

const MARS = 'mars-genesis';
const LUNAR = 'lunar-outpost';
const LOAD_FAILED = 'The other scenarios did not load.';
const OFFLINE_ROW = 'You are offline. Choose it again when you are back online.';
const NOTE_FICTIONAL = 'Leaders are fictional characters.';
const NOTE_AI = 'The leaders are AI agents. Everything they say is written by a language model and can be wrong.';
const NOTE_ADULTS = 'For adults. Under 18? Use it with a parent’s or guardian’s permission.';
const LICENCE = 'Paracosm · Apache-2.0 · Frame.dev';
const HELD = 'You have a draft scenario below. Run it there, or clear it to play Mars Genesis.';
const FOOT = '[data-testid="page-foot"]';
/** 200 characters and more of a scenario brief, the least the paste form takes. */
const DRAFT = 'A harbour town of four thousand people loses its ferry for a season. Two councils decide how to ration fuel, whom to send for help, and whether to open the old road through the hills before the storms come back.'.padEnd(220, '.');

/** One row of GET /scenarios. */
interface ScenarioRow { id: string; name: string; description?: string; departments?: number; source?: string }

/** Answers GET /scenarios with the server's own answer after `change` has edited its rows. */
async function routeScenarios(page: Page, change: (rows: ScenarioRow[]) => ScenarioRow[]): Promise<void> {
  await page.route('**/scenarios', async (route: Route) => {
    const response = await route.fetch();
    const body = await response.json() as { scenarios: ScenarioRow[] };
    await route.fulfill({ response, json: { ...body, scenarios: change(body.scenarios) } });
  });
}

/**
 * How many scenarios the server lists: the ones it can run. `scenarios/` holds one
 * scenario file more, the Digital Twin's world, which is compiled when its run starts
 * and is never listed. More than the four rows a wide window shows, so Show all stands at
 * every width.
 */
async function listedScenarios(page: Page): Promise<number> {
  const res = await page.request.get(`${SERVER}/scenarios`);
  expect(res.ok(), 'the server lists its scenarios').toBe(true);
  const listed = ((await res.json()) as { scenarios: ScenarioRow[] }).scenarios.length;
  expect(listed).toBeGreaterThan(4);
  return listed;
}

/** The parts of Other scenarios. */
const otherParts = (root: Locator) => {
  const part = root.getByTestId('other-scenarios');
  return {
    part,
    heading: part.getByRole('heading', { level: 2, name: 'Other scenarios', exact: true }),
    rows: part.getByTestId('scenario-row'),
    row: (id: string) => part.locator(`[data-testid="scenario-row"][data-scenario="${id}"]`),
    load: (name: string) => part.getByRole('button', { name: `Load ${name}`, exact: true }),
    showAll: part.getByTestId('show-all'),
  };
};

/** A part's words, the choices inside a menu left out: a sample scenario's own name is no figure of a run's cost. */
const wordsOf = (part: Locator): Promise<string> => part.evaluate((el) => {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('option').forEach((option) => option.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
});

/** How many rows stand across the list: the rows that share the first row's top. */
const rowsAcross = (rows: Locator): Promise<number> => rows.evaluateAll((els) => {
  const tops = els.map((el) => Math.round(el.getBoundingClientRect().top));
  return tops.filter((top) => Math.abs(top - tops[0]) <= 2).length;
});

/** The POST /setup requests the page has sent: a row loads a scenario and never runs one. */
function countSetups(page: Page): () => number {
  let sent = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/setup') sent += 1;
  });
  return () => sent;
}

screenTest('feature 12: the list loads, never runs', async ({ page }) => {
  test.setTimeout(300_000);
  const setups = countSetups(page);
  // Every scenario the server lists has a row; Show all counts the ones a press can load, all but the one on screen.
  const listed = await listedScenarios(page);

  // Feature 12, QA steps 5, 13, 15, 16 and 20: the rows under the heading.
  for (const [size, shown] of [[PHONE, 3], [WIDE, 4]] as const) {
    await test.step(`the rows at ${size.width} in the dark look`, async () => {
      // The list's request is held: three row shapes stand under the heading until it answers.
      const held = gate();
      await page.route('**/scenarios', async (route: Route) => {
        const response = await route.fetch();
        await held.opened;
        await route.fulfill({ response });
      });
      const root = await openReadyAt(page, '/sim', size, 'dark');
      const { part, heading, rows, row, load, showAll } = otherParts(root);
      await expect(heading).toBeVisible();
      await expect(part.locator('[data-shape]')).toHaveCount(3);
      await expect(rows).toHaveCount(0);
      held.open();

      // The rows start with Lunar Outpost, each with its name and its departments as a free run uses them.
      await expect(rows).toHaveCount(shown);
      await expect(part.locator('[data-shape]')).toHaveCount(0);
      // Unrouted once the held answer is on the page: an unroute while its handler waits sends the request on without it.
      await page.unroute('**/scenarios');
      await expect(rows.first()).toHaveAttribute('data-scenario', LUNAR);
      await expect(rows.first().getByTestId('row-name')).toHaveText('Lunar Outpost');
      await expect(rows.first().getByTestId('row-figures')).toHaveText('3 departments');
      await expect(load('Lunar Outpost')).toBeVisible();
      expect((await styleOf(rows.first().getByTestId('row-name'))).size).toBe(18);
      expect((await styleOf(rows.first().getByTestId('row-figures'))).size).toBe(15);
      if (size === PHONE) expect((await box(rows.first())).height).toBeGreaterThanOrEqual(80);
      // No row holds a picture, and no row runs a scenario.
      await expect(part.locator('img, canvas, svg:not([aria-hidden="true"])')).toHaveCount(0);
      await expect(part.getByRole('button', { name: /^\W*(start|run|launch)\b/i })).toHaveCount(0);

      // The scenario above has its row in the list, in its place: it says so and cannot be pressed.
      const onScreen = row(MARS);
      await expect(onScreen.getByTestId('row-state')).toHaveText('On screen now');
      await expect(onScreen.getByRole('button')).toHaveCount(0);
      await expect(onScreen).toContainText('Mars Genesis, on screen now, unavailable');

      // Show all opens the rest in place, counted as the scenarios a press can load, then reads Show fewer.
      await expect(showAll).toHaveText(`Show all ${listed - 1}`);
      const key = await box(showAll);
      expect(key.height).toBeGreaterThanOrEqual(44);
      expect(key.width).toBeGreaterThanOrEqual(120);
      await showAll.click();
      await expect(rows).toHaveCount(listed);
      await expect(showAll).toHaveText('Show fewer');
      await expect(part.getByRole('button', { name: /^Load /, disabled: false })).toHaveCount(listed - 1);
      await picture(page, `other-scenarios-all-${size.width}-dark`);
      await showAll.click();
      await expect(rows).toHaveCount(shown);
      await expect(showAll).toHaveText(`Show all ${listed - 1}`);

      // From the header down to the end of the list: no Actors slider, no search field, no source filter, no sort select.
      const controls = await root.evaluate((el) => {
        const list = el.querySelector('[data-testid="other-scenarios"]');
        return Array.from(el.querySelectorAll('input[type="range"], input[type="search"], select'))
          .filter((control) => list && (list.contains(control) || (control.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)).length;
      });
      expect(controls).toBe(0);
      await expectNoSidewaysScroll(page, root);
      await part.scrollIntoViewIfNeeded();
      await picture(page, `other-scenarios-${size.width}-dark`);
    });
  }

  // Feature 12, QA steps 11 and 20: one, two, three and four across; four shown before Show all at 600 and 1,440 px.
  for (const look of LOOKS) {
    for (const [width, across, shown] of [[320, 1, 3], [600, 2, 4], [1100, 3, 3], [1440, 4, 4]] as const) {
      await test.step(`${across} across at ${width} in the ${look} look`, async () => {
        const root = await openReadyAt(page, '/sim', sizeAt(width), look);
        const { rows, showAll } = otherParts(root);
        await expect(rows).toHaveCount(shown);
        await showAll.click();
        await expect(rows).toHaveCount(listed);
        expect(await rowsAcross(rows)).toBe(across);
        await expectNoSidewaysScroll(page, root);
      });
    }
  }

  // Feature 12, QA steps 3, 4 and 12: a row loads its scenario, by keyboard, and runs nothing.
  await test.step('Enter on the Lunar Outpost row loads it, 1440 in the dark look', async () => {
    const root = await openReadyAt(page, '/sim', WIDE, 'dark');
    const { rows, row, load } = otherParts(root);
    // The switch is held, so the row's loading words stay to be read.
    const held = gate();
    await page.route('**/scenario/switch', async (route: Route) => {
      await held.opened;
      await route.continue();
    });
    await load('Lunar Outpost').focus();
    await page.keyboard.press('Enter');
    await expect(row(LUNAR).getByRole('status')).toHaveText('Loading Lunar Outpost…');
    // While it loads, no other row takes a press.
    await expect(otherParts(root).part.getByRole('button', { name: /^Load /, disabled: false })).toHaveCount(0);
    await picture(page, 'other-scenarios-loading-1440-dark');
    const reloaded = page.waitForEvent('load');
    held.open();
    await reloaded;
    await page.unroute('**/scenario/switch');

    // The page loads again at its top with that scenario: its name, its two leaders and its turns on Start.
    const heading = root.getByRole('heading', { level: 1, name: 'Lunar Outpost', exact: true });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    const leaders = root.getByTestId('leaders');
    await expect(leaders).toContainText('Commander Sarah Lindgren');
    await expect(leaders).toContainText('Commander Raj Patel');
    await expect(startParts(root).key).toHaveAccessibleName('Start Lunar Outpost: 6 turns, about 3 and a half minutes');
    expect(setups(), 'no run has started').toBe(0);

    // Its row now says it is on screen and cannot be pressed, and Mars Genesis can be loaded.
    await expect(rows.first()).toHaveAttribute('data-scenario', LUNAR);
    await expect(row(LUNAR).getByTestId('row-state')).toHaveText('On screen now');
    await expect(row(LUNAR).getByRole('button')).toHaveCount(0);
    await expect(row(LUNAR)).toContainText('Lunar Outpost, on screen now, unavailable');
    await expect(load('Mars Genesis')).toBeEnabled();
    await picture(page, 'other-scenarios-lunar-on-screen-1440-dark');
  });

  // Feature 12, QA step 10: with the day's free run used, a row still loads its scenario, and the limit is said for it.
  await routeNoRunLeft(page);
  for (const look of LOOKS) {
    await test.step(`no free run left, 390 in the ${look} look`, async () => {
      const from = look === 'light' ? 'Lunar Outpost' : 'Mars Genesis';
      const to = look === 'light' ? 'Mars Genesis' : 'Lunar Outpost';
      const root = await openReadyAt(page, '/sim', PHONE, look, from);
      await expect(root.getByTestId('at-limit-reset')).toBeVisible();
      const reloaded = page.waitForEvent('load');
      await otherParts(root).load(to).click();
      await reloaded;
      await expect(root.getByRole('heading', { level: 1, name: to, exact: true })).toBeVisible();
      await expect(root.getByTestId('at-limit-reset')).toBeVisible();
      await expect(root.getByTestId('scenario-sentences')).not.toContainText('Press Start');
    });
  }
  await page.unroute('**/rate-limit');
  expect(setups(), 'no run has started').toBe(0);

  // Feature 12, QA steps 7 and 21: scenarios compiled in this browser are listed after the bundled ones under Yours, five of them.
  await switchScenario(page, MARS);
  const mine = Array.from({ length: 5 }, (_, i) => ({ id: `my-scenario-${i + 1}`, name: `Harbour Town ${i + 1}`, description: 'Compiled', departments: 4, source: 'compiled' }));
  await routeScenarios(page, (listed) => [...mine, ...listed]);
  for (const size of [PHONE, WIDE]) {
    await test.step(`the bundled rows and five of Yours, ${size.width} in the dark look`, async () => {
      const root = await openReadyAt(page, '/sim', size, 'dark');
      const { part, rows, showAll } = otherParts(root);
      await expect(showAll).toHaveText(`Show all ${listed + mine.length - 1}`);
      await expect(part.getByRole('heading', { level: 3, name: 'Yours', exact: true })).toHaveCount(0);
      await showAll.click();
      await expect(rows).toHaveCount(listed + mine.length);
      // The bundled ones first, in their order, then Yours in theirs.
      const ids = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-scenario')));
      expect(ids.slice(0, 2)).toEqual([LUNAR, MARS]);
      expect(ids.slice(listed)).toEqual(mine.map((scenario) => scenario.id));
      const yours = part.getByRole('heading', { level: 3, name: 'Yours', exact: true });
      await expect(yours).toBeVisible();
      const [yoursBox, lastBundled, firstMine] = await Promise.all([box(yours), box(rows.nth(listed - 1)), box(rows.nth(listed))]);
      expect(yoursBox.y).toBeGreaterThanOrEqual(lastBundled.y + lastBundled.height - 1);
      expect(firstMine.y).toBeGreaterThanOrEqual(yoursBox.y + yoursBox.height - 1);
      await expect(rows.nth(listed).getByTestId('row-figures')).toHaveText('3 departments');
      await expectNoSidewaysScroll(page, root);
      await picture(page, `other-scenarios-yours-${size.width}-dark`);
    });
  }

  // A scenario of Yours keeps its details, where a compiled scenario is renamed and deleted: they open from its row, and run nothing.
  await test.step('a row of Yours opens its details, 1440 in the dark look', async () => {
    const root = await openReadyAt(page, '/sim', WIDE, 'dark');
    const { part, showAll } = otherParts(root);
    await showAll.click();
    await expect(part.getByRole('button', { name: /^View detail for /, disabled: false })).toHaveCount(5);
    await part.getByRole('button', { name: 'View detail for Harbour Town 1', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Scenario detail: Harbour Town 1' });
    await expect(details).toBeVisible();
    await expect(details.getByRole('button', { name: /^\W*(start|run|launch)\b/i })).toHaveCount(0);
    await expect(details.locator('input[type="range"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
    expect(setups(), 'no run has started').toBe(0);
  });
});

screenTest('feature 12: failures', async ({ page, context }) => {
  test.setTimeout(240_000);
  const setups = countSetups(page);
  const listed = await listedScenarios(page);

  // Feature 12, QA step 8: the list did not load; the first screen above works.
  for (const look of LOOKS) {
    await test.step(`the list did not load, 390 in the ${look} look`, async () => {
      await page.route('**/scenarios', (route: Route) => route.abort('failed'));
      const root = await openReadyAt(page, '/sim', PHONE, look);
      const { part, heading, rows } = otherParts(root);
      await expect(heading).toBeVisible();
      const failed = part.getByTestId('scenarios-failed');
      await expect(failed.getByRole('status')).toHaveText(LOAD_FAILED);
      await expect(failed.locator('[data-mark="broken-link"]')).toBeVisible();
      const again = failed.getByRole('button', { name: 'Try again', exact: true });
      const key = await box(again);
      expect(key.height).toBeGreaterThanOrEqual(44);
      expect(key.width).toBeGreaterThanOrEqual(96);
      await expect(rows).toHaveCount(0);
      await expect(activeStart(root)).toHaveCount(1);
      await failed.scrollIntoViewIfNeeded();
      await picture(page, `other-scenarios-did-not-load-390-${look}`);

      // Try again asks once more, and the rows arrive.
      await page.unroute('**/scenarios');
      await again.click();
      await expect(rows).toHaveCount(3);
      await expect(failed).toHaveCount(0);
    });
  }

  // Feature 12, QA step 17: a switch that fails is said on its own row; every other row can be pressed.
  for (const look of LOOKS) {
    await test.step(`a row did not load, 390 in the ${look} look`, async () => {
      await page.route('**/scenario/switch', (route: Route) => route.abort('failed'));
      const root = await openReadyAt(page, '/sim', PHONE, look);
      const { part, row, load, showAll } = otherParts(root);
      await showAll.click();
      await load('Lunar Outpost').click();
      await expect(row(LUNAR).getByRole('status')).toHaveText('Lunar Outpost did not load.');
      const again = row(LUNAR).getByRole('button', { name: 'Try again', exact: true });
      const key = await box(again);
      expect(key.height).toBeGreaterThanOrEqual(44);
      expect(key.width).toBeGreaterThanOrEqual(96);
      // Every other scenario can still be loaded, and the scenario above is as it was.
      await expect(part.getByRole('button', { name: /^Load /, disabled: false })).toHaveCount(listed - 2);
      await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis', exact: true })).toBeVisible();
      await expect(activeStart(root)).toHaveCount(1);
      await row(LUNAR).scrollIntoViewIfNeeded();
      await picture(page, `other-scenarios-row-did-not-load-390-${look}`);

      // Unblocked, Try again loads it.
      await page.unroute('**/scenario/switch');
      const reloaded = page.waitForEvent('load');
      await again.click();
      await reloaded;
      await expect(root.getByRole('heading', { level: 1, name: 'Lunar Outpost', exact: true })).toBeVisible();
      await switchScenario(page, MARS);
    });
  }

  // Feature 12, QA step 9: offline, the rows stay, and choosing one says why nothing loads.
  for (const look of LOOKS) {
    await test.step(`offline, 390 in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim', PHONE, look);
      const { rows, row, load } = otherParts(root);
      await expect(rows).toHaveCount(3);
      await context.setOffline(true);
      try {
        await load('Lunar Outpost').click();
        await expect(row(LUNAR).getByRole('status')).toHaveText(OFFLINE_ROW);
        await expect(row(LUNAR).locator('[data-mark="broken-link"]')).toBeVisible();
        await expect(rows).toHaveCount(3);
        await row(LUNAR).scrollIntoViewIfNeeded();
        await picture(page, `other-scenarios-offline-390-${look}`);
      } finally {
        await context.setOffline(false);
      }
      await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis', exact: true })).toBeVisible();
    });
  }

  // Feature 12, QA step 19: a server with one scenario shows no heading and no list.
  await routeScenarios(page, (listed) => listed.filter((scenario) => scenario.id === MARS));
  for (const size of [PHONE, WIDE]) {
    await test.step(`one scenario, ${size.width} in the dark look`, async () => {
      const root = await openReadyAt(page, '/sim', size, 'dark');
      await expect(root.getByTestId('write-your-own')).toBeVisible();
      await expect(root.getByRole('heading', { name: 'Other scenarios' })).toHaveCount(0);
      await expect(otherParts(root).rows).toHaveCount(0);
    });
  }
  expect(setups(), 'no run has started').toBe(0);
});

screenTest('feature 12: the paste form on a free run and on a key', async ({ page }) => {
  test.setTimeout(240_000);
  /** The parts of Write your own scenario. */
  const pasteParts = (root: Locator) => {
    const part = root.getByTestId('write-your-own');
    return {
      part,
      heading: part.getByRole('heading', { level: 2, name: 'Write your own scenario', exact: true }),
      field: part.locator('[data-quickstart-seed]'),
      slider: part.locator('#quickstart-actor-count'),
      atLimit: part.getByTestId('paste-at-limit'),
    };
  };

  // Feature 10, QA step 23, on the host's keys: no Actors slider, no dollar figure, and the key reads Generate and run.
  for (const [size, look] of [[PHONE, 'dark'], [WIDE, 'light']] as const) {
    await test.step(`a free run, ${size.width} in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim', size, look);
      const { part, heading, field, slider, atLimit } = pasteParts(root);
      await expect(heading).toBeVisible();
      // Under the list of other scenarios.
      const [list, block] = await Promise.all([box(root.getByTestId('other-scenarios')), box(part)]);
      expect(block.y).toBeGreaterThanOrEqual(list.y + list.height - 1);
      await expect(field).toBeVisible();
      await expect(slider).toHaveCount(0);
      expect(await wordsOf(part), 'no dollar figure').not.toContain('$');
      await expect(atLimit).toHaveCount(0);
      const run = part.getByRole('button', { name: 'Generate and run', exact: true });
      await expect(run).toBeVisible();
      await expect(run).toBeDisabled();
      await field.fill(DRAFT);
      await expect(run).toBeEnabled();
      expect(await wordsOf(part), 'no dollar figure with a draft typed').not.toContain('$');
      await part.scrollIntoViewIfNeeded();
      await picture(page, `write-your-own-free-${size.width}-${look}`);
    });
  }

  // Feature 10, QA step 24: with no free run left and no key, the at-limit paragraphs stand above that key, and a press asks the server for nothing.
  await routeNoRunLeft(page);
  for (const look of LOOKS) {
    await test.step(`no free run left, 390 in the ${look} look`, async () => {
      const compiles: string[] = [];
      const watch = (request: { method(): string; url(): string }) => {
        if (request.method() === 'POST' && /compile-from-seed/.test(request.url())) compiles.push(request.url());
      };
      page.on('request', watch);
      const root = await openReadyAt(page, '/sim', PHONE, look);
      const { part, field, atLimit } = pasteParts(root);
      await expect(atLimit).toContainText(NO_RUN_LEFT);
      await expect(atLimit).toContainText(ADD_KEY_PARAGRAPH);
      const link = atLimit.getByRole('link', { name: ADD_KEY_LINK, exact: true });
      await expect(link).toHaveAttribute('href', /tab=settings.*#key-openai$/);
      const run = part.getByRole('button', { name: 'Generate and run', exact: true });
      const [words, key] = await Promise.all([box(atLimit), box(run)]);
      expect(words.y + words.height, 'the paragraphs stand above the key').toBeLessThanOrEqual(key.y + 1);
      await field.fill(DRAFT);
      await pressInPage(run);
      await expect(atLimit).toContainText(NO_RUN_LEFT);
      await expect(page.getByText('3 runs/day')).toHaveCount(0);
      await page.waitForTimeout(500);
      expect(compiles, 'a press at the limit asks the server for nothing').toEqual([]);
      await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis', exact: true })).toBeVisible();
      await atLimit.scrollIntoViewIfNeeded();
      await picture(page, `write-your-own-at-limit-390-${look}`);
      page.off('request', watch);
    });
  }
  await page.unroute('**/rate-limit');

  // On the visitor's own key, whose bill it is: the Actors slider, the estimate and the key's own label.
  await saveKey(page);
  for (const [size, look] of [[PHONE, 'light'], [WIDE, 'dark']] as const) {
    await test.step(`own key, ${size.width} in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim', size, look);
      const { part, slider, atLimit } = pasteParts(root);
      await expect(slider).toBeVisible();
      await expect(part).toContainText('~$1.30');
      await expect(part.getByRole('button', { name: 'Generate + Run 2 Actors (~$1.30)', exact: true })).toBeVisible();
      await expect(atLimit).toHaveCount(0);
      await part.scrollIntoViewIfNeeded();
      await picture(page, `write-your-own-own-key-${size.width}-${look}`);
    });
  }
});

screenTest('feature 13: the notes and the foot', async ({ page }) => {
  test.setTimeout(300_000);
  const foot = page.locator(FOOT);
  const links = foot.getByRole('navigation', { name: 'Site links', exact: true }).getByRole('link');

  // Feature 13, QA steps 1, 2, 3, 11 and 13.
  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`the notes and the foot at ${size.width} in the ${look} look`, async () => {
        const root = await openReadyAt(page, '/sim', size, look);
        const ink = await tokenColour(page, '--text-1');

        // The fictional note under the leaders' heading row.
        const fictional = root.getByTestId('note-fictional');
        await expect(fictional).toHaveText(NOTE_FICTIONAL);
        const [sizeRow, fictionalBox, leaders] = await Promise.all([box(root.getByTestId('run-size')), box(fictional), box(root.getByTestId('leaders'))]);
        expect(fictionalBox.y).toBeGreaterThanOrEqual(sizeRow.y + sizeRow.height - 1);
        expect(fictionalBox.y + fictionalBox.height).toBeLessThanOrEqual(leaders.y + 1);

        // The AI note and the adults note: two separate lines, above Start's notice.
        const notes = root.getByTestId('first-screen-notes');
        const ai = notes.getByTestId('note-ai');
        const adults = notes.getByTestId('note-adults');
        await expect(ai).toHaveText(NOTE_AI);
        await expect(adults).toHaveText(NOTE_ADULTS);
        await expect(notes.locator('p')).toHaveCount(2);
        for (const note of [fictional, ai, adults]) {
          const style = await styleOf(note);
          expect(style.size).toBe(18);
          expect(style.colour).toBe(ink);
        }
        const [notesBox, aiBox, adultsBox, notice] = await Promise.all([box(notes), box(ai), box(adults), box(startParts(root).notice)]);
        expect(notesBox.y + notesBox.height, 'the notes stand above Start’s notice').toBeLessThanOrEqual(notice.y + 1);
        if (size === WIDE) {
          expect(Math.abs(aiBox.y - adultsBox.y), 'side by side at the wide width').toBeLessThanOrEqual(1);
          expect(adultsBox.x).toBeGreaterThanOrEqual(aiBox.x + aiBox.width - 1);
        } else {
          expect(adultsBox.y).toBeGreaterThanOrEqual(aiBox.y + aiBox.height - 1);
        }

        // The idle screen says no status, no dollar figure and no token count.
        await expect(page.getByText('Idle', { exact: true }).filter({ visible: true })).toHaveCount(0);
        for (const part of [root, foot]) {
          const words = await wordsOf(part);
          expect(words, 'no dollar figure').not.toContain('$');
          expect(words, 'no token count').not.toMatch(/\btokens?\b/i);
        }
        // Nothing drawn or generated of a person or a place: the one picture is the living grid's own canvas.
        await expect(root.locator('img')).toHaveCount(0);
        await expect(foot.locator('img, canvas')).toHaveCount(0);

        // The foot ends the page and scrolls with it.
        await expect(foot).toHaveRole('contentinfo');
        await expect(foot.getByTestId('foot-adults')).toHaveText(NOTE_ADULTS);
        await expect(links).toHaveText(['Docs', 'GitHub', 'npm', 'Privacy']);
        await expect(links.nth(0)).toHaveAttribute('href', '/docs');
        await expect(links.nth(1)).toHaveAttribute('href', 'https://github.com/framerslab/paracosm');
        await expect(links.nth(2)).toHaveAttribute('href', 'https://www.npmjs.com/package/paracosm');
        await expect(links.nth(3)).toHaveAttribute('href', '/#privacy');
        const choices = foot.getByRole('button', { name: 'Analytics choices', exact: true });
        await expect(choices).toBeVisible();
        await expect(foot.getByTestId('foot-licence')).toHaveText(LICENCE);
        expect(await foot.evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');
        expect(await page.getByRole('contentinfo').count(), 'the page has one foot on the Run tab').toBe(1);
        for (const part of [...await links.all(), choices]) {
          const [style, area] = await Promise.all([styleOf(part), box(part)]);
          expect(style.size).toBe(15);
          expect(area.height).toBeGreaterThanOrEqual(44);
          expect(area.width).toBeGreaterThanOrEqual(44);
        }
        expect((await styleOf(foot.getByTestId('foot-licence'))).size).toBe(15);
        expect(await measureReadability(page, FOOT)).toEqual([]);
        expect(await axeFindings(page, FOOT)).toEqual([]);
        await foot.scrollIntoViewIfNeeded();
        await picture(page, `page-foot-${size.width}-${look}`);
      });
    }
  }

  // Feature 13, QA steps 6, 7 and 14: the links stay one row; two columns at 600 px; one row from 1,100 px.
  for (const look of LOOKS) {
    for (const width of [320, 360, 390, 430, 480, 600, 768, 1100, 1440]) {
      await test.step(`the foot at ${width} in the ${look} look`, async () => {
        const root = await openReadyAt(page, '/sim', sizeAt(width), look);
        const boxes = await Promise.all((await links.all()).map((link) => box(link)));
        expect(boxes).toHaveLength(4);
        for (const [i, link] of boxes.entries()) {
          expect(Math.abs(link.y - boxes[0].y), 'the links stand on one row').toBeLessThanOrEqual(2);
          if (i > 0) expect(link.x - (boxes[i - 1].x + boxes[i - 1].width), 'with 8 px or more between them').toBeGreaterThanOrEqual(8);
        }
        const [nav, choices, licence] = await Promise.all([
          box(foot.getByRole('navigation', { name: 'Site links', exact: true })),
          box(foot.getByRole('button', { name: 'Analytics choices', exact: true })),
          box(foot.getByTestId('foot-licence')),
        ]);
        if (width >= 1100) {
          // One row: the links, Analytics choices, then the licence line at the right.
          expect(choices.x).toBeGreaterThanOrEqual(nav.x + nav.width - 1);
          expect(licence.x).toBeGreaterThanOrEqual(choices.x + choices.width - 1);
          expect(licence.y, 'the licence line shares the row').toBeLessThan(nav.y + nav.height);
          expect(licence.y + licence.height).toBeGreaterThan(nav.y);
        } else if (width >= 600) {
          // Two columns: the links and Analytics choices at the left, the licence line at the right.
          expect(choices.y).toBeGreaterThanOrEqual(nav.y + nav.height - 1);
          expect(licence.x).toBeGreaterThanOrEqual(Math.max(nav.x + nav.width, choices.x + choices.width) - 1);
        } else {
          // Stacked: the links, then Analytics choices, then the licence line.
          expect(choices.y).toBeGreaterThanOrEqual(nav.y + nav.height - 1);
          expect(licence.y).toBeGreaterThanOrEqual(choices.y + choices.height - 1);
        }
        await expectNoSidewaysScroll(page, root);
        expect(await foot.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'the foot does not scroll sideways').toBe(true);
      });
    }
  }

  // Feature 13, QA step 8: with the day's free run used, the notes stay, above the at-limit paragraphs.
  await routeNoRunLeft(page);
  for (const size of [PHONE, WIDE]) {
    await test.step(`no free run left, ${size.width} in the dark look`, async () => {
      const root = await openReadyAt(page, '/sim', size, 'dark');
      await expect(root.getByTestId('note-fictional')).toHaveText(NOTE_FICTIONAL);
      const notes = root.getByTestId('first-screen-notes');
      await expect(notes.getByTestId('note-ai')).toHaveText(NOTE_AI);
      await expect(notes.getByTestId('note-adults')).toHaveText(NOTE_ADULTS);
      const [notesBox, limit] = await Promise.all([box(notes), box(root.getByTestId('at-limit'))]);
      expect(notesBox.y + notesBox.height).toBeLessThanOrEqual(limit.y + 1);
    });
  }
  await page.unroute('**/rate-limit');

  // Feature 13, QA step 4: Analytics choices opens the consent choices again.
  await test.step('Analytics choices opens the consent choices, 390 in the dark look', async () => {
    await openReadyAt(page, '/sim', PHONE, 'dark');
    const choices = foot.getByRole('button', { name: 'Analytics choices', exact: true });
    await choices.scrollIntoViewIfNeeded();
    await choices.click();
    const bar = page.getByRole('region', { name: 'Analytics choices' });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('switch')).not.toHaveCount(0);
    await bar.getByRole('button', { name: 'Reject all' }).click();
    await expect(bar).toBeHidden();
  });

  // Feature 13, QA step 5: Privacy lands on the landing page's section of that name.
  await test.step('Privacy opens the landing page’s privacy section, 1440 in the dark look', async () => {
    await openReadyAt(page, '/sim', WIDE, 'dark');
    await links.filter({ hasText: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/#privacy$/);
    await expect(page.locator('#privacy')).toBeVisible();
  });
});

screenTest('draft scenario', async ({ page }) => {
  test.setTimeout(180_000);
  // Feature 10, QA step 13: a draft of 200 characters or more in Write your own scenario holds Start.
  for (const look of LOOKS) {
    await test.step(`1440 in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim', WIDE, look);
      const { key } = startParts(root);
      const field = root.getByTestId('write-your-own').locator('[data-quickstart-seed]');
      await expect(activeStart(root)).toHaveCount(1);
      await expect(root.getByTestId('start-held')).toHaveCount(0);

      // 199 characters are no draft yet.
      await field.fill(DRAFT.slice(0, 199));
      await expect(activeStart(root)).toHaveCount(1);
      await field.fill(DRAFT.slice(0, 200));
      const held = root.getByTestId('start-held');
      await expect(held).toContainText(HELD);
      await expect(key).toHaveAttribute('aria-disabled', 'true');
      await expect(activeStart(root)).toHaveCount(0);
      // An inactive Start has no fill.
      expect((await styleOf(key)).ground).not.toBe(await tokenColour(page, '--rust'));
      const go = held.getByRole('link', { name: 'Go to your draft', exact: true });
      const clear = held.getByRole('button', { name: 'Clear your draft', exact: true });
      await expect(go).toBeVisible();
      await expect(clear).toBeVisible();
      await key.scrollIntoViewIfNeeded();
      await picture(page, `start-held-1440-${look}`);

      // Go to your draft brings the draft into view, ready to be read and run there.
      await go.click();
      await expect(field).toBeInViewport();
      await expect(field).toBeFocused();
      await expect(field).toHaveValue(DRAFT.slice(0, 200));

      // Clear your draft empties it, and Start is active again.
      await pressInPage(clear);
      await expect(field).toHaveValue('');
      await expect(root.getByTestId('start-held')).toHaveCount(0);
      await expect(activeStart(root)).toHaveCount(1);
      await expect(key).toHaveAccessibleName(START_FREE);
    });
  }
});

screenTest('readability: the first screen at five widths', async ({ page }) => {
  test.setTimeout(180_000);
  for (const width of [320, 390, 768, 1100, 1440]) {
    for (const look of LOOKS) {
      await test.step(`${width} in the ${look} look`, async () => {
        await openReady(page, sizeAt(width), look);
        expect(await measureReadability(page)).toEqual([]);
      });
    }
  }
});

screenTest('rows: one row at six widths', async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [320, 360, 390, 430, 480, 768]) {
    for (const look of LOOKS) {
      await test.step(`${width} in the ${look} look`, async () => {
        await openReady(page, sizeAt(width), look);
        expect(await page.locator(`${FIRST_SCREEN} [data-row]`).count()).toBeGreaterThan(0);
        expect(await rowsOnOneRow(page)).toEqual([]);
      });
    }
  }
});

screenTest('accessibility: ready state', async ({ page }) => {
  test.setTimeout(120_000);
  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openReady(page, size, look);
        expect(await axeFindings(page)).toEqual([]);
      });
    }
  }
});

/* The sweep, 200 per cent text and the pictures (every feature this screen builds). */

/** The sweep's widths: a small phone, a phone, a tablet, a wider tablet, a desktop and the wide width. */
const SWEEP_WIDTHS = [320, 390, 600, 768, 1100, 1440] as const;

/** The type tokens of the page, every size a word of it is set in. */
const TYPE_SIZES = ['--font-3xs', '--font-2xs', '--font-xs', '--font-sm', '--font-md', '--font-lg', '--font-xl', '--font-2xl', '--font-3xl', '--font-read-body', '--font-read', '--font-display'];

/**
 * Sets the page's text to 200 per cent, as a browser's text-only zoom does:
 * every type size twice the size it computes to at this width, with the
 * window and every other length as they were. Every size on the first
 * screen and its foot is one of these tokens, so every word of them grows.
 */
async function doubleText(page: Page): Promise<void> {
  await page.evaluate((names) => {
    const computed = getComputedStyle(document.documentElement);
    const sizes = names
      .map((name) => ({ name, px: parseFloat(computed.getPropertyValue(name)) }))
      .filter((s) => Number.isFinite(s.px))
      .map((s) => `${s.name}: ${s.px * 2}px !important;`);
    const style = document.createElement('style');
    style.setAttribute('data-double-text', '');
    style.textContent = `:root { ${sizes.join(' ')} }`;
    document.head.append(style);
  }, TYPE_SIZES);
  // The new sizes are laid out in the served faces, and painted twice, before anything is read.
  await page.evaluate(() => document.fonts.ready.then(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  })));
}

/**
 * How far each part scrolls sideways, in px: the first screen, the nearest
 * part around it that scrolls (the tab's own scroll area), the page's foot,
 * and the page; and the parts that stand past the first screen's or the
 * foot's right edge, each the outermost one, with how far past it.
 */
const sidewaysOf = (page: Page, root: Locator): Promise<{ screen: number; view: number; foot: number; page: number; past: string[] }> => root.evaluate((el) => {
  let view = 0;
  for (let a = el.parentElement; a; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { view = a.scrollWidth - a.clientWidth; break; }
  }
  const foot = document.querySelector('[data-testid="page-foot"]');
  const past: string[] = [];
  const walk = (holder: Element, edge: number, node: Element) => {
    for (const child of Array.from(node.children)) {
      const r = child.getBoundingClientRect();
      const cs = getComputedStyle(child);
      if (cs.display === 'none' || cs.visibility === 'hidden' || r.width <= 0 || r.height <= 0) continue;
      if (r.right > edge + 1) {
        const tid = child.getAttribute('data-testid');
        const cls = typeof child.className === 'string' ? child.className.split(/\s+/)[0] : '';
        past.push(`${child.tagName.toLowerCase()}${tid ? `[${tid}]` : ''}${cls ? `.${cls}` : ''} "${(child.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)}" ${Math.round(r.right - edge)} px`);
        continue;
      }
      // A part that clips or scrolls what it holds keeps it from the page.
      if (cs.overflowX === 'visible') walk(holder, edge, child);
    }
  };
  for (const holder of foot ? [el, foot] : [el]) {
    walk(holder, holder.getBoundingClientRect().left + holder.clientWidth, holder);
  }
  return {
    screen: el.scrollWidth - el.clientWidth,
    view,
    foot: foot ? foot.scrollWidth - foot.clientWidth : 0,
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    past: past.slice(0, 12),
  };
});

/** No part scrolls sideways by more than a pixel's rounding. */
async function expectSoftNoSideways(page: Page, root: Locator, where: string): Promise<void> {
  const s = await sidewaysOf(page, root);
  expect.soft(Math.max(s.screen, s.view, s.foot, s.page), `no sideways scroll ${where} (${JSON.stringify(s)})`).toBeLessThanOrEqual(1);
}

/** Each part named inside a holder that stands outside the holder's box. */
const outside = (holder: Locator, parts: string): Promise<string[]> => holder.evaluate((el, selector) => {
  const h = el.getBoundingClientRect();
  return Array.from(el.querySelectorAll(selector))
    .map((p) => ({ p, r: p.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0)
    .filter(({ r }) => r.left < h.left - 1 || r.right > h.right + 1 || r.top < h.top - 1 || r.bottom > h.bottom + 1)
    .map(({ p, r }) => `${(p.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)} at ${Math.round(r.left)} to ${Math.round(r.right)}, ${Math.round(r.top)} to ${Math.round(r.bottom)}`);
}, parts);

/** One state of the first screen the sweep reads, and how the page reaches it. */
interface SweepState {
  name: string;
  /** Whether the automated check runs at this state. */
  axe: boolean;
  /** Readies the page once, before the first width. */
  prepare?: (page: Page) => Promise<void>;
  /** Opens the state at one size and look, and resolves with the first screen's root. */
  open: (page: Page, size: { width: number; height: number }, look: Look) => Promise<Locator>;
}

/** The states of the sweep. Each call makes its own, so a held request belongs to one test. */
function sweepStates(): SweepState[] {
  // Starting: every POST /setup is held until the next state opens, then dropped, so no run starts.
  let release: () => void = () => undefined;
  const own = (size: number) => async (page: Page, at: { width: number; height: number }, look: Look) => {
    const root = await openReadyAt(page, `/sim?size=${size}`, at, look);
    await expect(startParts(root).key.getByTestId('start-second')).toHaveText(`${size} leaders, 6 turns, on your own API key`);
    return root;
  };
  return [
    {
      name: 'ready, a pair',
      axe: true,
      open: async (page, size, look) => {
        const root = await openReadyAt(page, '/sim', size, look);
        await expect(activeStart(root)).toHaveCount(1);
        return root;
      },
    },
    {
      name: 'starting',
      axe: false,
      prepare: (page) => page.route('**/setup', async (route: Route) => {
        await new Promise<void>((resolve) => { release = resolve; });
        await route.abort('failed').catch(() => undefined);
      }),
      open: async (page, size, look) => {
        release();
        const root = await openReadyAt(page, '/sim', size, look);
        const { key } = startParts(root);
        await key.click();
        await expect(key).toHaveText(STARTING);
        return root;
      },
    },
    {
      name: 'no free run left',
      axe: true,
      prepare: routeNoRunLeft,
      open: async (page, size, look) => {
        const root = await openReadyAt(page, '/sim', size, look);
        await expect(root.getByTestId('at-limit-reset')).toHaveText(atLimitReset(await clockTime(page, RESET_AT)));
        return root;
      },
    },
    { name: 'own key at 24', axe: false, prepare: saveKey, open: own(24) },
    { name: 'own key at 300', axe: false, prepare: saveKey, open: own(300) },
    {
      name: 'self-hosted',
      axe: false,
      open: async (page, size, look) => {
        const root = await openReadyAt(page, `${SELF_HOSTED}/sim`, size, look, null);
        await expect(activeStart(root)).toHaveCount(1);
        return root;
      },
    },
  ];
}

// The sweep: every state at every width in both looks, each word and glyph
// at its figure, every row one row, no sideways scroll, the automated check
// at the ready and no-run-left states, and at 200 per cent text nothing cut
// and nothing scrolling sideways. A state's figures are read in full before
// its case fails, so one run names every part under its figure.
for (const [index, state] of sweepStates().entries()) {
  screenTest(`sweep: every state at every width in both looks (${state.name})`, async ({ page }) => {
    test.setTimeout(360_000);
    const current = sweepStates()[index];
    if (current.prepare) await current.prepare(page);
    for (const width of SWEEP_WIDTHS) {
      for (const look of LOOKS) {
        await test.step(`${width} in the ${look} look`, async () => {
          const at = `at ${width} in the ${look} look`;
          const root = await current.open(page, sizeAt(width), look);
          expect.soft(await measureReadability(page), `every word and glyph at its figure ${at}`).toEqual([]);
          expect.soft(await rowsOnOneRow(page), `every row one row ${at}`).toEqual([]);
          if (current.axe) expect.soft(await axeFindings(page), `no WCAG 2.2 A or AA failure ${at}`).toEqual([]);
          await expectSoftNoSideways(page, root, at);
        });
      }
    }
    await test.step('200 per cent text at 320 in the light look', async () => {
      const root = await current.open(page, sizeAt(320), 'light');
      await doubleText(page);
      expect.soft((await spacingFaults(root)).cut, 'no word of the first screen is cut at 200 per cent text').toEqual([]);
      expect.soft((await spacingFaults(page.getByTestId('page-foot'))).cut, 'no word of the foot is cut at 200 per cent text').toEqual([]);
      await expectSoftNoSideways(page, root, 'at 200 per cent text');
    });
  });
}

screenTest('200 per cent text: the scenario line, Start, the rows of Other scenarios and the foot', async ({ page }) => {
  test.setTimeout(240_000);
  const DOUBLE = sizeAt(320);

  // Feature 3, QA step 13: the sentences and the figures wrap, the figures
  // stand in one column, and nothing is cut.
  await test.step('the scenario line, 320 in the light look', async () => {
    const root = await openReadyAt(page, '/sim', DOUBLE, 'light');
    await doubleText(page);
    const line = root.getByTestId('scenario-line');
    const faults = await spacingFaults(line);
    expect.soft(faults.cut, 'no word of the scenario line is cut').toEqual([]);
    expect.soft(faults.overlaps, 'no word of the scenario line stands over another').toEqual([]);
    expect.soft(await lineCount(root.getByTestId('scenario-sentences')), 'the sentences wrap').toBeGreaterThan(1);
    const cells = await root.getByTestId('scenario-figures').locator('[data-figure]').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, bottom: r.bottom };
    }));
    expect(cells).toHaveLength(4);
    expect.soft(cells.every((c) => Math.abs(c.left - cells[0].left) <= 1), `the figures stand in one column (${JSON.stringify(cells)})`).toBe(true);
    expect.soft(cells.every((c, i) => i === 0 || c.top >= cells[i - 1].bottom - 1), 'each figure under the one before it').toBe(true);
    expect.soft(await outside(line, '[data-figure], [data-testid="scenario-sentences"], h1'), 'the words stand inside the block').toEqual([]);
    await expectSoftNoSideways(page, root, 'at 200 per cent text');
    await picture(page, 'scenario-line-200-per-cent-320-light');
  });

  // Feature 10, QA step 17: Start holds both of its lines, and the bar grows
  // with it up to half the window's height, past which it rests in the page.
  await test.step('Start, 320 in the light look, a free run left', async () => {
    const root = await openReadyAt(page, '/sim', DOUBLE, 'light');
    await doubleText(page);
    const { key, bar } = startParts(root);
    await expect(key).toHaveAccessibleName(START_FREE);
    const faults = await spacingFaults(key);
    expect.soft(faults.cut, 'no word of Start is cut').toEqual([]);
    expect.soft(faults.overlaps, 'Start’s two lines do not overlap').toEqual([]);
    expect.soft(await outside(key, '[data-testid="start-first"], [data-testid="start-second"]'), 'Start holds both of its lines').toEqual([]);
    if ((await bar.getAttribute('data-stuck')) === 'true') {
      expect.soft((await box(bar)).height, 'the stuck bar is at most half the window high').toBeLessThanOrEqual(DOUBLE.height / 2 + 1);
      expect.soft((await spacingFaults(bar)).cut, 'no word of the stuck bar is cut').toEqual([]);
    }
    await picture(page, 'start-200-per-cent-320-light');
    await scrollToBandPlace(root);
    expect.soft(await outside(key, '[data-testid="start-first"], [data-testid="start-second"]'), 'Start holds both of its lines in its place').toEqual([]);
    expect.soft((await spacingFaults(root.getByTestId('start-band'))).cut, 'no word of the Start band is cut').toEqual([]);
  });

  // Feature 12, QA step 14: each row of Other scenarios holds its lines whole.
  await test.step('the rows of Other scenarios, 320 in the light look', async () => {
    const root = await openReadyAt(page, '/sim', DOUBLE, 'light');
    await doubleText(page);
    const rows = root.getByTestId('scenario-row');
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) {
      if (!(await row.isVisible())) continue;
      const name = (await row.getByTestId('row-name').textContent()) ?? '';
      const faults = await spacingFaults(row);
      expect.soft(faults.cut, `no word of the ${name} row is cut`).toEqual([]);
      expect.soft(faults.overlaps, `no line of the ${name} row stands over another`).toEqual([]);
      expect.soft(await outside(row, '[data-testid^="row-"]'), `the ${name} row holds its lines`).toEqual([]);
    }
    await root.getByTestId('other-scenarios').scrollIntoViewIfNeeded();
    await picture(page, 'other-scenarios-200-per-cent-320-light');
  });

  // Feature 13, QA step 10: the notes wrap; the foot's row holds Privacy and
  // More links on one line, with Docs, GitHub and npm in that key's menu.
  for (const look of LOOKS) {
    await test.step(`the notes and the foot, 320 in the ${look} look`, async () => {
      const root = await openReadyAt(page, '/sim', DOUBLE, look);
      const foot = page.getByTestId('page-foot');
      const nav = foot.getByRole('navigation', { name: 'Site links', exact: true });
      const more = nav.getByRole('button', { name: 'More links', exact: true });
      // At 100 per cent text the four links fit one row and there is no More links key.
      await expect(nav.getByRole('link')).toHaveText(['Docs', 'GitHub', 'npm', 'Privacy']);
      await expect(more).toHaveCount(0);

      await doubleText(page);
      const notes = root.getByTestId('first-screen-notes');
      expect.soft(await lineCount(notes.getByTestId('note-ai')), 'the AI note wraps').toBeGreaterThan(1);
      const noteFaults = await spacingFaults(notes);
      expect.soft(noteFaults.cut, 'no word of the notes is cut').toEqual([]);
      expect.soft(noteFaults.overlaps, 'no note stands over another').toEqual([]);

      await foot.scrollIntoViewIfNeeded();
      await expect(more).toBeVisible();
      await expect(more).toHaveAttribute('aria-haspopup', 'menu');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await expect(nav.getByRole('link').filter({ visible: true })).toHaveText(['Privacy']);
      const [privacy, key] = await Promise.all([box(nav.getByRole('link', { name: 'Privacy', exact: true })), box(more)]);
      expect.soft(Math.abs(privacy.y + privacy.height / 2 - (key.y + key.height / 2)), 'Privacy and More links stand on one line').toBeLessThanOrEqual(2);
      expect.soft(key.height).toBeGreaterThanOrEqual(44);
      expect.soft(key.width).toBeGreaterThanOrEqual(96);
      const footFaults = await spacingFaults(foot);
      expect.soft(footFaults.cut, 'no word of the foot is cut').toEqual([]);
      expect.soft(footFaults.overlaps, 'no word of the foot stands over another').toEqual([]);
      await expectSoftNoSideways(page, root, `at 200 per cent text in the ${look} look`);
      await picture(page, `page-foot-200-per-cent-320-${look}`);

      // The key opens a menu of the three links it holds, and Escape closes it with focus back on the key.
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      const menu = foot.getByRole('menu');
      await expect(menu).toBeVisible();
      const items = menu.getByRole('menuitem');
      await expect(items).toHaveText(['Docs', 'GitHub', 'npm']);
      await expect(items.nth(0)).toHaveAttribute('href', '/docs');
      await expect(items.nth(1)).toHaveAttribute('href', 'https://github.com/framerslab/paracosm');
      await expect(items.nth(2)).toHaveAttribute('href', 'https://www.npmjs.com/package/paracosm');
      await expect(items.nth(0)).toBeFocused();
      expect.soft((await spacingFaults(menu)).cut, 'no word of the menu is cut').toEqual([]);
      await picture(page, `page-foot-more-links-200-per-cent-320-${look}`);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await expect(more).toBeFocused();
    });
  }
});

/**
 * A picture of a whole tab, at a device scale factor of 2: the window grows
 * to the height of everything its scroll area holds, so the picture shows
 * the tab from its top to its foot, then the window returns to its size.
 */
async function wholePicture(page: Page, anchor: Locator, name: string): Promise<void> {
  const size = page.viewportSize() ?? WIDE;
  for (let pass = 0; pass < 3; pass += 1) {
    const hidden = await anchor.evaluate((el) => {
      for (let a: Element | null = el; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && a.scrollHeight > a.clientHeight + 1) return a.scrollHeight - a.clientHeight;
      }
      return 0;
    });
    if (hidden <= 0) break;
    const now = page.viewportSize() ?? size;
    await page.setViewportSize({ width: now.width, height: Math.min(now.height + hidden, 7000) });
  }
  await page.evaluate(() => new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }));
  await page.screenshot({ path: `${PICTURES}/${name}.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize(size);
}

// The pull request's pictures: the whole Run tab at 390 and 1,440 in both
// looks, ready, with no free run left and on the visitor's own key at 24,
// and the How it works card over the window.
screenTest('pictures: the first screen at 390 and 1,440 in both looks', async ({ page }) => {
  test.setTimeout(300_000);
  const shoot = async (state: string, path: string, ready: (root: Locator) => Promise<void>) => {
    for (const size of [PHONE, WIDE]) {
      for (const look of LOOKS) {
        await test.step(`${state}, ${size.width} in the ${look} look`, async () => {
          const root = await openReadyAt(page, path, size, look);
          await ready(root);
          await expect(root.getByTestId('shared-colony').locator('canvas')).toBeVisible();
          await wholePicture(page, root, `${size.width}-${look}-${state}`);
        });
      }
    }
  };
  await shoot('ready', '/sim', async (root) => { await expect(activeStart(root)).toHaveCount(1); });

  for (const size of [PHONE, WIDE]) {
    for (const look of LOOKS) {
      await test.step(`how-it-works, ${size.width} in the ${look} look`, async () => {
        await openReadyAt(page, '/sim', size, look);
        await pressInPage(howKey(page));
        const card = await expectHowCard(page, MARS_LINES);
        await card.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))));
        await picture(page, `${size.width}-${look}-how-it-works`);
        await page.keyboard.press('Escape');
        await expect(howCard(page)).toHaveCount(0);
      });
    }
  }

  await routeNoRunLeft(page);
  await shoot('no-free-run-left', '/sim', async (root) => {
    await expect(root.getByTestId('at-limit-reset')).toBeVisible();
  });
  await page.unroute('**/rate-limit');

  await saveKey(page);
  await shoot('own-key-24', '/sim?size=24', async (root) => {
    await expect(startParts(root).key.getByTestId('start-second')).toHaveText('24 leaders, 6 turns, on your own API key');
  });
});

// The pull request's pictures of Watch: the stub pair's run on the Sim tab,
// its two colonies in the living grid, at 390 and 1,440 in both looks. Each
// run is a visitor of its own, since the day holds one run an address.
screenTest('pictures: Watch on the stub pair at 390 and 1,440 in both looks', async ({ page, context }, info) => {
  test.setTimeout(300_000);
  let step = 0;
  try {
    for (const size of [PHONE, WIDE]) {
      for (const look of LOOKS) {
        await test.step(`${size.width} in the ${look} look`, async () => {
          if (step > 0) {
            await page.request.post(`${SERVER}/clear`);
            await context.setExtraHTTPHeaders({ 'x-real-ip': `198.18.0.${1 + step * 3 + info.retry}` });
          }
          step += 1;
          const root = await openReadyAt(page, '/sim', size, look);
          await startAndWatch(page, root);
          await page.mouse.move(0, 0);
          const panels = watchPanels(page);
          await expect(panels).toHaveCount(2);
          const [first, second] = await Promise.all([tokenColour(page, '--vis'), tokenColour(page, '--eng')]);
          for (const panel of [panels.nth(0), panels.nth(1)]) {
            await expect
              .poll(async () => (await drawingOf(panel.locator('canvas'), first, second)).drawn, { message: 'the panel has drawn its colony' })
              .toBeGreaterThan(0);
          }
          await wholePicture(page, panels.nth(0), `${size.width}-${look}-watch`);
        });
      }
    }
  } finally {
    // The stub run holds a run slot until its visitor clears it.
    await page.request.post(`${SERVER}/clear`).catch(() => undefined);
  }
});

/* States a visitor reaches by an ordinary path after the first screen has loaded. */

// Feature 13: the same foot holds the page's one Analytics choices control across tabs.
screenTest('feature 13: Analytics choices stays through a change of tab', async ({ page }) => {
  test.setTimeout(120_000);
  await openReadyAt(page, '/sim', WIDE, 'dark');
  const inFoot = page.locator(FOOT).getByRole('button', { name: 'Analytics choices', exact: true });
  const control = page.locator('#pcc-reopen');
  await expect(inFoot).toBeVisible();
  for (const visit of [1, 2]) {
    await test.step(`to Watch and back, visit ${visit}`, async () => {
      await openTab(page, 'sim');
      await expect(page.locator('#tabpanel-sim')).toBeVisible();
      await expect(control, 'the other tabs’ footer offers the control').toBeVisible();
      await openTab(page, 'quickstart');
      await expect(page.locator(FIRST_SCREEN)).toBeVisible();
      await expect(inFoot, 'the Run tab’s foot offers the control again').toBeVisible();
    });
  }
  await test.step('the control still opens the choices', async () => {
    await inFoot.scrollIntoViewIfNeeded();
    await inFoot.click();
    const bar = page.getByRole('region', { name: 'Analytics choices' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Reject all' }).click();
    await expect(bar).toBeHidden();
  });
});

// Feature 13: the foot ends the Run tab in every state of it, not only the first screen.
screenTest('feature 13: the foot ends the Run tab while a pasted scenario is written', async ({ page }) => {
  test.setTimeout(120_000);
  const held = gate();
  await page.route('**/api/quickstart/compile-from-seed', async (route: Route) => { await held.opened; await route.abort(); });
  try {
    const root = await openReadyAt(page, '/sim', WIDE, 'dark');
    const part = root.getByTestId('write-your-own');
    await part.locator('[data-quickstart-seed]').fill(DRAFT);
    await part.getByRole('button', { name: 'Generate and run', exact: true }).click();
    // The first screen gives way to the run's progress, whose h1 is the tab's name.
    await expect(root).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Run', exact: true })).toBeAttached();
    const foot = page.locator(FOOT);
    await expect(foot).toBeVisible();
    await expect(foot).toHaveRole('contentinfo');
    await expect(foot.getByRole('navigation', { name: 'Site links', exact: true }).getByRole('link')).toHaveText(['Docs', 'GitHub', 'npm', 'Privacy']);
    await expect(foot.getByRole('button', { name: 'Analytics choices', exact: true })).toBeVisible();
    await expect(foot.getByTestId('foot-licence')).toHaveText(LICENCE);
    await expect(page.getByRole('contentinfo').filter({ visible: true })).toHaveCount(1);
  } finally {
    held.open();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

// Feature 11, QA step 7: the sheet opens with focus on its title, and holds focus from there in both directions.
screenTest('feature 11: Shift+Tab straight after the sheet opens stays inside it', async ({ page }) => {
  test.setTimeout(120_000);
  await openReadyAt(page, '/sim', PHONE, 'dark');
  await howKey(page).click();
  const card = howCard(page);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('aria-modal', 'true');
  await expect(card.getByRole('heading', { level: 2, name: HOW_TITLE, exact: true })).toBeFocused();
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await holdsFocus(card), `focus is inside the sheet after Shift+Tab ${i + 1} from its title`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(howKey(page)).toBeFocused();
});

// Feature 10: the leaders the browser keeps for the run on screen are those of a run the server took.
screenTest('feature 10: a Start the server refuses leaves the stored leaders of the last run', async ({ page }) => {
  test.setTimeout(120_000);
  const earlier = { actors: JSON.stringify([{ name: 'First leader of an earlier run' }, { name: 'Second leader of an earlier run' }]), scenario: 'an-earlier-scenario' };
  await page.addInitScript((kept) => {
    window.localStorage.setItem('paracosm:activeRunActors', kept.actors);
    window.localStorage.setItem('paracosm:activeRunScenarioId', kept.scenario);
  }, earlier);
  const stored = () => page.evaluate(() => ({
    actors: window.localStorage.getItem('paracosm:activeRunActors'),
    scenario: window.localStorage.getItem('paracosm:activeRunScenarioId'),
  }));
  const root = await openReadyAt(page, '/sim', PHONE, 'dark');
  const { key } = startParts(root);
  const refusals: Array<{ name: string; answer: (route: Route) => Promise<void>; words: string }> = [
    { name: 'a busy server', answer: (route) => route.fulfill({ status: 503, json: { error: 'x' } }), words: SERVER_BUSY },
    { name: 'no connection', answer: (route) => route.abort(), words: COULD_NOT_REACH },
  ];
  for (const refusal of refusals) {
    await test.step(refusal.name, async () => {
      await page.route('**/setup', refusal.answer);
      try {
        await expect(key).toHaveAccessibleName(START_FREE);
        await key.click();
        await expect(root.getByTestId('start-failure')).toHaveText(refusal.words);
        await expect(key).toBeEnabled();
        expect(await stored(), 'the stored leaders are the earlier run’s').toEqual(earlier);
      } finally {
        await page.unroute('**/setup');
      }
    });
  }
});

// Feature 10: the at-limit state names a reset time, and the page reads the count again once that time has come.
screenTest('feature 10: at the reset time the page reads the count again', async ({ page }) => {
  test.setTimeout(120_000);
  let resetAt = 0;
  await page.route('**/rate-limit', (route: Route) => {
    // The reset comes 15 seconds after the page's first read, so the at-limit state is on screen well before it.
    if (resetAt === 0) resetAt = Date.now() + 15_000;
    return Date.now() < resetAt
      ? route.fulfill({ json: { allowed: false, remaining: 0, limit: 1, resetAt } })
      : route.fulfill({ json: { allowed: true, remaining: 1, limit: 1, resetAt: resetAt + 86_400_000 } });
  });
  try {
    const root = await openReadyAt(page, '/sim', PHONE, 'dark');
    const band = root.getByTestId('start-band');
    await expect(band).toHaveAttribute('data-state', 'limit');
    await expect(root.getByTestId('scenario-sentences')).toHaveText(AT_LIMIT_SENTENCES);
    // No press and no reload: the page asks again by itself once the reset time has passed.
    await expect(band).toHaveAttribute('data-state', 'ready', { timeout: 45_000 });
    const { key } = startParts(root);
    await expect(key).toHaveAccessibleName(START_FREE);
    await expect(key).toBeEnabled();
    await expect(root.getByTestId('scenario-sentences')).toHaveText(PAIR_SENTENCES);
    await expect(root.getByTestId('at-limit-reset')).toHaveCount(0);
  } finally {
    await page.unroute('**/rate-limit');
  }
});

// Features 3 and 10: whose keys a run uses comes from the server's settings, so a read that failed is asked again.
screenTest('feature 10: a settings read that failed is asked again', async ({ page }) => {
  test.setTimeout(120_000);
  let failUntil = 0;
  await page.route('**/admin-config', (route: Route) => {
    if (failUntil === 0) failUntil = Date.now() + 1_500;
    return Date.now() < failUntil ? route.abort('failed') : route.continue();
  });
  try {
    const root = await openReadyAt(page, '/sim', PHONE, 'dark');
    const { key, notice } = startParts(root);
    // No reload: once the settings are read, the run is the free run it is, with the host's figures.
    await expect(notice).toContainText(FREE_RUN, { timeout: 30_000 });
    await expect(notice).not.toContainText(SERVER_NOTICE);
    await expect(key).toHaveAccessibleName(START_FREE);
    await expect(root.getByTestId('scenario-figures')).toHaveText(FREE_FIGURES);
    await expect(sizeParts(root).part.getByTestId('run-size-settings')).toHaveCount(0);
  } finally {
    await page.unroute('**/admin-config');
  }
});

/** A press of Start whose run the server has not answered yet: POST /setup waits until `open` is called, then is refused as busy. */
async function holdSetup(page: Page): Promise<{ open: () => void }> {
  const held = gate();
  await page.route('**/setup', async (route: Route) => {
    await held.opened;
    await route.fulfill({ status: 503, json: { error: 'x' } });
  });
  return held;
}

// Feature 10: one press starts one run. While it waits for the server, the paste form starts no second one.
screenTest('feature 10: while Start waits for the server, the paste form waits too', async ({ page }) => {
  test.setTimeout(120_000);
  const held = await holdSetup(page);
  try {
    const root = await openReadyAt(page, '/sim', WIDE, 'dark');
    const field = root.getByTestId('write-your-own').locator('[data-quickstart-seed]');
    await expect(field).toBeEnabled();
    await startParts(root).key.click();
    await expect(root.getByTestId('start-band')).toHaveAttribute('data-state', 'starting');
    await expect(field, 'no draft can be written or sent while the run starts').toBeDisabled();
    // The server refuses: the form can be used again.
    held.open();
    await expect(root.getByTestId('start-failure')).toHaveText(SERVER_BUSY);
    await expect(field).toBeEnabled();
  } finally {
    held.open();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

// Feature 12: the run Start posts is the scenario on screen, so no other scenario loads while it waits for the server.
screenTest('feature 12: while Start waits for the server, no other scenario loads', async ({ page }) => {
  test.setTimeout(120_000);
  const switches: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/scenario/switch') switches.push(request.url());
  });
  const held = await holdSetup(page);
  try {
    const root = await openReadyAt(page, '/sim', WIDE, 'dark');
    const row = root.getByTestId('other-scenarios').locator('[data-testid="scenario-row"][data-state="rest"] button').first();
    await expect(row).toBeVisible();
    await expect(row).not.toHaveAttribute('aria-disabled', 'true');
    await startParts(root).key.click();
    await expect(root.getByTestId('start-band')).toHaveAttribute('data-state', 'starting');
    await expect(row, 'a row says it cannot be pressed while the run starts').toHaveAttribute('aria-disabled', 'true');
    await pressInPage(row);
    await page.waitForTimeout(500);
    expect(switches, 'no scenario is asked for while the run starts').toEqual([]);
    await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis', exact: true })).toBeVisible();
    // The server refuses: the rows can be pressed again.
    held.open();
    await expect(root.getByTestId('start-failure')).toHaveText(SERVER_BUSY);
    await expect(row).not.toHaveAttribute('aria-disabled', 'true');
  } finally {
    held.open();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

// Feature 10, QA step 13: at 1,440 px the band rests in its place, and Clear your draft takes a press of the pointer there.
screenTest('draft scenario: Clear your draft takes a pointer press with the band at rest', async ({ page }) => {
  test.setTimeout(120_000);
  const root = await openReadyAt(page, '/sim', WIDE, 'dark');
  const field = root.getByTestId('write-your-own').locator('[data-quickstart-seed]');
  await field.fill(DRAFT.slice(0, 200));
  const held = root.getByTestId('start-held');
  await expect(held).toContainText(HELD);
  await scrollToBandPlace(root);
  await expect(startParts(root).bar).toHaveAttribute('data-stuck', 'false');
  const clear = held.getByRole('button', { name: 'Clear your draft', exact: true });
  await expect(clear).toBeVisible();
  // A press made with the pointer, as a visitor makes it.
  await clear.click({ timeout: 5_000 });
  await expect(field).toHaveValue('');
  await expect(root.getByTestId('start-held')).toHaveCount(0);
  await expect(activeStart(root)).toHaveCount(1);
});

// Feature 11, QA step 7: a sheet holds focus. A panel left open while the window narrows becomes a sheet, and takes focus then.
screenTest('feature 11: an open panel that becomes a sheet takes focus', async ({ page }) => {
  test.setTimeout(120_000);
  await openReadyAt(page, '/sim', WIDE, 'dark');
  const key = howKey(page);
  await key.click();
  const card = howCard(page);
  await expect(card).toBeVisible();
  // As a panel, the page behind it stays in reach of the keyboard.
  await key.focus();
  expect(await holdsFocus(card), 'focus is on the page while the card is a panel').toBe(false);
  await page.setViewportSize(PHONE);
  await expect(card).toHaveAttribute('aria-modal', 'true');
  await expect.poll(() => holdsFocus(card), { message: 'focus is inside the sheet' }).toBe(true);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

// Feature 14: how many people the colony holds depends on whose keys a run uses, which the server's settings say.
screenTest('feature 14: with the server’s settings unread and no key, the colony names no count', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/admin-config', (route: Route) => route.abort('failed'));
  try {
    const root = await openRun(page, PHONE, 'dark');
    await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis' })).toBeVisible();
    await expect(sizeParts(root).part.getByTestId('run-size-value')).toHaveText('2 leaders');
    const colony = root.getByTestId('shared-colony');
    await expect(colony).toBeVisible();
    await expect(colony.getByTestId('colony-caption'), 'no caption names a count of people').toHaveCount(0);
    await expect(colony.getByTestId('colony-figures')).toHaveCount(0);
    await expect(root.getByTestId('scenario-figures')).toHaveCount(0);
  } finally {
    await page.unroute('**/admin-config');
  }
});

// Feature 3, QA step 13, at a tablet's width: with the text doubled the figures do not fit one line, and none is cut.
screenTest('200 per cent text at 600 px: the scenario line’s figures stay inside the block', async ({ page }) => {
  test.setTimeout(120_000);
  const root = await openReadyAt(page, '/sim', sizeAt(600), 'light');
  const line = root.getByTestId('scenario-line');
  // At the page's own size the four figures stand on one line.
  const tops = () => root.getByTestId('scenario-figures').locator('[data-figure]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(await tops()).size, 'one line at the page’s own size').toBe(1);
  await doubleText(page);
  await expect(root.getByTestId('scenario-figures').locator('[data-figure]')).toHaveCount(4);
  expect(await outside(line, '[data-figure]'), 'every figure stands inside the block').toEqual([]);
  expect(new Set(await tops()).size, 'the figures take more than one line').toBeGreaterThan(1);
});
