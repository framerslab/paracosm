/**
 * The Viz tab on a phone and on a short screen: the living grid whole at
 * first sight, the keyboard legend on one row, and the words of its rows of
 * keys at 15 px.
 *
 * The living grid is never covered or hidden, so on a phone it shows whole
 * at first sight of the Viz panel; on a screen too short for the controls
 * and the grid together the panel scrolls as one, so every control and the
 * turn's outcomes stay in reach. Every row of keys and every legend stays
 * one row at every width from 320 px: fewer parts first, with the rest one
 * key away, then a More panel, then a row that scrolls sideways. No word is
 * made smaller and no phone key narrower than 44 px to make a row fit.
 *
 * - At 390 x 844, on every turn of the stored pair run with the turn's words
 *   open and folded, the whole grid is in view before any scroll: inside the
 *   window and every box around it, at its drawn size, with nothing drawn
 *   over it. The live replays showed 0 to 35 px of their 244 px grid there,
 *   in a 135 to 201 px window that began 473 to 538 px down, under the
 *   colony's stats card.
 * - At 390 x 339 (a phone with its browser's bars, or on its side) the grid
 *   keeps a usable window: scrolled to it, at least 120 px of it shows, and
 *   it fills the Viz panel's view. The mouse wheel over the panel brings the
 *   turn's outcomes into view, where they read with nothing over them, and
 *   at the panel's end the play controls and the legend are in view.
 * - At 320, 390, 600 and 1440 the keyboard legend is one row inside the
 *   window. Where it shows fewer than its six keys, one key opens the help
 *   overlay, whose Keyboard section lists them all. From the keyboard the
 *   key moves focus into the overlay, so the arrow keys leave the turn
 *   behind it alone, and Escape brings focus back to the key.
 * - At 844 x 339 (a phone on its side with its browser's bars) the grids
 *   stand side by side under the same controls: the grid keeps the same
 *   usable window, and the turn's outcomes, the play controls and the
 *   legend scroll into view.
 * - At 320, 390, 600 and 1440 every word on the Viz toolbar's keys, in
 *   LIVING and FORGE, on its More panel's keys, on the play controls and in
 *   the legend computes to 15 px or more; each of those rows is one row
 *   inside the window; and below 900 px every key in them is 44 px tall and
 *   wide. On a turn before the last the Latest key covers no control of the
 *   play controls; on a phone it stands in the flow above them, 44 px tall
 *   and wide, inside the window, its words at 15 px.
 *
 * The stored runs are tests-e2e/support/viz-replay-server.ts's, served with
 * VIZ_REPLAY_EVENT_STARTS=1 on a port of their own: the hosted demo's six
 * recorded turns of Aria Chen against Dietrich Voss, with their long
 * headlines, and each turn's event_start frame as a live run sends it, so
 * the Viz tab draws the event row the live replays draw. That gives the
 * grid as many rows above it as the live replays had; the other stored runs
 * draw no event row.
 *
 * Pictures at 390 x 844, 390 x 339, 844 x 339, 320, 600 and 1440 in both looks go to
 * test-pictures/viz-rows-type/, which CI uploads. Each is taken before its
 * checks, so a failing run leaves them too.
 */
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { LOOKS, useLook, type Look } from '../support/forge-view-pages';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stored runs live on local servers of their own.');

test.use({ deviceScaleFactor: 2 });

const PICTURES = 'test-pictures/viz-rows-type';
/** The stored runs with each turn's event_start frame: viz-replay-server.ts with VIZ_REPLAY_EVENT_STARTS=1. */
const SERVER = 'http://127.0.0.1:3472';
const ARIA = 'Aria Chen';

const PHONE = { width: 390, height: 844 };
const SHORT = { width: 390, height: 339 };
/** A phone on its side with its browser's bars: as wide as the rows' 844 x 390, as short as the short screen. */
const SIDE = { width: 844, height: 339 };
/** Below this width a key is a phone's: 44 px tall and wide or more. */
const PHONE_BELOW = 900;
const PHONE_TARGET = 44;
/** The smallest size a word in these rows may compute to. */
const READ_SIZE = 15;
/** The least of the grid a short screen shows at once: about half its height on a phone. */
const USABLE = 120;
/** The grid is drawn at its own size, never shrunk to fit: at least this tall on a phone. */
const GRID_AT_LEAST = 200;
/** The keyboard legend's keys: ? help, 1-5 mode, the arrows, space, click and esc. */
const LEGEND_KEYS = 6;

const sizeAt = (width: number) => ({ width, height: width < PHONE_BELOW ? 844 : 900 });

/** Waits until the page shows the look it was opened in. */
const lookShown = (page: Page, look: Look) =>
  page.waitForFunction((l) => document.documentElement.classList.contains('light') === (l === 'light'), look);

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

// ── The stored run and its controls ──────────────────────────────────────

/** The id of the stored run with two commanders, and its number of turns, from the server's own replay route. */
async function pairRun(request: APIRequestContext): Promise<{ id: string; turns: number }> {
  const res = await request.get(`${SERVER}/sessions`);
  expect(res.ok()).toBe(true);
  const { sessions } = await res.json() as { sessions: Array<{ id: string }> };
  for (const { id } of sessions) {
    const replay = await request.get(`${SERVER}/sessions/${encodeURIComponent(id)}/replay`);
    expect(replay.ok()).toBe(true);
    const frames: Array<{ type: string; leader: string; data: Record<string, unknown> }> = [];
    for (const chunk of (await replay.text()).split('\n\n')) {
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (event === 'sim' && data) frames.push(JSON.parse(data));
    }
    if (new Set(frames.map(f => f.leader)).size !== 2) continue;
    // The test's own ground: the run carries the frames that draw the event row.
    expect(frames.filter(f => f.type === 'event_start').length, 'the stored run carries its turns\' event_start frames').toBeGreaterThan(0);
    return { id, turns: Math.max(...frames.filter(f => f.type === 'systems_snapshot').map(f => Number(f.data.turn))) };
  }
  throw new Error('The server stores no run with two commanders.');
}

/** Aria Chen's living grid on one turn. */
const gridOf = (page: Page, turn: number) => page.getByRole('img', { name: new RegExp(`^${ARIA} colony, turn ${turn}\\.`) });
const foldKey = (page: Page) => page.getByRole('button', { name: 'Collapse per-actor outcomes', exact: true });
const openKey = (page: Page) => page.getByRole('button', { name: 'Expand per-actor outcomes', exact: true });
const stepBack = (page: Page) => page.getByRole('button', { name: 'Previous turn', exact: true });
const stepOn = (page: Page) => page.getByRole('button', { name: 'Next turn', exact: true });
const eventRow = (page: Page) => page.locator('[aria-label="Event filter"]');
/** The turn's outcomes below the grid on a phone, and their first commander's line. */
const outcomes = (page: Page) => page.getByRole('status', { name: 'Turn outcomes' });
const ariaLine = (page: Page) => outcomes(page).locator('div').filter({ hasText: new RegExp(`^A: ${ARIA}`) }).first();
/** The first commander's line wherever the turn's words stand: below the grid on a phone, in the turn banner wider. */
const ariaLineAnywhere = (page: Page) => page.getByRole('status', { name: /^(Turn outcomes|Current turn narrative)$/ })
  .locator('div').filter({ hasText: new RegExp(`^A: ${ARIA}`) }).first();
/** The key back to the run's last turn, shown on an earlier turn. */
const latestKey = (page: Page) => page.getByRole('button', { name: /^Jump to latest turn/ });
/** The Viz toolbar's row: the row that holds its More key. */
const moreKey = (page: Page) => page.getByRole('button', { name: /^(Show|Hide) (advanced|more) tools/ });
const vizToolbar = (page: Page) => moreKey(page).locator('xpath=..');
/** The More panel's row of tools. */
const morePanel = (page: Page) => page.getByRole('toolbar', { name: 'Viz tools' });
/** The play controls: the row that holds the Previous turn key. */
const playRow = (page: Page) => stepBack(page).locator('xpath=..');
/** The keyboard legend: the row that holds its first key chip. */
const legend = (page: Page) => page.locator('.viz-content kbd').first().locator('xpath=../..');
const helpDialog = (page: Page) => page.getByRole('dialog', { name: 'Grid viz help' });

/** Opens the stored pair run's replay on the Viz tab in one look at one size, at its last turn. */
async function openRun(page: Page, run: { id: string; turns: number }, look: Look, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await useLook(page, look);
  // The Viz tab keeps its mode on the device: each open starts from LIVING.
  await page.addInitScript(() => { window.localStorage.removeItem('paracosm:gridMode'); });
  await page.goto(`${SERVER}/sim?replay=${encodeURIComponent(run.id)}&tab=viz`);
  await lookShown(page, look);
  await expect(gridOf(page, run.turns)).toBeAttached({ timeout: 60_000 });
  await expect(page.locator('[role="status"][aria-label^="Complete."]').first()).toBeAttached({ timeout: 60_000 });
}

/** Opens or folds the turn's words. */
async function setWords(page: Page, words: 'open' | 'folded'): Promise<void> {
  const press = words === 'open' ? openKey(page) : foldKey(page);
  const shown = words === 'open' ? foldKey(page) : openKey(page);
  if (await press.isVisible()) await press.click();
  await expect(shown).toBeVisible();
  await painted(page);
}

/** Scrolls every box on the page back to its start: the Viz panel as it first shows. */
const scrollBack = (page: Page) => page.evaluate(() => {
  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (el.scrollTop !== 0) el.scrollTop = 0;
  }
});

// ── The grid in view ─────────────────────────────────────────────────────

/** How the shown living grid stands in the window and in every box around it. */
interface GridRead {
  /** The canvas's top on the page, and its drawn size. */
  top: number;
  height: number;
  width: number;
  /** How much of the canvas is in view: inside the window and every box around it that clips. */
  shownHeight: number;
  shownWidth: number;
  /** The Viz panel's own view: its top and height. */
  panelTop: number;
  panelHeight: number;
  /** What is drawn over the part in view, read at 25 points across it. */
  over: string[];
}

async function readGrid(page: Page): Promise<GridRead | null> {
  return page.evaluate(() => {
    const canvas = Array.from(document.querySelectorAll('[data-testid^="living-colony-grid-"] canvas'))
      .find(c => c.getBoundingClientRect().height > 0) as HTMLElement | undefined;
    if (!canvas) return null;
    const region = canvas.closest('[data-testid^="living-colony-grid-"]')!;
    const c = canvas.getBoundingClientRect();
    let top = 0;
    let bottom = window.innerHeight;
    let left = 0;
    let right = document.documentElement.clientWidth;
    let panelTop = -1;
    let panelHeight = -1;
    for (let box = canvas.parentElement; box && box !== document.documentElement; box = box.parentElement) {
      const cs = getComputedStyle(box);
      if (box.classList.contains('viz-content')) {
        panelTop = box.getBoundingClientRect().top + box.clientTop;
        panelHeight = box.clientHeight;
      }
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = box.getBoundingClientRect();
      const boxTop = b.top + box.clientTop;
      const boxLeft = b.left + box.clientLeft;
      top = Math.max(top, boxTop);
      bottom = Math.min(bottom, boxTop + box.clientHeight);
      left = Math.max(left, boxLeft);
      right = Math.min(right, boxLeft + box.clientWidth);
    }
    const y0 = Math.max(top, c.top);
    const y1 = Math.min(bottom, c.bottom);
    const x0 = Math.max(left, c.left);
    const x1 = Math.min(right, c.right);
    const over = new Set<string>();
    if (y1 > y0 && x1 > x0) {
      for (let i = 0; i < 5; i += 1) {
        for (let j = 0; j < 5; j += 1) {
          const hit = document.elementFromPoint(x0 + (x1 - x0) * (i + 0.5) / 5, y0 + (y1 - y0) * (j + 0.5) / 5);
          if (hit && !region.contains(hit)) {
            const name = (hit.getAttribute('aria-label') ?? hit.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
            over.add(`${hit.tagName.toLowerCase()} "${name}"`);
          }
        }
      }
    }
    return {
      top: c.top,
      height: c.height,
      width: c.width,
      shownHeight: Math.max(0, y1 - y0),
      shownWidth: Math.max(0, x1 - x0),
      panelTop,
      panelHeight,
      over: [...over],
    };
  });
}

for (const look of LOOKS) {
  test(`at 390 x 844 the whole living grid is in view before any scroll on every turn, with the turn's words open and folded, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(240_000);
    const run = await pairRun(request);
    await openRun(page, run, look, PHONE);
    await expect(eventRow(page), 'the run draws the event row the live replays draw above the grid').toBeVisible();

    const reads: Array<{ turn: number; words: 'open' | 'folded'; read: GridRead | null }> = [];
    for (let turn = run.turns; turn >= 1; turn -= 1) {
      if (turn < run.turns) {
        await stepBack(page).click();
        await expect(gridOf(page, turn)).toBeAttached();
      }
      for (const words of ['open', 'folded'] as const) {
        await setWords(page, words);
        await scrollBack(page);
        await painted(page);
        if (turn === run.turns) await picture(page, `390x844-${look}-first-sight-words-${words}`);
        reads.push({ turn, words, read: await readGrid(page) });
      }
    }

    // A picture of the turn whose grid starts lowest, with its words open.
    const lowest = reads.reduce((a, b) => ((b.read?.top ?? 0) > (a.read?.top ?? 0) ? b : a));
    for (let turn = 1; turn < lowest.turn; turn += 1) await stepOn(page).click();
    await expect(gridOf(page, lowest.turn)).toBeAttached();
    await setWords(page, 'open');
    await scrollBack(page);
    await painted(page);
    await picture(page, `390x844-${look}-first-sight-lowest-grid`);

    test.info().annotations.push({
      type: 'the grid at first sight, 390 x 844',
      description: reads.map(({ turn, words, read }) => `T${turn} words ${words}: ${read ? `${read.shownHeight.toFixed(1)} of ${read.height.toFixed(1)} px shown, from ${read.top.toFixed(1)} px` : 'no grid'}`).join('; '),
    });
    for (const { turn, words, read } of reads) {
      const where = `T${turn}, words ${words}`;
      expect.soft(read, `${where}: the living grid is drawn`).not.toBeNull();
      if (!read) continue;
      expect.soft(read.height, `${where}: the grid keeps its drawn size (${read.height.toFixed(1)} px tall)`).toBeGreaterThanOrEqual(GRID_AT_LEAST);
      expect.soft(read.shownHeight, `${where}: the whole grid is in view before any scroll (${read.shownHeight.toFixed(1)} of its ${read.height.toFixed(1)} px, the grid starting ${read.top.toFixed(1)} px down)`).toBeGreaterThanOrEqual(read.height - 0.5);
      expect.soft(read.shownWidth, `${where}: the whole width of the grid is in view (${read.shownWidth.toFixed(1)} of ${read.width.toFixed(1)} px)`).toBeGreaterThanOrEqual(read.width - 0.5);
      expect.soft(read.over, `${where}: nothing is drawn over the grid`).toEqual([]);
    }
  });
}

// ── A short screen ───────────────────────────────────────────────────────

/** True when `part` stands wholly inside the window and inside the Viz panel's view, with nothing drawn over its middle. */
async function inView(part: Locator): Promise<boolean> {
  if ((await part.count()) === 0) return false;
  return part.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || r.width <= 0) return false;
    let top = 0;
    let bottom = window.innerHeight;
    for (let box = el.parentElement; box && box !== document.documentElement; box = box.parentElement) {
      const cs = getComputedStyle(box);
      if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue;
      const b = box.getBoundingClientRect();
      top = Math.max(top, b.top + box.clientTop);
      bottom = Math.min(bottom, b.top + box.clientTop + box.clientHeight);
    }
    if (r.top < top - 0.5 || r.bottom > bottom + 0.5) return false;
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 24), r.top + r.height / 2);
    return !!hit && (el === hit || el.contains(hit));
  });
}

/** The sum of every box's scroll on the page: it stops changing when a scroll has nowhere left to go. */
const scrolled = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('*')).reduce((sum, el) => sum + el.scrollTop, 0));

/**
 * Turns the mouse wheel over the Viz panel's left edge, where no key and no
 * grid lies, until `done` holds or the page stops scrolling. Returns whether
 * `done` held.
 */
async function wheelUntil(page: Page, done: () => Promise<boolean>): Promise<boolean> {
  const panel = await page.locator('.viz-content').first().boundingBox();
  if (!panel) return false;
  await page.mouse.move(panel.x + 3, panel.y + Math.min(24, panel.height / 2));
  for (let i = 0; i < 60; i += 1) {
    if (await done()) return true;
    const before = await scrolled(page);
    await page.mouse.wheel(0, 80);
    // A wheel turn scrolls over a few frames: wait until the page stands still.
    let at = await scrolled(page);
    for (let k = 0; k < 20; k += 1) {
      await painted(page);
      const now = await scrolled(page);
      if (now === at && now !== before) break;
      at = now;
    }
    if (at === before) return done();
  }
  return done();
}

for (const look of LOOKS) {
  test(`at 390 x 339 the living grid keeps a usable window, and the turn's outcomes, the play controls and the legend scroll into view, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const run = await pairRun(request);
    await openRun(page, run, look, SHORT);
    await setWords(page, 'open');
    await scrollBack(page);
    await painted(page);
    await picture(page, `390x339-${look}-first-sight`);

    // The grid's window: the grid scrolled to the top of its view.
    await gridOf(page, run.turns).evaluate((el) => { el.scrollIntoView({ block: 'start', inline: 'nearest' }); });
    await painted(page);
    await picture(page, `390x339-${look}-grid-scrolled-to`);
    const grid = await readGrid(page);

    // The outcomes: the mouse wheel over the panel brings them into view.
    await scrollBack(page);
    await painted(page);
    const outcomesReached = await wheelUntil(page, () => inView(ariaLine(page)));
    await picture(page, `390x339-${look}-outcomes-scrolled-to`);
    const line = await ariaLine(page).textContent().catch(() => null);

    // The panel's end: the play controls and the legend.
    await wheelUntil(page, async () => false);
    await painted(page);
    await picture(page, `390x339-${look}-panel-end`);
    const playInView = await inView(playRow(page));
    const legendInView = await inView(legend(page));

    expect.soft(grid, 'the living grid is drawn').not.toBeNull();
    if (grid) {
      test.info().annotations.push({ type: 'the grid on a short screen, 390 x 339', description: `${grid.shownHeight.toFixed(1)} of ${grid.height.toFixed(1)} px in view, in a Viz panel ${grid.panelHeight.toFixed(1)} px tall` });
      expect.soft(grid.shownHeight, `the grid has a usable window: ${grid.shownHeight.toFixed(1)} px of it in view, at least ${USABLE} px`).toBeGreaterThanOrEqual(USABLE - 0.5);
      expect.soft(grid.shownHeight, `the grid fills the Viz panel's ${grid.panelHeight.toFixed(1)} px view (${grid.shownHeight.toFixed(1)} px of it in view)`).toBeGreaterThanOrEqual(Math.min(grid.height, grid.panelHeight) - 0.5);
      expect.soft(grid.over, 'nothing is drawn over the grid').toEqual([]);
    }
    expect.soft(outcomesReached, 'the mouse wheel over the Viz panel brings the turn\'s outcomes into view, with nothing over them').toBe(true);
    expect.soft(line ?? '', 'the outcomes name the turn\'s first commander').toMatch(new RegExp(`^A: ${ARIA}`));
    expect.soft(playInView, 'at the Viz panel\'s end the play controls are in view').toBe(true);
    expect.soft(legendInView, 'at the Viz panel\'s end the keyboard legend is in view').toBe(true);
  });
}

// A phone on its side is wider than a phone, so the pair view draws both
// grids side by side and the turn's words stand in the turn banner; the
// controls above the grids are as tall as on the short screen.
for (const look of LOOKS) {
  test(`on a phone on its side (844 x 339) the living grid keeps a usable window, and the turn's outcomes, the play controls and the legend scroll into view, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const run = await pairRun(request);
    await openRun(page, run, look, SIDE);
    await setWords(page, 'open');
    await scrollBack(page);
    await painted(page);
    await picture(page, `844x339-${look}-first-sight`);

    // The grid's window: the grid scrolled to the top of its view.
    await gridOf(page, run.turns).evaluate((el) => { el.scrollIntoView({ block: 'start', inline: 'nearest' }); });
    await painted(page);
    await picture(page, `844x339-${look}-grid-scrolled-to`);
    const grid = await readGrid(page);

    // The outcomes: the mouse wheel over the panel brings them into view.
    await scrollBack(page);
    await painted(page);
    const outcomesReached = await wheelUntil(page, () => inView(ariaLineAnywhere(page)));
    const line = await ariaLineAnywhere(page).textContent().catch(() => null);

    // The panel's end: the play controls and the legend.
    await wheelUntil(page, async () => false);
    await painted(page);
    await picture(page, `844x339-${look}-panel-end`);
    const playInView = await inView(playRow(page));
    const legendInView = await inView(legend(page));

    expect.soft(grid, 'the living grid is drawn with a window of its own').not.toBeNull();
    if (grid) {
      test.info().annotations.push({ type: 'the grid on a phone on its side, 844 x 339', description: `${grid.shownHeight.toFixed(1)} of ${grid.height.toFixed(1)} px in view, in a Viz panel ${grid.panelHeight.toFixed(1)} px tall` });
      expect.soft(grid.shownHeight, `the grid has a usable window: ${grid.shownHeight.toFixed(1)} px of it in view, at least ${USABLE} px`).toBeGreaterThanOrEqual(USABLE - 0.5);
      expect.soft(grid.shownHeight, `the grid fills the Viz panel's ${grid.panelHeight.toFixed(1)} px view (${grid.shownHeight.toFixed(1)} px of it in view)`).toBeGreaterThanOrEqual(Math.min(grid.height, grid.panelHeight) - 0.5);
      expect.soft(grid.over, 'nothing is drawn over the grid').toEqual([]);
    }
    expect.soft(outcomesReached, 'the mouse wheel over the Viz panel brings the turn\'s outcomes into view, with nothing over them').toBe(true);
    expect.soft(line ?? '', 'the outcomes name the turn\'s first commander').toMatch(new RegExp(`^A: ${ARIA}`));
    expect.soft(playInView, 'at the Viz panel\'s end the play controls are in view').toBe(true);
    expect.soft(legendInView, 'at the Viz panel\'s end the keyboard legend is in view').toBe(true);
  });
}

// ── The keyboard legend ──────────────────────────────────────────────────

/** One row as the page lays it out: its drawn parts, its keys and the words in it. */
interface RowRead {
  parts: number;
  oneRow: boolean;
  outside: string[];
  inWindow: boolean;
  /** Each key (a button or a menu) in the row, with its size. */
  keys: Array<{ name: string; width: number; height: number }>;
  /** The legend's key chips drawn. */
  chips: number;
  /** Every word drawn in the row, with the size it computes to. */
  words: Array<{ text: string; size: number }>;
}

async function readRow(row: Locator): Promise<RowRead> {
  return row.evaluate((el) => {
    const drawn = (c: Element) => {
      const cs = getComputedStyle(c);
      const r = c.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const named = (c: Element) => (c.getAttribute('aria-label') ?? (c as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 48);
    const shown = Array.from(el.children).filter(drawn);
    const rects = shown.map(c => c.getBoundingClientRect());
    const cs = getComputedStyle(el);
    const scrolls = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
    const box = el.getBoundingClientRect();
    const left = box.left + el.clientLeft;
    const right = left + el.clientWidth;
    const words: Array<{ text: string; size: number }> = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      const parent = n.parentElement;
      if (!text || !parent || parent.closest('select') || !drawn(parent)) continue;
      words.push({ text: text.slice(0, 32), size: parseFloat(getComputedStyle(parent).fontSize) });
    }
    for (const s of Array.from(el.querySelectorAll('select'))) {
      if (drawn(s)) words.push({ text: s.options[s.selectedIndex]?.text ?? '', size: parseFloat(getComputedStyle(s).fontSize) });
    }
    return {
      parts: shown.length,
      oneRow: rects.length <= 1 || Math.max(...rects.map(r => r.top)) < Math.min(...rects.map(r => r.bottom)),
      outside: scrolls ? [] : shown.filter((_, i) => rects[i].left < left - 0.5 || rects[i].right > right + 0.5).map(named),
      inWindow: box.left >= -0.5 && box.right <= document.documentElement.clientWidth + 0.5,
      keys: Array.from(el.querySelectorAll('button, select')).filter(drawn).map((c) => {
        const r = c.getBoundingClientRect();
        return { name: named(c), width: r.width, height: r.height };
      }),
      chips: shown.filter(c => c.querySelector('kbd')).length,
      words,
    };
  });
}

/** The page does not scroll sideways. */
const pageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** A row at one width: drawn, one row, inside the window, keys 44 px on a phone. Soft checks, so one run names every row that misses. */
async function expectOneRow(page: Page, row: Locator, where: string, width: number): Promise<RowRead> {
  const read = await readRow(row);
  expect.soft(read.parts, `${where}: the row draws its parts`).toBeGreaterThan(0);
  expect.soft(read.oneRow, `${where}: the row is one row`).toBe(true);
  expect.soft(read.outside, `${where}: no part stands outside the row while it does not scroll`).toEqual([]);
  expect.soft(read.inWindow, `${where}: the row ends inside the window`).toBe(true);
  expect.soft(await pageScroll(page), `${where}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
  if (width < PHONE_BELOW) {
    expect.soft(read.keys.filter(k => k.height < PHONE_TARGET - 0.5 || k.width < PHONE_TARGET - 0.5).map(k => `${k.name}: ${k.width.toFixed(1)} x ${k.height.toFixed(1)} px`), `${where}: every key is 44 px tall and wide on a phone`).toEqual([]);
  }
  return read;
}

/** Every word in a row computes to 15 px or more. */
function expectReadable(read: RowRead, where: string): void {
  expect.soft(read.words.length, `${where}: the row has words`).toBeGreaterThan(0);
  expect.soft(read.words.filter(w => w.size < READ_SIZE - 0.01).map(w => `"${w.text}": ${w.size} px`), `${where}: every word is ${READ_SIZE} px or more`).toEqual([]);
}

for (const look of LOOKS) {
  test(`the keyboard legend is one row at 320, 390, 600 and 1440, with the full list one key away where it shows fewer keys, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const run = await pairRun(request);
    await openRun(page, run, look, sizeAt(1440));
    for (const width of [1440, 600, 390, 320] as const) {
      await test.step(`${width}`, async () => {
        await page.setViewportSize(sizeAt(width));
        await painted(page);
        const row = legend(page);
        await expect(row).toBeAttached();
        await row.evaluate((el) => { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        await painted(page);
        await picture(page, `${width}-${look}-keyboard-legend`, row, 220);
        const where = `${width}, ${look}, the keyboard legend`;
        const read = await expectOneRow(page, row, where, width);
        if (read.chips < LEGEND_KEYS) {
          // Fewer keys shown: one key opens the help overlay, which lists them all.
          const all = row.getByRole('button');
          await expect.soft(all, `${where}: with ${read.chips} of its ${LEGEND_KEYS} keys shown, the legend has a key to the full list`).toHaveCount(1);
          if ((await all.count()) === 1) {
            await all.click();
            await expect.soft(helpDialog(page), `${where}: the key opens the help overlay`).toBeVisible();
            await expect.soft(helpDialog(page).getByText('Keyboard', { exact: true }), `${where}: the help overlay lists the keyboard keys`).toBeVisible();
            await page.getByRole('button', { name: 'Close help', exact: true }).click();
            await expect(helpDialog(page)).toHaveCount(0);

            // From the keyboard: focus moves into the help overlay, so the
            // arrow keys leave the turn behind it alone, and Escape closes it
            // and brings focus back to the key.
            const scrub = playRow(page).getByRole('slider', { name: 'Scrub timeline' });
            const turnBefore = await scrub.getAttribute('aria-valuetext');
            await all.focus();
            await page.keyboard.press('Enter');
            await expect.soft(helpDialog(page), `${where}: Enter on the key opens the help overlay`).toBeVisible();
            const focusInside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"][aria-label="Grid viz help"]'));
            expect.soft(focusInside, `${where}: focus moves into the help overlay as it opens`).toBe(true);
            await page.keyboard.press('ArrowLeft');
            await painted(page);
            const turnAfter = await scrub.getAttribute('aria-valuetext');
            expect.soft(turnAfter, `${where}: the left arrow key leaves the turn behind the help overlay alone`).toBe(turnBefore);
            // A click on the overlay's words keeps the panel behind it still too.
            await helpDialog(page).getByText('Keyboard', { exact: true }).click();
            await page.keyboard.press('ArrowLeft');
            await painted(page);
            expect.soft(await scrub.getAttribute('aria-valuetext'), `${where}: after a click on the overlay's words, the left arrow key still leaves the turn alone`).toBe(turnBefore);
            await page.keyboard.press('Escape');
            await expect(helpDialog(page)).toHaveCount(0);
            const focusBack = await all.evaluate(el => el === document.activeElement);
            expect.soft(focusBack, `${where}: closing the help overlay brings focus back to its key`).toBe(true);
            // The overlay says ? toggles it: from inside it, ? closes it too.
            await page.keyboard.press('Enter');
            await expect(helpDialog(page)).toBeVisible();
            await page.keyboard.press('?');
            await expect.soft(helpDialog(page), `${where}: ? closes the help overlay from inside it`).toHaveCount(0);
            if (await helpDialog(page).count()) await page.keyboard.press('Escape');
            // Puts the run back on its last turn when the arrows moved it.
            for (let i = 0; i < 3 && (await scrub.getAttribute('aria-valuetext')) !== turnBefore; i += 1) await stepOn(page).click();
          }
        }
      });
    }
  });
}

// ── The words of the Viz rows ────────────────────────────────────────────

/** Chooses a grid mode: the mode menu on a phone, the mode's tab wider. */
async function chooseMode(page: Page, mode: 'living' | 'forge'): Promise<void> {
  const menu = page.getByRole('combobox', { name: 'Grid viz mode' });
  if (await menu.isVisible()) {
    await menu.selectOption(mode);
    await expect(menu).toHaveValue(mode);
  } else {
    const tab = page.locator(`[data-grid-mode="${mode}"]`);
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  await painted(page);
}

for (const look of LOOKS) {
  test(`every word on the Viz toolbar, its More panel, the play controls and the legend is 15 px or more at 320, 390, 600 and 1440, each row one row with 44 px keys on a phone, and the Latest key clear of the play controls, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(300_000);
    const run = await pairRun(request);
    await openRun(page, run, look, sizeAt(1440));
    for (const width of [1440, 600, 390, 320] as const) {
      await test.step(`${width}`, async () => {
        await page.setViewportSize(sizeAt(width));
        await painted(page);
        for (const mode of ['living', 'forge'] as const) {
          await scrollBack(page);
          await chooseMode(page, mode);
          const where = `${width}, ${look}, ${mode}`;
          // The toolbar, with the arrow keys it shows when it scrolls.
          const toolbar = vizToolbar(page).locator('xpath=..');
          await moreKey(page).click();
          await expect(morePanel(page)).toBeVisible();
          await painted(page);
          await picture(page, `${width}-${look}-toolbar-${mode}-more-open`, toolbar, 200);
          expectReadable(await expectOneRow(page, vizToolbar(page), `${where}, the toolbar`, width), `${where}, the toolbar`);
          expectReadable(await readRow(toolbar), `${where}, the toolbar with its arrow keys`);
          const panel = morePanel(page).locator('xpath=..');
          expectReadable(await expectOneRow(page, morePanel(page), `${where}, the More panel`, width), `${where}, the More panel`);
          expectReadable(await readRow(panel), `${where}, the More panel with its arrow keys`);
          await moreKey(page).click();
          await expect(morePanel(page)).toBeHidden();
        }
        await chooseMode(page, 'living');

        // The play controls and the legend, scrolled into view.
        await playRow(page).evaluate((el) => { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        await legend(page).evaluate((el) => { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        await painted(page);
        await picture(page, `${width}-${look}-play-controls-and-legend`, playRow(page), 160);
        expectReadable(await expectOneRow(page, playRow(page), `${width}, ${look}, the play controls`, width), `${width}, ${look}, the play controls`);
        expectReadable(await expectOneRow(page, legend(page), `${width}, ${look}, the keyboard legend`, width), `${width}, ${look}, the keyboard legend`);

        // The Latest key shows on a turn before the last. It covers no
        // control of the play controls at any width. On a phone it stands in
        // the flow above them, so it is a phone key: 44 px tall and wide,
        // inside the window, its words at 15 px.
        await stepBack(page).click();
        await expect(latestKey(page)).toBeVisible();
        await latestKey(page).evaluate((el) => { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        await playRow(page).evaluate((el) => { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        await painted(page);
        await picture(page, `${width}-${look}-latest-key`, playRow(page), 160);
        const key = await latestKey(page).evaluate((el) => {
          const r = el.getBoundingClientRect();
          const words: Array<{ text: string; size: number }> = [];
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (text && n.parentElement) words.push({ text: text.slice(0, 32), size: parseFloat(getComputedStyle(n.parentElement).fontSize) });
          }
          return { width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom, inner: document.documentElement.clientWidth, words };
        });
        const where = `${width}, ${look}, the Latest key`;
        const covered = await playRow(page).evaluate((row, k) => Array.from(row.querySelectorAll('button, select, input'))
          .filter((c) => {
            const r = c.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.left < k.right && r.right > k.left && r.top < k.bottom && r.bottom > k.top;
          })
          .map(c => (c.getAttribute('aria-label') ?? c.textContent ?? c.tagName).replace(/\s+/g, ' ').trim().slice(0, 32)), key);
        expect.soft(covered, `${where}: it covers no control of the play controls`).toEqual([]);
        if (width <= 480) {
          expect.soft(key.height, `${where}: 44 px tall or more on a phone (${key.height.toFixed(1)} px)`).toBeGreaterThanOrEqual(PHONE_TARGET - 0.5);
          expect.soft(key.width, `${where}: 44 px wide or more on a phone (${key.width.toFixed(1)} px)`).toBeGreaterThanOrEqual(PHONE_TARGET - 0.5);
          expect.soft(key.left >= -0.5 && key.right <= key.inner + 0.5, `${where}: inside the window (${key.left.toFixed(1)} to ${key.right.toFixed(1)} px of ${key.inner} px)`).toBe(true);
          expect.soft(key.words.filter(w => w.size < READ_SIZE - 0.01).map(w => `"${w.text}": ${w.size} px`), `${where}: every word is ${READ_SIZE} px or more`).toEqual([]);
        }
        await stepOn(page).click();
        await expect(latestKey(page)).toHaveCount(0);
      });
    }
  });
}
