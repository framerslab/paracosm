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
            await expect(rows.nth(t).getByTestId('score-name')).toHaveText(trait);
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
        const cells = table.getByRole('row', { name: new RegExp(`^${trait}\\b`) }).getByRole('cell');
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
        const showAria = leaders.getByRole('tab', { name: 'Show Aria Chen' });
        const showDietrich = leaders.getByRole('tab', { name: 'Show Dietrich Voss' });
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
          const row = table.getByRole('row', { name: new RegExp(`^${trait}\\b`) });
          await expect(row.getByRole('rowheader')).toHaveText(trait);
          await expect(row.getByRole('cell')).toHaveText([ARIA.scores[t], DIETRICH.scores[t]]);
        }
        await expectNoSidewaysScroll(page, root);
        await tabs.nth(0).scrollIntoViewIfNeeded();
        await picture(page, `leaders-phone-${width}-${look}-leader-1`);

        // Pressing the second key changes the card and leaves the page where it was.
        await showDietrich.scrollIntoViewIfNeeded();
        const before = { scroll: await page.evaluate(() => window.scrollY), key: await box(showDietrich) };
        await showDietrich.click();
        await expect(showDietrich).toHaveAttribute('aria-selected', 'true');
        await expect(showAria).toHaveAttribute('aria-selected', 'false');
        await expect(card).toHaveCount(1);
        await expect(card.getByTestId('leader-head')).toHaveText(DIETRICH.title);
        expect(await card.getByTestId('leader-orders').evaluate((el) => el.textContent)).toBe(written[1].instructions);
        const after = { scroll: await page.evaluate(() => window.scrollY), key: await box(showDietrich) };
        expect(after.scroll).toBe(before.scroll);
        expect(Math.abs(after.key.y - before.key.y)).toBeLessThanOrEqual(1);
        // The table is the same whichever card shows.
        await expect(card.getByRole('table').getByRole('columnheader')).toHaveText(['1 Aria Chen', '2 Dietrich Voss']);
        await expect(card.getByRole('table').getByRole('row', { name: /^Openness\b/ }).getByRole('cell')).toHaveText(['0.95', '0.25']);
        await picture(page, `leaders-phone-${width}-${look}-leader-2`);

        // The arrow keys move between the two keys.
        await showDietrich.press('ArrowLeft');
        await expect(showAria).toBeFocused();
        await expect(showAria).toHaveAttribute('aria-selected', 'true');
        await expect(card.getByTestId('leader-head')).toHaveText(ARIA.title);
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
        const before = await box(leaders);
        await leaders.scrollIntoViewIfNeeded();
        await picture(page, `leaders-loading-${size.width}-${look}`);

        release();
        await expect(root.getByRole('heading', { level: 1, name: 'Mars Genesis' })).toBeVisible();
        await expect(shapes).toHaveCount(0);
        if (size.width >= 1100) await expect(leaders.getByRole('article')).toHaveCount(2);
        else await expect(leaders.getByRole('tabpanel')).toHaveCount(1);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const after = await box(leaders);
        // The cards replace the shapes with no jump: under a tenth of the window, and a shift score under 0.1.
        expect(Math.abs(after.height - before.height)).toBeLessThan(size.height * 0.1);
        expect(Math.abs(after.y - before.y)).toBeLessThan(size.height * 0.1);
        expect(await shiftOf(page)).toBeLessThan(0.1);
        await page.unroute('**/scenario');
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
