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
