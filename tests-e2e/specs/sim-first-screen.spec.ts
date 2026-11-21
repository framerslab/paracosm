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
 * - Every word and glyph meets its figure, every row stays one row, and the
 *   automated check finds no WCAG 2.2 A or AA failure.
 *
 * Each width and look saves pictures into test-pictures/sim-first-screen/,
 * which CI uploads.
 */
import { test, expect, type BrowserContext, type Locator, type Page, type Route, type TestInfo } from '@playwright/test';
import { FIRST_SCREEN, axeFindings, measureReadability, rowsOnOneRow } from '../support/first-screen-measure.js';

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
 */
function screenTest(
  title: string,
  body: (fixtures: { page: Page; context: BrowserContext }, info: TestInfo) => Promise<void>,
): void {
  const index = defined++;
  test(title, async ({ page, context }, info) => {
    await context.setExtraHTTPHeaders({ 'x-real-ip': `198.51.100.${1 + index * 3 + info.retry}` });
    await page.addInitScript(() => {
      // The first visit's tour would cover the screen.
      window.localStorage.setItem('paracosm:tourSeen', '1');
    });
    await body({ page, context }, info);
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
  await page.addInitScript(() => {
    const w = window as unknown as { marsPainted: boolean };
    w.marsPainted = false;
    new MutationObserver(() => {
      const root = document.querySelector('[data-testid="run-first-screen"]');
      if (root?.textContent?.includes('Mars Genesis')) w.marsPainted = true;
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
      await expect(root.locator('[data-mark="broken-link"]')).toBeVisible();
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
      await expect(root.locator('[data-mark="broken-link"]')).toBeVisible();
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
