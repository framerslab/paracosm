/**
 * Three more rows and windows of the Viz tab on a phone, found while the
 * rows of keys were made one row (phone-rows-and-grid-window.spec.ts).
 *
 * Every row of keys stays one row at every width from 320 px: fewer parts
 * first, then a More panel, then a row that scrolls sideways with a visible
 * fade at each edge that hides parts and a named Previous and Next key beside
 * it, each disabled at its end, moving about one view, gliding, and in one
 * step under reduced motion. No key is made smaller to fit. And the living
 * grid is never covered: on a phone the turn's words stand below it.
 *
 * - The play controls (the step keys, play, the scrub slider, the turn and
 *   the speed) are one row inside the window at 320, 390 and 1440 in both
 *   looks: no part stands outside the row or spills past it, the turn stays
 *   in the row, and on a phone every key is 44 px tall and wide and the
 *   slider is at least 44 px wide.
 * - The event row (its heading, its filter keys and its event marks) is one
 *   row at 320, 390 and 1440 in both looks. Its parts are wider than a
 *   phone, so there it scrolls sideways with an edge fade and its Previous
 *   and Next keys, 44 px on a phone, disabled at their ends, and each press
 *   moves the row.
 * - In the cohort view of the 24-actor run at 390 x 844, on every turn, a
 *   turn's words open below the living grid, and the grid keeps a window at
 *   least as tall as with the words folded, with at least as much of the
 *   grid in it.
 *
 * The stored runs are the real server's: the pair run
 * (tests-e2e/support/shared-run-server.ts) and the 24-actor run
 * (tests-e2e/support/cohort-run-server.ts), each played through the server's
 * own replay route.
 *
 * Pictures of each surface at 320, 390 and 1440 in both looks go to
 * test-pictures/phone-rows-more/, which CI uploads. Each is taken before that
 * surface's checks, so a failing run leaves them too.
 */
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { COHORT_SERVER, LOOKS, PAIR_SERVER, RUNS, pairSessionId, replayUrl, sessionIdByName, useLook, type Look } from '../support/forge-view-pages';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stored runs live on local servers of their own.');

test.use({ deviceScaleFactor: 2 });

const PICTURES = 'test-pictures/phone-rows-more';
/** The first of the 24-actor run's actors: tests-e2e/support/forge-fixtures.ts. */
const FIRST_ACTOR = 'Aria Chen';

/** The widths every row is read at: a desktop, a phone and the narrowest phone. */
const WIDTHS = [1440, 390, 320] as const;
/** Below this width a key is a phone's: 44 px tall and wide or more. */
const PHONE_BELOW = 900;
const PHONE_TARGET = 44;
const MIN_ROW_FONT = 15;

const sizeOf = (width: number) => ({ width, height: width < PHONE_BELOW ? 844 : 900 });

/** Waits until the page shows the look it was opened in. */
const lookShown = (page: Page, look: Look) =>
  page.waitForFunction((l) => document.documentElement.classList.contains('light') === (l === 'light'), look);

/** Waits until the replay has played in to its end: the page's run status reads Complete. */
const replayComplete = (page: Page, timeout: number) =>
  expect(page.locator('[role="status"][aria-label^="Complete."]').first()).toBeAttached({ timeout });

/** Lets the page lay out and paint twice after a change. */
const painted = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }));

/** A picture of the window, or of the band of it that holds `part` when the window is a desktop's. */
async function picture(page: Page, name: string, part?: Locator, pad = 160): Promise<void> {
  const path = `${PICTURES}/${name}.png`;
  const { width, height } = page.viewportSize()!;
  const box = part && width >= PHONE_BELOW ? await part.boundingBox() : null;
  if (!box) {
    await page.screenshot({ path, animations: 'disabled' });
    return;
  }
  const top = Math.max(0, Math.floor(box.y - pad));
  const bottom = Math.min(height, Math.ceil(box.y + box.height + pad));
  await page.screenshot({ path, animations: 'disabled', clip: { x: 0, y: top, width, height: bottom - top } });
}

/** Opens a stored run's replay on the Viz tab at one size in one look, played in to its end. */
async function openViz(page: Page, request: APIRequestContext, run: 'pair' | string, look: Look, size: { width: number; height: number }, timeout: number): Promise<void> {
  const server = run === 'pair' ? PAIR_SERVER : COHORT_SERVER;
  const id = run === 'pair' ? await pairSessionId(request) : await sessionIdByName(request, COHORT_SERVER, run);
  await page.setViewportSize(size);
  await useLook(page, look);
  // The Viz tab keeps its mode on the device: each open starts from LIVING.
  await page.addInitScript(() => { window.localStorage.removeItem('paracosm:gridMode'); });
  await page.goto(replayUrl(server, id, 'viz'));
  await lookShown(page, look);
  await replayComplete(page, timeout);
}

/** One row of parts as the page lays it out. */
interface RowRead {
  /** How many of the row's own parts are drawn. */
  parts: number;
  /** Every drawn part shares one line: the lowest top is above the highest bottom. */
  oneRow: boolean;
  /** The row scrolls sideways: its parts are wider than its window and it lets them scroll. */
  scrolls: boolean;
  clientWidth: number;
  scrollWidth: number;
  /** Parts that stand outside the row's window while the row does not scroll. */
  outside: string[];
  /** The row's window ends inside the page's. */
  inWindow: boolean;
  /** The mask the row is drawn through: its edge fade. */
  fade: string;
  /** Each key and menu in the row, with its size. */
  keys: Array<{ name: string; width: number; height: number }>;
  /** The row's sliders, with their width and whether each stands inside the row. */
  sliders: Array<{ name: string; width: number; height: number; inside: boolean }>;
  /** The type size of each visible text label or control. */
  labels: Array<{ name: string; fontSize: number }>;
  /** The row's words, as a reader sees them. */
  text: string;
}

async function readRow(row: Locator): Promise<RowRead> {
  return row.evaluate((el) => {
    const drawn = (c: Element) => {
      const r = c.getBoundingClientRect();
      return getComputedStyle(c).display !== 'none' && r.width > 0 && r.height > 0;
    };
    const named = (c: Element) => (c.getAttribute('aria-label') ?? (c as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 48);
    const shown = Array.from(el.children).filter(drawn);
    const rects = shown.map(c => c.getBoundingClientRect());
    const cs = getComputedStyle(el);
    const scrolls = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
    const box = el.getBoundingClientRect();
    const left = box.left + el.clientLeft;
    const right = left + el.clientWidth;
    const inside = (r: DOMRect) => r.left >= left - 0.5 && r.right <= right + 0.5;
    return {
      parts: shown.length,
      oneRow: rects.length <= 1 || Math.max(...rects.map(r => r.top)) < Math.min(...rects.map(r => r.bottom)),
      scrolls,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      outside: scrolls ? [] : shown.filter((_, i) => !inside(rects[i])).map(named),
      inWindow: box.left >= -0.5 && box.right <= document.documentElement.clientWidth + 0.5,
      fade: cs.getPropertyValue('mask-image') || cs.getPropertyValue('-webkit-mask-image') || 'none',
      keys: Array.from(el.querySelectorAll('button, select')).filter(drawn).map((c) => {
        const r = c.getBoundingClientRect();
        return { name: named(c), width: r.width, height: r.height };
      }),
      sliders: Array.from(el.querySelectorAll('input[type="range"]')).filter(drawn).map((c) => {
        const r = c.getBoundingClientRect();
        return { name: named(c), width: r.width, height: r.height, inside: inside(r) };
      }),
      labels: Array.from(el.querySelectorAll('span, button, select')).filter(drawn)
        .map(c => ({ name: named(c), fontSize: parseFloat(getComputedStyle(c).fontSize) })),
      text: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
    };
  });
}

/** The page does not scroll sideways. */
const pageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * Puts back any box around a row that a pointer action scrolled sideways, and
 * names each one in the test's annotations.
 */
async function unshift(row: Locator): Promise<void> {
  const moved = await row.evaluate((el) => {
    const out: string[] = [];
    for (let box = el.parentElement; box; box = box.parentElement) {
      if (box.scrollLeft === 0) continue;
      out.push(`${box.tagName.toLowerCase()}${box.id ? `#${box.id}` : ''}.${String(box.className).split(/\s+/).filter(Boolean)[0] ?? ''} at ${box.scrollLeft} px`);
      box.scrollLeft = 0;
    }
    return out;
  });
  if (moved.length) test.info().annotations.push({ type: 'scrolled sideways, put back', description: moved.join('; ') });
}

/** The keys of a row that scrolls: its named Previous and Next keys, beside the row. */
const previousKey = (row: Locator) => row.locator('xpath=..').getByRole('button', { name: /^Show previous / });
const nextKey = (row: Locator) => row.locator('xpath=..').getByRole('button', { name: /^Show next / });

/**
 * One row at one width: drawn, one row, inside the window, with no part
 * outside it while it does not scroll, and the page not scrolling sideways.
 * Soft checks, so one run names every row that misses.
 */
async function expectOneRow(page: Page, row: Locator, where: string): Promise<RowRead> {
  await unshift(row);
  const read = await readRow(row);
  expect.soft(read.parts, `${where}: the row draws its parts`).toBeGreaterThan(0);
  expect.soft(read.oneRow, `${where}: the row is one row`).toBe(true);
  expect.soft(read.outside, `${where}: no part stands outside the row while it does not scroll`).toEqual([]);
  expect.soft(read.inWindow, `${where}: the row ends inside the window`).toBe(true);
  expect.soft(await pageScroll(page), `${where}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
  return read;
}

/**
 * A row that scrolls: an edge fade, and its named Previous and Next keys,
 * 44 px tall and wide on a phone. True when both keys are there.
 */
async function expectScrollParts(row: Locator, read: RowRead, where: string, width: number): Promise<boolean> {
  const previous = previousKey(row);
  const next = nextKey(row);
  expect.soft(read.fade, `${where}: the row that scrolls fades at its edge`).toContain('gradient');
  await expect.soft(previous, `${where}: the row that scrolls has its Previous key`).toBeVisible();
  await expect.soft(next, `${where}: the row that scrolls has its Next key`).toBeVisible();
  const both = (await previous.count()) === 1 && (await next.count()) === 1;
  if (both && width < PHONE_BELOW) {
    for (const key of [previous, next]) {
      const box = await key.boundingBox();
      const name = await key.getAttribute('aria-label');
      expect.soft(box?.height ?? 0, `${where}: the row's ${name} key is 44 px tall on a phone`).toBeGreaterThanOrEqual(PHONE_TARGET - 0.5);
      expect.soft(box?.width ?? 0, `${where}: the row's ${name} key is 44 px wide on a phone`).toBeGreaterThanOrEqual(PHONE_TARGET - 0.5);
    }
  }
  return both;
}

/**
 * Presses a scroll key and waits until the row has moved and then stands
 * still across two frames, so the next read sees the glide's end. The keys
 * are enabled only while more than 1 px is left, so every press moves the row.
 */
async function pressAndSettle(row: Locator, key: Locator, message: string): Promise<void> {
  const from = await row.evaluate(el => el.scrollLeft);
  await key.click();
  await expect.poll(() => row.evaluate((el, start) => new Promise<boolean>((resolve) => {
    const at = el.scrollLeft;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.abs(at - start) > 0.25 && el.scrollLeft === at)));
  }), from), { message }).toBe(true);
}

/**
 * The Previous and Next keys of a row that scrolls: disabled at their ends,
 * each press about one view, a glide with motion and one step without.
 */
async function expectScrollKeys(page: Page, row: Locator, where: string): Promise<void> {
  const previous = previousKey(row);
  const next = nextKey(row);
  await row.evaluate((el) => { el.scrollLeft = 0; });
  await painted(page);
  await expect.soft(previous, `${where}: Previous is disabled at the start`).toBeDisabled();
  await expect.soft(next, `${where}: Next is enabled at the start`).toBeEnabled();

  // A press glides: the row scrolls through several frames to its place.
  const counted = await row.evaluate((el) => {
    const w = window as unknown as { __rowScrolls: number; __rowCounter?: { el: Element; count: () => void } };
    if (w.__rowCounter) w.__rowCounter.el.removeEventListener('scroll', w.__rowCounter.count);
    w.__rowScrolls = 0;
    const count = () => { w.__rowScrolls += 1; };
    el.addEventListener('scroll', count);
    w.__rowCounter = { el, count };
    return { view: el.clientWidth, end: el.scrollWidth - el.clientWidth };
  });
  await pressAndSettle(row, next, `${where}: Next moves the row and it comes to rest`);
  await expect.poll(() => row.evaluate(el => el.scrollLeft), { message: `${where}: Next moves about one view` })
    .toBeGreaterThanOrEqual(Math.min(counted.view * 0.5, counted.end) - 1);
  expect.soft(await page.evaluate(() => (window as unknown as { __rowScrolls: number }).__rowScrolls), `${where}: the press glides through several frames`).toBeGreaterThan(1);
  await expect.soft(previous, `${where}: Previous is enabled once the row has moved`).toBeEnabled();

  // To the end: Next is disabled there.
  for (let i = 0; i < 40 && !(await next.isDisabled()); i += 1) {
    await pressAndSettle(row, next, `${where}: Next press ${i + 2} moves the row and it comes to rest`);
  }
  await expect.soft(next, `${where}: Next is disabled at the end`).toBeDisabled();
  expect.soft(await row.evaluate(el => el.scrollWidth - el.clientWidth - el.scrollLeft), `${where}: Next brought the row to its end`).toBeLessThanOrEqual(1);

  // Previous moves it back.
  await pressAndSettle(row, previous, `${where}: Previous moves the row back and it comes to rest`);
  await expect.soft(next, `${where}: Next is enabled once the row has moved back`).toBeEnabled();

  // Under reduced motion a press moves the row in one step: Previous, or
  // Next when the row stands at its start again.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const key = (await previous.isEnabled()) ? previous : next;
  const before = await row.evaluate(el => el.scrollLeft);
  await key.click();
  const afterPress = await row.evaluate(el => el.scrollLeft);
  expect.soft(Math.abs(afterPress - before), `${where}: under reduced motion ${await key.getAttribute('aria-label')} moves the row at once`).toBeGreaterThan(1);
  await painted(page);
  expect.soft(await row.evaluate(el => el.scrollLeft), `${where}: under reduced motion the row does not glide on`).toBe(afterPress);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await row.evaluate((el) => { el.scrollLeft = 0; });
}

// ── The Viz tab's play controls ──────────────────────────────────────────

/** The Viz tab's play controls: the row that holds the Previous turn key. */
const playRow = (page: Page) => page.getByRole('button', { name: 'Previous turn', exact: true }).locator('xpath=..');

function expectReadableRow(read: RowRead, where: string): void {
  const small = read.labels.filter(label => label.fontSize < MIN_ROW_FONT)
    .map(label => `${label.name}: ${label.fontSize} px`);
  expect.soft(small, `${where}: the row's labels are at least ${MIN_ROW_FONT} px`).toEqual([]);
}

function expectPhoneKeys(read: RowRead, where: string): void {
  const small = read.keys.filter(key => key.width < PHONE_TARGET - 0.5 || key.height < PHONE_TARGET - 0.5)
    .map(key => `${key.name}: ${key.width.toFixed(1)} × ${key.height.toFixed(1)} px`);
  expect.soft(small, `${where}: every key is at least ${PHONE_TARGET} px wide and tall on a phone`).toEqual([]);
}

for (const look of LOOKS) {
  test(`the Viz play controls are one row inside the window at 320, 390 and 1440, with 44 px keys on a phone, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(240_000);
    await openViz(page, request, 'pair', look, sizeOf(1440), 60_000);
    for (const width of WIDTHS) {
      await test.step(`${width}`, async () => {
        await page.setViewportSize(sizeOf(width));
        await painted(page);
        const row = playRow(page);
        await expect(row).toBeVisible();
        await row.evaluate((el) => { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        await painted(page);
        await picture(page, `${width}-${look}-viz-play-row`, row, 220);
        const where = `${width}, ${look}, the play controls`;
        const read = await expectOneRow(page, row, where);
        expectReadableRow(read, where);
        expect.soft(read.scrolls, `${where}: the row fits without scrolling`).toBe(false);
        expect.soft(read.scrollWidth, `${where}: no part spills past the row (${read.scrollWidth} px of parts in ${read.clientWidth} px)`).toBeLessThanOrEqual(read.clientWidth + 1);
        expect.soft(read.text, `${where}: the row tells the turn`).toMatch(/T\d+\/\d+/);
        const slider = read.sliders.find(s => s.name === 'Scrub timeline');
        expect.soft(slider?.inside, `${where}: the scrub slider stands inside the row`).toBe(true);
        expect.soft(slider?.width ?? 0, `${where}: the scrub slider is at least 44 px wide`).toBeGreaterThanOrEqual(PHONE_TARGET - 0.5);
        if (width < PHONE_BELOW) {
          expectPhoneKeys(read, where);
          expect.soft(slider?.height ?? 0, `${where}: the scrub slider is at least 44 px tall on a phone`).toBeGreaterThanOrEqual(PHONE_TARGET - 0.5);
        }
      });
    }
  });
}

// ── The Viz tab's event row ──────────────────────────────────────────────

/** The Viz tab's event row: its heading, its filter keys and its event marks. */
const eventRow = (page: Page) => page.locator('[aria-label="Event filter"]');

for (const look of LOOKS) {
  test(`the Viz event row is one row at 320, 390 and 1440, and where it scrolls it has its named Previous and Next keys, 44 px on a phone, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(240_000);
    await openViz(page, request, 'pair', look, sizeOf(1440), 60_000);
    for (const width of WIDTHS) {
      await test.step(`${width}`, async () => {
        await page.setViewportSize(sizeOf(width));
        await painted(page);
        const row = eventRow(page);
        await expect(row).toHaveCount(1);
        await expect(row).toBeVisible();
        await row.evaluate((el) => { el.scrollLeft = 0; });
        await painted(page);
        await picture(page, `${width}-${look}-viz-event-row`, row, 220);
        const where = `${width}, ${look}, the event row`;
        const read = await expectOneRow(page, row, where);
        expectReadableRow(read, where);
        if (width < PHONE_BELOW) expectPhoneKeys(read, where);
        // The test's own ground: on a phone the heading, the five filter keys
        // and the marks are wider than the row.
        if (width < PHONE_BELOW) expect(read.scrolls, `${where}: its parts are wider than a phone (${read.scrollWidth} px in ${read.clientWidth} px)`).toBe(true);
        if (read.scrolls) {
          if (await expectScrollParts(row, read, where, width)) await expectScrollKeys(page, row, where);
        } else {
          await expect.soft(previousKey(row), `${where}: a row that fits shows no Previous key`).toHaveCount(0);
          await expect.soft(nextKey(row), `${where}: a row that fits shows no Next key`).toHaveCount(0);
        }
      });
    }
  });
}

// ── The cohort view's grid window under the turn's words ────────────────

const foldKey = (page: Page) => page.getByRole('button', { name: 'Collapse per-actor outcomes', exact: true });
const openKey = (page: Page) => page.getByRole('button', { name: 'Expand per-actor outcomes', exact: true });
const stepBack = (page: Page) => page.getByRole('button', { name: 'Previous turn', exact: true });
/** The first actor's living grid, on one turn. */
const firstGrid = (page: Page, turn: number) => page.getByRole('img', { name: new RegExp(`^${FIRST_ACTOR} colony, turn ${turn}\\.`) });

/** The cohort view as it stands: its grid's window, how much of the first actor's grid shows in it, and where that actor's words stand. */
interface CohortRead {
  /** The height of the cohort grid's scroll window. */
  window: number;
  /** How much of the first actor's living grid shows on the screen, inside every box that clips it. */
  shown: number;
  height: number;
  /**
   * The bottom of the part of the first actor's living grid that shows. The
   * grid can be taller than its window, which then scrolls: the words stand
   * below the grid when they stand below what the window shows of it. When
   * none of it shows, the bottom of its window, or its own top where that is
   * higher.
   */
  gridBottom: number;
  /** The top of the first actor's words for the turn, or null when they are not on the page. */
  wordsTop: number | null;
}

/** Reads the cohort view with every box around the grid scrolled back to its top. */
async function readCohort(page: Page): Promise<CohortRead> {
  return page.evaluate((name) => {
    const track = document.querySelector('.viz-content [role="region"][aria-label^="Cohort swarm grid"]') as HTMLElement | null;
    const canvas = Array.from(document.querySelectorAll('.viz-content canvas[role="img"]'))
      .find(c => (c.getAttribute('aria-label') ?? '').startsWith(`${name} colony, turn `) && c.getBoundingClientRect().height > 0) as HTMLElement | undefined;
    if (!track || !canvas) return { window: -1, shown: -1, height: 0, gridBottom: -1, wordsTop: null };
    const words = Array.from(document.querySelectorAll('[role="status"] div'))
      .find(d => (d.textContent ?? '').startsWith(`${name}: `)) as HTMLElement | undefined;
    for (const el of [canvas, words]) {
      for (let box = el?.parentElement ?? null; box; box = box.parentElement) box.scrollTop = 0;
    }
    document.documentElement.scrollTop = 0;
    const c = canvas.getBoundingClientRect();
    let top = Math.max(0, c.top);
    let bottom = Math.min(window.innerHeight, c.bottom);
    for (let box = canvas.parentElement; box && box !== document.documentElement; box = box.parentElement) {
      const cs = getComputedStyle(box);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = box.getBoundingClientRect();
      const boxTop = b.top + box.clientTop;
      top = Math.max(top, boxTop);
      bottom = Math.min(bottom, boxTop + box.clientHeight);
    }
    return {
      window: track.clientHeight,
      shown: Math.max(0, bottom - top),
      height: c.height,
      gridBottom: bottom > top ? bottom : Math.min(bottom, c.top),
      wordsTop: words ? words.getBoundingClientRect().top : null,
    };
  }, FIRST_ACTOR);
}

for (const look of LOOKS) {
  test(`in the cohort view at 390 x 844 a turn's words open below the living grid and the grid keeps its window, on every turn, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(300_000);
    await openViz(page, request, RUNS.dozens, look, { width: 390, height: 844 }, 90_000);
    await expect(page.getByRole('region', { name: /^Cohort swarm grid: 24 actors/ }), 'the 24-actor run opens in the cohort view').toBeVisible();
    const label = await page.getByRole('img', { name: new RegExp(`^${FIRST_ACTOR} colony, turn \\d+\\.`) }).first().getAttribute('aria-label');
    const last = Number(/turn (\d+)\./.exec(label ?? '')?.[1]);
    expect(last, 'the run has turns to step through').toBeGreaterThan(1);

    // Each turn from the last back to the first: the grid's window and how
    // much of the grid shows in it with the words folded and open, and where
    // the words stand.
    const turns: Array<{ turn: number; folded: CohortRead; open: CohortRead }> = [];
    for (let turn = last; turn >= 1; turn -= 1) {
      if (turn < last) {
        await stepBack(page).click();
        await expect(firstGrid(page, turn)).toBeAttached();
        const latest = page.getByRole('button', { name: `Jump to latest turn (T${last})` });
        const latestBox = await latest.boundingBox();
        const rowBox = await playRow(page).boundingBox();
        expect.soft(latestBox, `T${turn}: the jump to the latest turn is available`).not.toBeNull();
        if (latestBox && rowBox) {
          const overlaps = latestBox.y < rowBox.y + rowBox.height && latestBox.y + latestBox.height > rowBox.y;
          expect.soft(overlaps, `T${turn}: the jump to the latest turn leaves the play controls uncovered`).toBe(false);
        }
      }
      // A cohort run opens with the words folded.
      if (await foldKey(page).isVisible()) await foldKey(page).click();
      await expect(openKey(page)).toBeVisible();
      await painted(page);
      const folded = await readCohort(page);
      await openKey(page).click();
      await expect(foldKey(page)).toBeVisible();
      await painted(page);
      const open = await readCohort(page);
      turns.push({ turn, folded, open });
      if (turn > 1) {
        await foldKey(page).click();
        await expect(openKey(page)).toBeVisible();
      }
    }

    // Pictures on the first turn with the words open: the window as it opens,
    // the words scrolled into view, then folded; and at 1440 with them open.
    await picture(page, `390-${look}-cohort-words-open`);
    const words = page.locator('[role="status"] div').filter({ hasText: new RegExp(`^${FIRST_ACTOR}: `) }).first();
    await words.evaluate((el) => { el.scrollIntoView({ block: 'end', inline: 'nearest' }); });
    await painted(page);
    await picture(page, `390-${look}-cohort-words-open-scrolled`);
    await readCohort(page);
    await foldKey(page).click();
    await painted(page);
    await picture(page, `390-${look}-cohort-words-folded`);
    await openKey(page).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await painted(page);
    await picture(page, `1440-${look}-cohort-words-open`);

    // Read the first actor's living canvas against the whole window with
    // the turn words in both states.
    test.info().annotations.push({
      type: 'cohort grid shown at 390 x 844, words folded',
      description: turns.map(({ turn, folded }) => `T${turn}: ${folded.shown.toFixed(1)} px of the grid in a ${folded.window.toFixed(1)} px window`).join('; '),
    });
    for (const { turn, folded, open } of turns) {
      expect.soft(folded.window, `T${turn}: the cohort grid has its window with the words folded`).toBeGreaterThan(0);
      expect.soft(folded.shown, `T${turn}: the whole cohort grid is in view with the words folded`).toBeGreaterThanOrEqual(folded.height - 0.5);
      expect.soft(open.wordsTop, `T${turn}: the words are on the page once opened`).not.toBeNull();
      if (open.wordsTop !== null) {
        expect.soft(open.wordsTop, `T${turn}: the words open below the living grid (words from ${open.wordsTop.toFixed(1)} px, the grid shown to ${open.gridBottom.toFixed(1)} px)`).toBeGreaterThanOrEqual(open.gridBottom - 0.5);
      }
      expect.soft(open.window, `T${turn}: with the words open the grid's window is ${open.window.toFixed(1)} px tall, at least the ${folded.window.toFixed(1)} px it is with them folded`).toBeGreaterThanOrEqual(folded.window - 0.5);
      expect.soft(open.shown, `T${turn}: with the words open ${open.shown.toFixed(1)} px of the grid shows, at least the ${folded.shown.toFixed(1)} px with them folded`).toBeGreaterThanOrEqual(folded.shown - 0.5);
    }
  });
}

// ── Review findings: the row's room, the turn's time, the "+N more" line ──

test('the event row shows its Previous and Next keys as soon as its parts are wider than the room inside its padding', async ({ page, request }) => {
  test.setTimeout(180_000);
  await openViz(page, request, 'pair', 'dark', sizeOf(1440), 60_000);
  const row = eventRow(page);
  await expect(row).toBeVisible();
  // What the row needs for its parts and its own padding; the strip's
  // padding and the row's margins; the strip's width in the window.
  const measure = () => row.evaluate((el) => {
    el.scrollLeft = 0;
    const box = el.parentElement!;
    const cs = getComputedStyle(el);
    const bs = getComputedStyle(box);
    const rects = Array.from(el.children).map(c => c.getBoundingClientRect()).filter(r => r.width > 0);
    const parts = Math.max(...rects.map(r => r.right)) - Math.min(...rects.map(r => r.left));
    return {
      needed: Math.ceil(parts + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)),
      inside: parseFloat(bs.paddingLeft) + parseFloat(bs.paddingRight) + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight),
      box: box.clientWidth,
      viewport: window.innerWidth,
    };
  });
  // A strip whose room inside its padding is 8 px short of what the row
  // needs: its own width is the parts' width less 8 px, plus its padding
  // and the row's margins.
  const first = await measure();
  const target = first.needed - 8 + first.inside;
  let at = first;
  for (let i = 0; i < 3 && Math.abs(at.box - target) > 0.5; i += 1) {
    await page.setViewportSize({ width: Math.round(at.viewport + target - at.box), height: 844 });
    await painted(page);
    at = await measure();
  }
  // The test's own ground: the strip stands at that width, and the row's parts do not fit in it.
  expect(Math.abs(at.box - target), `the strip is ${at.box} px wide, the ${target} px that leaves the row 8 px short (window ${at.viewport} px)`).toBeLessThanOrEqual(0.5);
  await picture(page, `${at.viewport}-dark-viz-event-row-8px-short`, row, 220);
  const read = await readRow(row);
  expect(read.scrollWidth, `the row's parts (${read.scrollWidth} px) are wider than the row (${read.clientWidth} px)`).toBeGreaterThan(read.clientWidth + 1);
  const where = `${at.viewport}, dark, the event row 8 px short of room`;
  if (await expectScrollParts(row, read, where, at.viewport)) await expectScrollKeys(page, row, where);
});

test('on a phone the play controls keep the turn\'s time when the turn has no title and the banner above it is not drawn', async ({ page, request }) => {
  test.setTimeout(180_000);
  const id = await pairSessionId(request);
  // The stored pair run as the server replays it, with turn 2's title taken
  // out, as the orchestrator sends a turn that has no events.
  await page.route(url => url.pathname === `/sessions/${id}/replay`, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).split('\n\n').map((chunk) => {
      if (!/^event: sim$/m.test(chunk)) return chunk;
      return chunk.replace(/^data: (.+)$/m, (_line, json: string) => {
        const frame = JSON.parse(json) as { type?: string; data?: { turn?: number; title?: string } };
        if ((frame.type === 'turn_start' || frame.type === 'event_start') && frame.data?.turn === 2) frame.data.title = '';
        return `data: ${JSON.stringify(frame)}`;
      });
    }).join('\n\n');
    await route.fulfill({ response, body });
  });
  await openViz(page, request, 'pair', 'dark', sizeOf(1440), 60_000);
  // The test's own ground: on turn 2 the banner is not drawn, and the play
  // controls name the turn and its time at 1440.
  await expect(page.getByRole('img', { name: /^Aria Chen colony, turn 2\./ })).toBeAttached();
  await expect(page.getByRole('status', { name: 'Current turn narrative' }), 'turn 2 has no title, so its banner is not drawn').toHaveCount(0);
  const wide = (await readRow(playRow(page))).text;
  const label = /T2\/2 · \S+/.exec(wide)?.[0];
  expect(label, `the play controls name turn 2 and its time at 1440 ("${wide}")`).toBeTruthy();

  for (const width of [390, 320] as const) {
    await page.setViewportSize(sizeOf(width));
    await painted(page);
    await picture(page, `${width}-dark-viz-play-row-untitled-turn`);
    const read = await readRow(playRow(page));
    expect.soft(read.text, `${width}: with no banner above, the play controls still give the turn's time ("${label}")`).toContain(label!);
  }
});

test('a titled turn shows its time in the banner at every width and in the play row on desktop', async ({ page, request }) => {
  test.setTimeout(180_000);
  await openViz(page, request, 'pair', 'dark', sizeOf(1440), 60_000);
  const narrative = page.getByRole('status', { name: 'Current turn narrative' });
  const bannerTime = narrative.getByText(/^T2 · \S+$/, { exact: true });
  await expect(bannerTime).toBeVisible();
  const time = (await bannerTime.innerText()).split('·')[1].trim();
  const timedTurn = `T2/2 · ${time}`;
  const turn = playRow(page).getByText('T2/2', { exact: false });

  for (const width of WIDTHS) {
    await page.setViewportSize(sizeOf(width));
    await expect(bannerTime).toBeVisible();
    await expect.soft(turn, `${width}: the play row's label for the titled turn`)
      .toHaveText(width === 1440 ? timedTurn : 'T2/2', { useInnerText: true });
  }
});

test('on a phone the turn words of the 24-actor run point to the rest of its actors in the view that shows them', async ({ page, request }) => {
  test.setTimeout(180_000);
  await openViz(page, request, RUNS.dozens, 'dark', { width: 390, height: 844 }, 90_000);
  const more = page.locator('[role="status"] div').filter({ hasText: /^\+\d+ more/ });

  // The cohort view: the words stand below the cohort grid, so the rest are above them.
  await openKey(page).click();
  await expect(more).toHaveCount(1);
  expect.soft(await more.textContent(), 'in the cohort view the rest of the actors are in the cohort grid above the words').toMatch(/cohort grid above/);
  await foldKey(page).click();

  // Focus pair: no cohort grid is on screen, so the line names the view that shows every actor.
  await page.getByRole('tab', { name: 'Focus pair', exact: true }).click();
  await expect(page.getByRole('region', { name: /^Cohort swarm grid/ })).toHaveCount(0);
  await openKey(page).click();
  await expect(more).toHaveCount(1);
  const words = await more.textContent();
  await picture(page, '390-dark-focus-pair-more-line');
  expect.soft(words, `under Focus pair no cohort grid is on screen ("${words}")`).not.toMatch(/cohort grid (above|below)/);
  expect.soft(words, `under Focus pair the line names the view with every actor ("${words}")`).toMatch(/All 24 actors/);
});
