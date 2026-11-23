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
 * - The PNG export of the Viz panel holds every living grid whole. Where the
 *   panel scrolls as one (390 x 339, 844 x 339) a grid stands outside the
 *   panel's view, and the picture is as tall as the panel laid out in full,
 *   each grid drawn where it stands in it; at 1440 the picture is the
 *   panel's own view, at twice its size. The timelapse's frames keep the
 *   panel's proportions: what they draw is as wide for its height as in the
 *   PNG export, as the recording starts and after the panel's height
 *   changes under it.
 * - On the Viz tab one press of ? opens one overlay, the tab's help, and a
 *   second press closes it; on a tab without a help of its own ? opens the
 *   page's Keyboard shortcuts overlay.
 * - At 600, 768 and 1440 the Viz legend row (the marks and the key to the
 *   full legend) is one row: every mark it shows is whole and on one line,
 *   its key's words are on one line, and below 900 px the key is 44 px
 *   tall. The full legend names every mark, so a mark the row leaves out
 *   is one key away.
 * - On a phone 560 px tall, taller than the short screen, a spotlight
 *   tapped with its grid scrolled above the view opens its drilldown with
 *   the name and the Close key in view.
 * - Wider than 768 px the department donut in the colony's stats card says
 *   its count at 15 px or more.
 * - The 15 px floor and the Viz layout stay inside the Viz panel: on the
 *   Run tab the track of one panel a leader keeps the dashboard's own size
 *   for a leader's name, and its grids paint their words below 15 px.
 *
 * The stored runs are tests-e2e/support/viz-replay-server.ts's, served with
 * VIZ_REPLAY_EVENT_STARTS=1 on a port of their own: the hosted demo's six
 * recorded turns of Aria Chen against Dietrich Voss, with their long
 * headlines, and each turn's event_start frame as a live run sends it, so
 * the Viz tab draws the event row the live replays draw. That gives the
 * grid as many rows above it as the live replays had; the other stored runs
 * draw no event row.
 *
 * Pictures at 390 x 844, 390 x 339, 844 x 339, 320, 600 and 1440 in both looks, of
 * the Viz legend row at 600, 768 and 1440, of the drilldown at 390 x 560 and of the
 * Run tab's track go to test-pictures/viz-rows-type/, which CI uploads. Each is taken before its
 * checks, so a failing run leaves them too.
 */
import { readFileSync } from 'node:fs';
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { LOOKS, useLook, type Look } from '../support/forge-view-pages';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stored runs live on local servers of their own.');

// The hosted consent script keeps its footer control under a privacy signal.
test.use({ deviceScaleFactor: 2, extraHTTPHeaders: { DNT: '1' } });

const PICTURES = 'test-pictures/viz-rows-type';
/** The stored runs with each turn's event_start frame: viz-replay-server.ts with VIZ_REPLAY_EVENT_STARTS=1. */
const SERVER = 'http://127.0.0.1:3473';
const ARIA = 'Aria Chen';

const PHONE = { width: 390, height: 844 };
const TABLETS = [{ width: 600, height: 844 }, { width: 768, height: 1024 }];
const SHORT = { width: 390, height: 339 };
/** A phone taller than the short screen's 500 px, short enough that the panel scrolls past a grid. */
const TALL_ENOUGH = { width: 390, height: 560 };
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

/** The id of the stored run with three commanders, from the server's own replay route. */
async function cohortRunId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${SERVER}/sessions`);
  expect(res.ok()).toBe(true);
  const { sessions } = await res.json() as { sessions: Array<{ id: string }> };
  for (const { id } of sessions) {
    const replay = await request.get(`${SERVER}/sessions/${encodeURIComponent(id)}/replay`);
    expect(replay.ok()).toBe(true);
    const leaders = new Set<string>();
    for (const chunk of (await replay.text()).split('\n\n')) {
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (event === 'sim' && data) leaders.add((JSON.parse(data) as { leader: string }).leader);
    }
    if (leaders.size === 3) return id;
  }
  throw new Error('The server stores no run with three commanders.');
}

/** Aria Chen's living grid on one turn. */
const viz = (page: Page) => page.locator('.viz-content');
const gridOf = (page: Page, turn: number) => viz(page).getByRole('img', { name: new RegExp(`^${ARIA} colony, turn ${turn}\\.`) });
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
  await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices' })).toBeVisible();
  await expect(page.getByRole('contentinfo').getByText(/^\d+k tokens$/)).toBeVisible();
  await expect(page.getByRole('contentinfo').getByText(/^\$\d+\.\d+$/)).toBeVisible();
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
    const canvas = Array.from(document.querySelectorAll('.viz-content [data-testid^="living-colony-grid-"] canvas'))
      .find(c => c.getBoundingClientRect().height > 0) as HTMLElement | undefined;
    if (!canvas) return null;
    const region = canvas.closest('[data-testid^="living-colony-grid-"]')!;
    const panel = canvas.closest('.viz-content')!;
    const c = canvas.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    let top = 0;
    let bottom = window.innerHeight;
    let left = 0;
    let right = document.documentElement.clientWidth;
    let panelTop = Math.max(0, panelBox.top + panel.clientTop);
    let panelBottom = Math.min(window.innerHeight, panelBox.top + panel.clientTop + panel.clientHeight);
    for (let box = canvas.parentElement; box && box !== document.documentElement; box = box.parentElement) {
      const cs = getComputedStyle(box);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = box.getBoundingClientRect();
      const boxTop = b.top + box.clientTop;
      const boxLeft = b.left + box.clientLeft;
      if (!panel.contains(box)) {
        panelTop = Math.max(panelTop, boxTop);
        panelBottom = Math.min(panelBottom, boxTop + box.clientHeight);
      }
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
      panelHeight: Math.max(0, panelBottom - panelTop),
      over: [...over],
    };
  });
}

for (const look of LOOKS) {
  for (const size of [PHONE, ...TABLETS]) {
    const dimensions = `${size.width}x${size.height}`;
    test(`at ${size.width} x ${size.height} the whole living grid is in view before any scroll on every turn, with the turn's words open and folded, in the ${look} look`, async ({ page, request }) => {
      test.setTimeout(240_000);
      const run = await pairRun(request);
      await openRun(page, run, look, size);
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
          if (turn === run.turns) await picture(page, `${dimensions}-${look}-first-sight-words-${words}`);
          reads.push({ turn, words, read: await readGrid(page) });
          if (size === PHONE) {
            const widths = await gridOf(page, turn).evaluate(canvas => {
              const field = canvas.parentElement!;
              const region = field.parentElement!;
              const style = getComputedStyle(region);
              return {
                field: field.getBoundingClientRect().width,
                available: canvas.closest('.viz-content')!.clientWidth -
                  parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
              };
            });
            expect.soft(Math.abs(widths.field - widths.available), `T${turn}, words ${words}: the grid fills the phone panel within its padding`).toBeLessThanOrEqual(1);
          }
        }
      }

      // A picture of the turn whose grid starts lowest, with its words open.
      const lowest = reads.reduce((a, b) => ((b.read?.top ?? 0) > (a.read?.top ?? 0) ? b : a));
      for (let turn = 1; turn < lowest.turn; turn += 1) await stepOn(page).click();
      await expect(gridOf(page, lowest.turn)).toBeAttached();
      await setWords(page, 'open');
      await scrollBack(page);
      await painted(page);
      await picture(page, `${dimensions}-${look}-first-sight-lowest-grid`);

      test.info().annotations.push({
        type: `the grid at first sight, ${dimensions}`,
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
  const y = Math.max(1, Math.min(page.viewportSize()!.height - 1, panel.y + Math.min(24, panel.height / 2)));
  await page.mouse.move(panel.x + 3, y);
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

// The screenshot matrix uses the same stored replay and footer as the checks.
for (const look of LOOKS) {
  test(`replay comparison pictures in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const run = await pairRun(request);
    for (const size of [...TABLETS, SHORT, sizeAt(1440)]) {
      await openRun(page, run, look, size);
      await setWords(page, 'open');
      await scrollBack(page);
      if (size === SHORT) {
        await gridOf(page, run.turns).evaluate(el => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
      }
      await painted(page);
      await picture(page, `comparison-${size.width}x${size.height}-${look}`);
    }
  });

  test(`a replay never puts a crisis card over the LIVING control or grid in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const run = await pairRun(request);
    await page.addInitScript(() => {
      const notices = { crisis: false };
      Object.assign(window, { notices });
      new MutationObserver(() => {
        notices.crisis ||= Array.from(document.querySelectorAll('.viz-content [role="status"]'))
          .some(el => el.textContent?.startsWith('⚡ Crisis'));
      }).observe(document, { childList: true, subtree: true });
    });
    // Keep the real replay stream, with enough time between frames for the
    // interface to paint while a recorded crisis is still in flight.
    await page.route(url => url.pathname === `/sessions/${run.id}/replay`, route => {
      const url = new URL(route.request().url());
      url.searchParams.set('speed', '10');
      return route.continue({ url: url.href });
    });
    for (const size of [PHONE, SHORT, SIDE]) {
      await openRun(page, run, look, size);
      const crisis = await page.evaluate(() => (window as unknown as { notices: { crisis: boolean } }).notices.crisis);
      expect.soft(crisis, `${size.width}x${size.height}: recorded crises stay in the turn narrative`).toBe(false);
      await expect(viz(page).getByRole('status', { name: 'Current turn narrative' })).toBeVisible();
    }
  });

  test(`a spotlight opens its drilldown with the header in view at 390 x 339 and at 390 x 560 with the grid scrolled above, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const run = await pairRun(request);
    await openRun(page, run, look, SHORT);
    const spotlight = viz(page).getByRole('button', { name: /^Spotlight:/ }).last();
    await spotlight.evaluate(el => el.scrollIntoView({ block: 'end', inline: 'nearest' }));
    await spotlight.click();
    const dialog = viz(page).getByRole('dialog', { name: /drilldown$/ });
    const header = dialog.getByRole('button', { name: 'Close drilldown' }).locator('xpath=..');
    await expect(header).toBeVisible();
    expect(await inView(header), 'the drilldown name and Close key are inside the short window').toBe(true);

    // A phone taller than the short screen: the panel scrolls on its own, and
    // the first spotlight stands at the top of its view with the whole of
    // Aria Chen's grid above it.
    await openRun(page, run, look, TALL_ENOUGH);
    const first = viz(page).getByRole('button', { name: /^Spotlight:/ }).first();
    await first.evaluate(el => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await painted(page);
    // The test's own ground: Aria Chen's grid, where the drilldown opens, is above the panel's view.
    const above = await gridOf(page, run.turns).evaluate((el) => {
      const view = el.closest('[data-viz-layout]')!.getBoundingClientRect();
      return el.getBoundingClientRect().bottom <= view.top + 1;
    });
    expect(above, 'Aria Chen\'s grid stands above the panel\'s view').toBe(true);
    await first.click();
    const opened = viz(page).getByRole('dialog', { name: /drilldown$/ });
    const top = opened.getByRole('button', { name: 'Close drilldown' }).locator('xpath=..');
    await expect(top).toBeVisible();
    await picture(page, `drilldown-${TALL_ENOUGH.width}x${TALL_ENOUGH.height}-${look}`);
    expect(await inView(top), `at ${TALL_ENOUGH.width} x ${TALL_ENOUGH.height} the drilldown name and Close key are in view`).toBe(true);
  });
}

test('the living grid draws its labels at the Viz text size', async ({ page, request }) => {
  const run = await pairRun(request);
  await page.addInitScript(() => {
    const sizes = new WeakMap<HTMLCanvasElement, Set<number>>();
    Object.assign(window, { gridTextSizes: sizes });
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      const size = /([0-9.]+)px/.exec(this.font)?.[1];
      if (size && this.canvas.closest('.viz-content')) {
        const drawn = sizes.get(this.canvas) ?? new Set<number>();
        drawn.add(Number(size));
        sizes.set(this.canvas, drawn);
      }
      if (maxWidth === undefined) fillText.call(this, text, x, y);
      else fillText.call(this, text, x, y, maxWidth);
    };
  });
  await openRun(page, run, 'dark', PHONE);
  const sizes = () => gridOf(page, run.turns).evaluate(canvas => {
    const drawn = (window as unknown as { gridTextSizes: WeakMap<Element, Set<number>> }).gridTextSizes;
    return [...(drawn.get(canvas) ?? [])];
  });
  await expect.poll(async () => (await sizes()).length).toBeGreaterThan(0);
  expect((await sizes()).filter(size => size < READ_SIZE)).toEqual([]);
});

test('the department donut in the colony\'s stats card says its count at the Viz text size', async ({ page, request }) => {
  const run = await pairRun(request);
  // Wider than 768 px the stats card carries the donut.
  await openRun(page, run, 'dark', sizeAt(1440));
  const count = viz(page).getByRole('img', { name: /^Department breakdown:/ }).first().locator('text');
  await expect(count).toHaveText(/^\d+$/);
  expect(await count.evaluate(el => parseFloat(getComputedStyle(el).fontSize)), 'the count of the colony\'s living members').toBeGreaterThanOrEqual(READ_SIZE);
});

test('the Viz panel\'s 15 px words stay in the Viz panel: the Run tab\'s track of one panel a leader keeps its own sizes', async ({ page, request }) => {
  test.setTimeout(180_000);
  const id = await cohortRunId(request);
  await page.addInitScript(() => {
    const sizes = new Set<number>();
    Object.assign(window, { trackTextSizes: sizes });
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      const size = /([0-9.]+)px/.exec(this.font)?.[1];
      if (size && this.canvas.closest('[data-testid="watch-grid-track"]')) sizes.add(Number(size));
      if (maxWidth === undefined) fillText.call(this, text, x, y);
      else fillText.call(this, text, x, y, maxWidth);
    };
  });
  await page.setViewportSize(sizeAt(1440));
  await useLook(page, 'dark');
  await page.goto(`${SERVER}/sim?replay=${encodeURIComponent(id)}&tab=sim`);
  const track = page.getByTestId('watch-grid-track');
  await expect(track).toBeVisible({ timeout: 60_000 });
  await track.scrollIntoViewIfNeeded();
  const name = track.getByText(ARIA, { exact: true }).first();
  await expect(name).toBeVisible({ timeout: 60_000 });
  await picture(page, 'run-tab-track-1440-dark', track);
  // The dashboard's own size for a leader's name, read where the name stands.
  const { size, own } = await name.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.fontSize = 'var(--font-sm)';
    el.parentElement!.appendChild(probe);
    const own = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    return { size: parseFloat(getComputedStyle(el).fontSize), own };
  });
  expect(size, 'a leader\'s name on the Run tab keeps the dashboard\'s own size').toBe(own);
  const trackSizes = () => page.evaluate(() => [...(window as unknown as { trackTextSizes: Set<number> }).trackTextSizes]);
  await expect.poll(async () => (await trackSizes()).length, { message: 'the track\'s grids paint their labels', timeout: 30_000 }).toBeGreaterThan(0);
  expect((await trackSizes()).filter(s => s >= READ_SIZE), 'the track\'s grids paint their labels at the Run tab\'s own sizes, not the Viz panel\'s').toEqual([]);
});

test('the light phone replay shows the toolbar ground at full brightness', async ({ page, request }) => {
  const run = await pairRun(request);
  await openRun(page, run, 'light', PHONE);
  await painted(page);
  const hint = viz(page).getByText('Full field + colonist seeds + all events', { exact: true });
  const { x, y, ground } = await hint.evaluate(el => {
    const strip = el.parentElement!;
    const rect = strip.getBoundingClientRect();
    return {
      x: Math.floor(rect.left + 3),
      y: Math.floor(el.getBoundingClientRect().top + el.clientHeight / 2),
      ground: getComputedStyle(strip).backgroundColor,
    };
  });
  const pixel = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, animations: 'disabled', scale: 'css' });
  const colours = await page.evaluate(async ({ png, ground }) => {
    const bytes = Uint8Array.from(atob(png), ch => ch.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    ctx.fillStyle = ground;
    ctx.fillRect(1, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 2, 1).data);
  }, { png: pixel.toString('base64'), ground });
  expect(colours.slice(0, 4)).toEqual(colours.slice(4));
});

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
            // D, the diff overlay's key, leaves the panel behind it alone too.
            const diffShown = () => page.evaluate(() => window.localStorage.getItem('paracosm:vizDiffOverlay'));
            const diffBefore = await diffShown();
            await page.keyboard.press('d');
            await painted(page);
            expect.soft(await diffShown(), `${where}: D leaves the diff overlay behind the help overlay alone`).toBe(diffBefore);
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
            // The same ? opens no other overlay in its place.
            const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
            await expect.soft(shortcuts, `${where}: ? from inside the help overlay opens no other overlay`).toHaveCount(0);
            if (await shortcuts.count()) await page.keyboard.press('Escape');
            if (await helpDialog(page).count()) await page.keyboard.press('Escape');
            // Puts the run back on its last turn when the arrows moved it.
            for (let i = 0; i < 3 && (await scrub.getAttribute('aria-valuetext')) !== turnBefore; i += 1) await stepOn(page).click();
          }
        }
      });
    }
  });
}

// ── The Viz legend row ───────────────────────────────────────────────────

/** The Viz legend row: the grid's marks and the key to the full legend. */
const marksRow = (page: Page) => viz(page).locator('[aria-label="Visualization legend"]');

/** The marks row as it is drawn: each run of its words, where it stands and how the row's boxes clip it. */
interface MarksRead {
  /** Each run of words outside the full legend, with its lines on the page and whether the row's clip shows it. */
  words: Array<{ text: string; name: boolean; key: boolean; lines: number; top: number; bottom: number; shown: 'whole' | 'cut' | 'out' }>;
  /** The key to the full legend. */
  key: { width: number; height: number } | null;
}

async function readMarks(row: Locator): Promise<MarksRead> {
  return row.evaluate((el) => {
    const key = el.querySelector(':scope > button');
    const words: MarksRead['words'] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      const parent = n.parentElement;
      if (!text || !parent || parent.closest('[role="dialog"]')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0);
      if (rects.length === 0) continue;
      // The box the words are clipped to: every box from them to the row that clips.
      let top = -Infinity;
      let bottom = Infinity;
      let left = -Infinity;
      let right = Infinity;
      for (let box: Element | null = parent; box; box = box === el ? null : box.parentElement) {
        const cs = getComputedStyle(box);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const b = box.getBoundingClientRect();
        top = Math.max(top, b.top + box.clientTop);
        bottom = Math.min(bottom, b.top + box.clientTop + box.clientHeight);
        left = Math.max(left, b.left + box.clientLeft);
        right = Math.min(right, b.left + box.clientLeft + box.clientWidth);
      }
      const inside = rects.filter(r => r.bottom > top + 0.5 && r.top < bottom - 0.5 && r.right > left + 0.5 && r.left < right - 0.5);
      const whole = inside.length === rects.length && rects.every(r => r.top >= top - 0.5 && r.bottom <= bottom + 0.5 && r.left >= left - 0.5 && r.right <= right + 0.5);
      // Lines: the distinct tops of the words' boxes.
      const tops = [...new Set(rects.map(r => Math.round(r.top)))];
      words.push({
        text: text.slice(0, 32),
        name: !parent.closest('[aria-hidden="true"]') && !(key && key.contains(parent)),
        key: !!key && key.contains(parent),
        lines: tops.length,
        top: Math.min(...rects.map(r => r.top)),
        bottom: Math.max(...rects.map(r => r.bottom)),
        shown: whole ? 'whole' : inside.length > 0 ? 'cut' : 'out',
      });
    }
    const k = key?.getBoundingClientRect();
    return { words, key: k ? { width: k.width, height: k.height } : null };
  });
}

test('the Viz legend row is one row at 600, 768 and 1440, with every mark one key away in the full legend', async ({ page, request }) => {
  test.setTimeout(180_000);
  const run = await pairRun(request);
  for (const size of [...TABLETS, sizeAt(1440)]) {
    const where = `${size.width} x ${size.height}`;
    await openRun(page, run, 'dark', size);
    await scrollBack(page);
    await painted(page);
    const row = marksRow(page);
    await expect(row).toBeVisible();
    await picture(page, `marks-row-${size.width}-dark`, row);
    const read = await readMarks(row);
    const shown = read.words.filter(w => w.shown !== 'out');
    expect.soft(read.words.filter(w => w.shown === 'cut').map(w => w.text), `${where}: no mark is cut by the row's edge`).toEqual([]);
    expect.soft(shown.filter(w => w.lines > 1).map(w => `"${w.text}" on ${w.lines} lines`), `${where}: every name and the key's words stand on one line`).toEqual([]);
    const oneLine = shown.length > 0 && Math.max(...shown.map(w => w.top)) < Math.min(...shown.map(w => w.bottom));
    expect.soft(oneLine, `${where}: the marks and the key stand on one line: ${shown.map(w => `"${w.text}" at ${Math.round(w.top)}`).join(', ')}`).toBe(true);
    expect.soft(shown.filter(w => w.name).length, `${where}: the row shows at least one mark`).toBeGreaterThan(0);
    expect.soft(shown.some(w => w.key), `${where}: the key to the full legend shows`).toBe(true);
    if (size.width < PHONE_BELOW) {
      expect.soft(read.key?.height ?? 0, `${where}: the key to the full legend is ${PHONE_TARGET} px tall`).toBeGreaterThanOrEqual(PHONE_TARGET - 0.5);
    }
    expect.soft(await pageScroll(page), `${where}: the page does not scroll sideways`).toBeLessThanOrEqual(0);

    // The full legend names every mark, the ones the row leaves out too.
    const names = [...new Set(read.words.filter(w => w.name).map(w => w.text))];
    await row.getByRole('button', { name: 'Show full legend' }).click();
    const full = page.getByRole('dialog', { name: /looking at$/ });
    await expect(full).toBeVisible();
    for (const name of names) {
      await expect.soft(full.getByText(name, { exact: true }), `${where}: the full legend names "${name}"`).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(full).toBeHidden();
  }
});

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
          if (mode === 'living') {
            const hint = viz(page).getByText('Full field + colonist seeds + all events', { exact: true });
            await expect.soft(hint, `${where}: the mode description is 15 px`).toHaveCSS('font-size', '15px');
          }
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

// ── The PNG export ───────────────────────────────────────────────────────

const exportKey = (page: Page) => morePanel(page).getByRole('button', { name: 'Export options', exact: true });
const pngAction = (page: Page) => page.getByRole('menuitem', { name: /^PNG/ });
/** The export draws the panel at twice its size. */
const EXPORT_SCALE = 2;
/** The sizes the export is read at: the two where the panel scrolls as one, and a desktop's. */
const EXPORT_SIZES = [SHORT, SIDE, sizeAt(1440)];

interface Box { left: number; top: number; width: number; height: number }

/** The Viz panel's view and each shown living grid's place in it, in CSS px from the panel's top left. */
const readPanel = (page: Page): Promise<{ width: number; height: number; grids: Box[] }> => page.evaluate(() => {
  const root = document.querySelector('.viz-content')!;
  const panel = root.getBoundingClientRect();
  const body = root.querySelector('[data-viz-layout]');
  const fullHeight = panel.height + (body ? Math.max(0, body.scrollHeight - body.clientHeight) : 0);
  const grids: Array<{ left: number; top: number; width: number; height: number }> = [];
  for (const region of Array.from(document.querySelectorAll('.viz-content [data-testid^="living-colony-grid-"]'))) {
    // The grid's drawing: the largest canvas of its region.
    const drawn = Array.from(region.querySelectorAll('canvas'))
      .map(c => c.getBoundingClientRect())
      .filter(r => r.width > 0 && r.height > 0)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (drawn) grids.push({ left: drawn.left - panel.left, top: drawn.top - panel.top, width: drawn.width, height: drawn.height });
  }
  return { width: panel.width, height: fullHeight, grids };
});

/** Waits until every shown living grid holds its drawing: a canvas of it with more than one colour. */
const gridsDrawn = (page: Page) => page.waitForFunction(() => {
  const regions = Array.from(document.querySelectorAll('.viz-content [data-testid^="living-colony-grid-"]'))
    .filter(region => region.getBoundingClientRect().height > 0);
  return regions.length > 0 && regions.every(region => Array.from(region.querySelectorAll('canvas')).some((canvas) => {
    if (canvas.width === 0 || canvas.height === 0) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 4; i < data.length; i += 4) {
      if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2] || data[i + 3] !== data[3]) return true;
    }
    return false;
  }));
}, undefined, { timeout: 60_000, polling: 250 });

/**
 * Whether the picture holds a drawing in each box: more than one colour
 * inside it. A box that reaches outside the picture holds none.
 */
const drawnIn = (page: Page, png: Buffer, boxes: Box[]): Promise<boolean[]> => page.evaluate(async ({ b64, boxes: at }) => {
  const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  return at.map((box) => {
    const left = Math.ceil(box.left) + 2;
    const top = Math.ceil(box.top) + 2;
    const width = Math.floor(box.width) - 4;
    const height = Math.floor(box.height) - 4;
    if (width <= 0 || height <= 0 || left < 0 || top < 0 || left + width > bitmap.width || top + height > bitmap.height) return false;
    // The stored grid paints both its heading and its population readout.
    // Require pixels in both bands so a cropped grid cannot satisfy the check.
    const bandHeight = Math.ceil(height / 5);
    return [top, top + height - bandHeight].every(y => {
      const { data } = ctx.getImageData(left, y, width, bandHeight);
      for (let i = 4; i < data.length; i += 4) {
        if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) return true;
      }
      return false;
    });
  });
}, { b64: png.toString('base64'), boxes });

/** How far a timelapse frame's proportions may stand from the PNG export's: the grids move as they are drawn, and the two are read a moment apart. */
const PROPORTION_SLACK = 0.08;

/** A box of pixels of a picture, and the picture's size. */
interface DrawnBox { pictureWidth: number; pictureHeight: number; left: number; top: number; width: number; height: number }

/** Keeps the canvas the timelapse records from, so a frame can be read as the recorder gets it. */
const keepRecordedCanvas = (page: Page) => page.addInitScript(() => {
  const capture = HTMLCanvasElement.prototype.captureStream;
  HTMLCanvasElement.prototype.captureStream = function captureAndKeep(this: HTMLCanvasElement, rate?: number) {
    (window as unknown as { recordedCanvas?: HTMLCanvasElement }).recordedCanvas = this;
    return rate === undefined ? capture.call(this) : capture.call(this, rate);
  };
});

/** The box of everything drawn on the timelapse's frame: every pixel that differs from its top left one. Null before a frame is drawn. */
const recordedBox = (page: Page): Promise<DrawnBox | null> => page.evaluate(() => {
  const canvas = (window as unknown as { recordedCanvas?: HTMLCanvasElement }).recordedCanvas;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return null;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = canvas.width;
  let y0 = canvas.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const i = (y * canvas.width + x) * 4;
      if (data[i] === data[0] && data[i + 1] === data[1] && data[i + 2] === data[2]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { pictureWidth: canvas.width, pictureHeight: canvas.height, left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
});

/** The box of everything drawn in a PNG: every pixel that differs from its top left one. */
const pngBox = (page: Page, png: Buffer): Promise<DrawnBox | null> => page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = canvas.width;
  let y0 = canvas.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const i = (y * canvas.width + x) * 4;
      if (data[i] === data[0] && data[i + 1] === data[1] && data[i + 2] === data[2]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { pictureWidth: canvas.width, pictureHeight: canvas.height, left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}, png.toString('base64'));

/** Opens the Export menu from its key in the More panel, and returns one of its actions. */
async function exportAction(page: Page, name: RegExp): Promise<Locator> {
  if (!(await morePanel(page).isVisible())) await moreKey(page).click();
  await expect(morePanel(page)).toBeVisible();
  const action = page.getByRole('menuitem', { name });
  if (!(await action.isVisible())) {
    const key = exportKey(page);
    await key.scrollIntoViewIfNeeded();
    await key.click();
  }
  await expect(action).toBeVisible();
  return action;
}

for (const look of LOOKS) {
  test(`the PNG export holds every living grid whole where the Viz panel scrolls as one (390 x 339, 844 x 339), and holds the side-by-side grids at 1440, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(300_000);
    await keepRecordedCanvas(page);
    const run = await pairRun(request);
    for (const size of EXPORT_SIZES) {
      await test.step(`${size.width} x ${size.height}`, async () => {
        const where = `${size.width} x ${size.height}, ${look}, the PNG export`;
        const scrolls = size.height <= 500;
        await openRun(page, run, look, size);
        await painted(page);
        if (!(await morePanel(page).isVisible())) await moreKey(page).click();
        await expect(morePanel(page)).toBeVisible();
        await gridsDrawn(page);

        // Where each grid stands in the panel with nothing scrolled: its place in the panel laid out in full.
        await scrollBack(page);
        await painted(page);
        const laidOut = await readPanel(page);

        const key = exportKey(page);
        await key.scrollIntoViewIfNeeded();
        await key.click();
        await expect(pngAction(page)).toBeVisible();
        await painted(page);
        const atExport = await readGrid(page);
        const [download] = await Promise.all([page.waitForEvent('download'), pngAction(page).click()]);
        await download.saveAs(`${PICTURES}/export-${size.width}x${size.height}-${look}.png`);
        const png = readFileSync(`${PICTURES}/export-${size.width}x${size.height}-${look}.png`);
        const pictureWidth = png.readUInt32BE(16);
        const pictureHeight = png.readUInt32BE(20);

        // The test's own ground: the panel draws its grids, and where it scrolls as one a grid stands outside its view.
        expect(png.subarray(1, 4).toString('latin1'), `${where}: the download is a PNG`).toBe('PNG');
        expect(laidOut.grids.length, `${where}: the panel draws a living grid`).toBeGreaterThan(0);
        if (scrolls) {
          expect(atExport, `${where}: the grid has a drawing outside the scroll window`).not.toBeNull();
          expect(atExport!.shownHeight, `${where}: the grid is clipped when the export is taken`).toBeLessThan(atExport!.height - 0.5);
        }

        const lowest = Math.max(...laidOut.grids.map(g => g.top + g.height));
        test.info().annotations.push({
          type: `the PNG export, ${size.width} x ${size.height}`,
          description: `${pictureWidth} x ${pictureHeight} px for a panel view ${laidOut.width.toFixed(1)} x ${laidOut.height.toFixed(1)} px; the lowest grid ends ${lowest.toFixed(1)} px down the panel laid out in full`,
        });
        expect.soft(pictureWidth, `${where}: as wide as the panel at twice its size`).toBe(Math.round(laidOut.width * EXPORT_SCALE));
        expect.soft(pictureHeight, `${where}: tall enough to hold every grid whole (${pictureHeight} px for grids that end ${(lowest * EXPORT_SCALE).toFixed(1)} px down)`).toBeGreaterThanOrEqual(Math.floor(lowest * EXPORT_SCALE) - 1);
        if (!scrolls) expect.soft(pictureHeight, `${where}: the full panel at twice its size`).toBe(Math.round(laidOut.height * EXPORT_SCALE));
        const drawn = await drawnIn(page, png, laidOut.grids.map(g => ({ left: g.left * EXPORT_SCALE, top: g.top * EXPORT_SCALE, width: g.width * EXPORT_SCALE, height: g.height * EXPORT_SCALE })));
        laidOut.grids.forEach((g, i) => {
          expect.soft(drawn[i], `${where}: grid ${i + 1} is drawn where it stands in the panel laid out in full (${g.top.toFixed(1)} to ${(g.top + g.height).toFixed(1)} px down)`).toBe(true);
        });

        // The timelapse, where the panel scrolls as one on a phone: its frames keep the panel's proportions.
        if (size !== SHORT) return;
        const lapse = `${size.width} x ${size.height}, ${look}, the timelapse`;
        const inPicture = await pngBox(page, png);
        expect(inPicture, `${lapse}: the PNG export holds a drawing to compare with`).not.toBeNull();
        const proportion = (box: DrawnBox) => box.width / box.height;
        await (await exportAction(page, /^REC/)).click();
        let frame: DrawnBox | null = null;
        await expect.poll(async () => { frame = await recordedBox(page); return frame !== null; }, { message: `${lapse}: the recording draws its first frame`, timeout: 20_000 }).toBe(true);
        await painted(page);
        const atStart = (await recordedBox(page)) ?? frame!;
        // The panel's height changes under the recording: the More panel closes.
        await moreKey(page).click();
        await expect(morePanel(page)).toBeHidden();
        await playRow(page).evaluate(el => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
        await painted(page);
        await painted(page);
        const offscreen = await readGrid(page);
        expect(offscreen?.shownHeight, `${lapse}: the recording continues with the grid entirely out of view`).toBe(0);
        const afterChange = await recordedBox(page);
        if (afterChange) {
          expect(afterChange.width, `${lapse}: the offscreen frame still contains the grid's pixels`).toBeGreaterThan(atStart.width * 0.8);
          expect(afterChange.height, `${lapse}: the offscreen frame still contains the grid's full height`).toBeGreaterThan(atStart.height * 0.8);
        }
        const [video] = await Promise.all([page.waitForEvent('download'), (await exportAction(page, /^STOP/)).click()]);
        expect.soft(video.suggestedFilename(), `${lapse}: stopping it downloads the recording`).toMatch(/^paracosm-timelapse-.*\.webm$/);

        test.info().annotations.push({
          type: `the timelapse, ${size.width} x ${size.height}`,
          description: `the PNG export draws ${inPicture!.width} x ${inPicture!.height} px; the first frame draws ${atStart.width} x ${atStart.height} px in a ${atStart.pictureWidth} x ${atStart.pictureHeight} px frame${afterChange ? `, and ${afterChange.width} x ${afterChange.height} px after the More panel closed` : ''}`,
        });
        const startRatio = proportion(atStart) / proportion(inPicture!);
        expect.soft(Math.abs(startRatio - 1), `${lapse}: the first frame keeps the panel's proportions (${atStart.width} x ${atStart.height} px drawn, against ${inPicture!.width} x ${inPicture!.height} px in the PNG export: ${startRatio.toFixed(3)} times as wide for its height)`).toBeLessThanOrEqual(PROPORTION_SLACK);
        expect.soft(afterChange, `${lapse}: a frame is drawn after the More panel closed`).not.toBeNull();
        if (afterChange) {
          const changeRatio = proportion(afterChange) / proportion(inPicture!);
          expect.soft(Math.abs(changeRatio - 1), `${lapse}: the frame keeps the panel's proportions after the panel's height changed (${afterChange.width} x ${afterChange.height} px drawn: ${changeRatio.toFixed(3)} times as wide for its height)`).toBeLessThanOrEqual(PROPORTION_SLACK);
        }
      });
    }
  });
}

// ── One press of ?, one overlay ──────────────────────────────────────────

test('on the Viz tab one press of ? opens the help overlay alone and a second closes it; on a tab without a help of its own ? opens the Keyboard shortcuts overlay', async ({ page, request }) => {
  test.setTimeout(180_000);
  const run = await pairRun(request);
  await openRun(page, run, 'dark', sizeAt(1440));
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
  /** Takes focus off every control, so the key goes to the page. */
  const blur = () => page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });

  await blur();
  await page.keyboard.press('?');
  await painted(page);
  await expect.soft(helpDialog(page), 'on the Viz tab ? opens the help overlay').toBeVisible();
  await expect.soft(shortcuts, 'on the Viz tab the same press opens no second overlay').toHaveCount(0);
  await page.keyboard.press('?');
  await painted(page);
  await expect.soft(helpDialog(page), 'a second ? closes the help overlay').toHaveCount(0);
  await expect.soft(shortcuts, 'the second press opens no other overlay either').toHaveCount(0);
  for (let i = 0; i < 2 && ((await shortcuts.count()) + (await helpDialog(page).count())) > 0; i += 1) await page.keyboard.press('Escape');

  // A tab without a help of its own: ? opens the page's shortcuts overlay, and closes it again.
  await page.goto(`${SERVER}/sim?tab=settings`);
  await expect(page.locator('.viz-content')).toHaveCount(0);
  // The page takes the key once it has mounted: press until the overlay shows.
  await expect(async () => {
    await blur();
    if ((await shortcuts.count()) === 0) await page.keyboard.press('?');
    await expect(shortcuts).toBeVisible({ timeout: 1_000 });
  }, 'on the Settings tab ? opens the Keyboard shortcuts overlay').toPass({ timeout: 30_000 });
  await page.keyboard.press('?');
  await expect.soft(shortcuts, 'a second ? closes it').toHaveCount(0);
});
