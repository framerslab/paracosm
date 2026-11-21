/**
 * Rows of keys on a phone, and the living grid's window under the turn's words.
 *
 * Every row of keys stays one row at every width from 320 px. When its keys
 * do not fit, the row shows fewer keys first, then moves some into a More
 * panel, then scrolls sideways on one row with a visible fade at each edge
 * that hides keys and a named Previous and Next key beside it. Each of those
 * keys is disabled at its end, moves about one view, glides, and jumps in one
 * step under reduced motion. No key is made smaller to fit: on a phone every
 * key is 44 px tall or more. And the living grid is never covered: on a phone
 * the turn's words never shrink the grid's window.
 *
 * - The Viz tab's toolbar is one row at 320, 390 and 1440 in both looks, in
 *   each of its five modes. In FORGE mode it holds "Forged toolbox · N" beside
 *   the mode, for the stored pair run (12 tools) and the 24-actor run (286
 *   tools). On a phone the mode menu is wide enough for its whole chosen word,
 *   every key is 44 px tall or more, and the More panel is one row of 44 px
 *   keys that holds the diff and help keys the row has no room for.
 * - The Sim tab's evidence row (Forged Toolbox and the Side-by-side and
 *   Constellation switch) is one row at 320, 390 and 1440 in both looks, with
 *   44 px keys on a phone.
 * - At 390 x 844, on every turn of the stored Mars Genesis pair run and so on
 *   the turn with the longest words, the living grid's window with the turn's
 *   words open is at least as tall as with them folded.
 *
 * The stored runs are the real server's: the pair run that forged tools
 * (tests-e2e/support/shared-run-server.ts), the 24-actor run
 * (tests-e2e/support/cohort-run-server.ts) and the pair run with the hosted
 * demo's recorded words (tests-e2e/support/viz-replay-server.ts), each played
 * through the server's own replay route.
 *
 * Pictures of each surface at 320, 390 and 1440 in both looks go to
 * test-pictures/phone-rows-and-grid/, which CI uploads. Each is taken before
 * that surface's checks, so a failing run leaves them too.
 */
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { COHORT_SERVER, LOOKS, PAIR_SERVER, RUNS, pairSessionId, replayUrl, sessionIdByName, useLook, type Look } from '../support/forge-view-pages';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stored runs live on local servers of their own.');

test.use({ deviceScaleFactor: 2 });

const PICTURES = 'test-pictures/phone-rows-and-grid';
/** The stored pair run with the hosted demo's words: tests-e2e/support/viz-replay-server.ts. */
const VIZ_SERVER = 'http://127.0.0.1:3466';
const ARIA = 'Aria Chen';
const DIETRICH = 'Dietrich Voss';

/** The widths every row is read at: the narrowest phone, a phone and a desktop. */
const WIDTHS = [1440, 390, 320] as const;
/** Below this width a key is a phone's: 44 px tall or more. */
const PHONE_BELOW = 900;
const PHONE_TARGET = 44;

const sizeOf = (width: number) => ({ width, height: width < PHONE_BELOW ? 844 : 900 });

const MODES = ['living', 'mood', 'forge', 'ecology', 'divergence'] as const;
type Mode = (typeof MODES)[number];

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

/** One row of keys as the page lays it out. */
interface RowRead {
  /** How many of the row's own parts are drawn. */
  parts: number;
  /** Every drawn part shares one line: the lowest top is above the highest bottom. */
  oneRow: boolean;
  /** The row scrolls sideways: its keys are wider than its window and it lets them scroll. */
  scrolls: boolean;
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
  /** Parts that stand outside the row's window while the row does not scroll. */
  outside: string[];
  /** The row's window ends inside the page's. */
  inWindow: boolean;
  /** The mask the row is drawn through: its edge fade. */
  fade: string;
  /** Each key, menu and tab in the row, with its height. */
  keys: Array<{ name: string; height: number }>;
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
    return {
      parts: shown.length,
      oneRow: rects.length <= 1 || Math.max(...rects.map(r => r.top)) < Math.min(...rects.map(r => r.bottom)),
      scrolls,
      scrollLeft: el.scrollLeft,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      outside: scrolls ? [] : shown.filter((_, i) => rects[i].left < left - 0.5 || rects[i].right > right + 0.5).map(named),
      inWindow: box.left >= -0.5 && box.right <= document.documentElement.clientWidth + 0.5,
      fade: cs.getPropertyValue('mask-image') || cs.getPropertyValue('-webkit-mask-image') || 'none',
      keys: Array.from(el.querySelectorAll('button, select, [role="tab"]')).filter(drawn).map(c => ({ name: named(c), height: c.getBoundingClientRect().height })),
    };
  });
}

/** The page does not scroll sideways. */
const pageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The keys of a row that scrolls: its named Previous and Next keys, beside the row. */
const previousKey = (row: Locator) => row.locator('xpath=..').getByRole('button', { name: /^Show previous / });
const nextKey = (row: Locator) => row.locator('xpath=..').getByRole('button', { name: /^Show next / });

/**
 * One row of keys at one width: one row, inside the window, keys 44 px tall
 * on a phone, and, when its keys are wider than its window, a row that
 * scrolls with an edge fade and its Previous and Next keys. Soft checks, so
 * one run names every row that misses.
 */
async function expectOneRow(page: Page, row: Locator, where: string, width: number): Promise<RowRead> {
  const read = await readRow(row);
  expect.soft(read.parts, `${where}: the row draws its keys`).toBeGreaterThan(0);
  expect.soft(read.oneRow, `${where}: the row is one row`).toBe(true);
  expect.soft(read.outside, `${where}: no key stands outside the row while it does not scroll`).toEqual([]);
  expect.soft(read.inWindow, `${where}: the row ends inside the window`).toBe(true);
  expect.soft(await pageScroll(page), `${where}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
  if (width < PHONE_BELOW) {
    expect.soft(read.keys.filter(k => k.height < PHONE_TARGET - 0.5).map(k => `${k.name}: ${k.height.toFixed(1)} px`), `${where}: every key is 44 px tall on a phone`).toEqual([]);
  }
  if (read.scrolls) {
    const previous = previousKey(row);
    const next = nextKey(row);
    expect.soft(read.fade, `${where}: the row that scrolls fades at its edge`).toContain('gradient');
    await expect.soft(previous, `${where}: the row that scrolls has its Previous key`).toBeVisible();
    await expect.soft(next, `${where}: the row that scrolls has its Next key`).toBeVisible();
    if (width < PHONE_BELOW) {
      for (const key of [previous, next]) {
        const box = await key.boundingBox();
        expect.soft(box?.height ?? 0, `${where}: the row's ${await key.getAttribute('aria-label')} is 44 px tall on a phone`).toBeGreaterThanOrEqual(PHONE_TARGET - 0.5);
      }
    }
  }
  return read;
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
  await next.click();
  await expect.poll(() => row.evaluate(el => el.scrollLeft), { message: `${where}: Next moves about one view` })
    .toBeGreaterThanOrEqual(Math.min(counted.view * 0.5, counted.end) - 1);
  await page.waitForTimeout(600);
  expect.soft(await page.evaluate(() => (window as unknown as { __rowScrolls: number }).__rowScrolls), `${where}: the press glides through several frames`).toBeGreaterThan(1);
  await expect.soft(previous, `${where}: Previous is enabled once the row has moved`).toBeEnabled();

  // To the end: Next is disabled there.
  for (let i = 0; i < 12 && !(await next.isDisabled()); i += 1) {
    await next.click();
    await page.waitForTimeout(500);
  }
  await expect.soft(next, `${where}: Next is disabled at the end`).toBeDisabled();
  expect.soft(await row.evaluate(el => el.scrollWidth - el.clientWidth - el.scrollLeft), `${where}: Next brought the row to its end`).toBeLessThanOrEqual(1);

  // Under reduced motion a press moves the row in one step.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const atEnd = await row.evaluate(el => el.scrollLeft);
  await previous.click();
  const afterPress = await row.evaluate(el => el.scrollLeft);
  expect.soft(afterPress, `${where}: under reduced motion Previous moves the row at once`).toBeLessThan(atEnd - 1);
  await painted(page);
  expect.soft(await row.evaluate(el => el.scrollLeft), `${where}: under reduced motion the row does not glide on`).toBe(afterPress);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await row.evaluate((el) => { el.scrollLeft = 0; });
}

// ── The Viz tab's toolbar ────────────────────────────────────────────────

/** The More key of the Viz toolbar, whose row is the toolbar. */
const moreKey = (page: Page) => page.getByRole('button', { name: /^(Show|Hide) (advanced|more) tools/ });
/** The Viz toolbar: the row that holds the More key. */
const vizToolbar = (page: Page) => moreKey(page).locator('xpath=..');
/** The More panel's row of tools. */
const morePanel = (page: Page) => page.getByRole('toolbar', { name: 'Viz tools' });
const modeMenu = (page: Page) => page.getByRole('combobox', { name: 'Grid viz mode' });

/** Opens a stored run's replay on the Viz tab in one look at 1440, played in to its end. */
async function openViz(page: Page, request: APIRequestContext, run: 'pair' | string, look: Look, timeout: number): Promise<void> {
  const server = run === 'pair' ? PAIR_SERVER : COHORT_SERVER;
  const id = run === 'pair' ? await pairSessionId(request) : await sessionIdByName(request, COHORT_SERVER, run);
  await page.setViewportSize(sizeOf(1440));
  await useLook(page, look);
  // The Viz tab keeps its mode on the device: each open starts from LIVING.
  await page.addInitScript(() => { window.localStorage.removeItem('paracosm:gridMode'); });
  await page.goto(replayUrl(server, id, 'viz'));
  await lookShown(page, look);
  await replayComplete(page, timeout);
}

/** Chooses a grid mode: the mode menu on a phone, the mode's tab wider. */
async function chooseMode(page: Page, mode: Mode): Promise<void> {
  const menu = modeMenu(page);
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

/**
 * The mode menu's width against the width its chosen word needs: a copy of
 * the menu holding only the chosen word, laid out at its own width beside it.
 */
async function modeMenuWord(page: Page): Promise<{ word: string; width: number; needed: number }> {
  return modeMenu(page).evaluate((el) => {
    const menu = el as HTMLSelectElement;
    const probe = menu.cloneNode(true) as HTMLSelectElement;
    Array.from(probe.options).forEach((o, i) => { if (i !== menu.selectedIndex) o.remove(); });
    probe.removeAttribute('aria-label');
    probe.setAttribute('aria-hidden', 'true');
    probe.tabIndex = -1;
    Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', left: '0', top: '0', width: 'auto', minWidth: '0', maxWidth: 'none', flex: 'none' });
    menu.parentElement!.append(probe);
    const needed = probe.getBoundingClientRect().width;
    probe.remove();
    return { word: menu.options[menu.selectedIndex]?.text ?? '', width: menu.getBoundingClientRect().width, needed };
  });
}

/** The toolbar in one mode at one width: one row, its menu's whole word, its keys, and its More panel. */
async function expectToolbar(page: Page, mode: Mode, width: number, where: string): Promise<void> {
  const row = vizToolbar(page);
  await expect(row).toBeVisible();
  const read = await expectOneRow(page, row, `${where}, the toolbar`, width);
  if (read.scrolls) await expectScrollKeys(page, row, `${where}, the toolbar`);

  if (await modeMenu(page).isVisible()) {
    const menu = await modeMenuWord(page);
    expect.soft(menu.width, `${where}: the mode menu shows its whole chosen word "${menu.word}" (${menu.width.toFixed(1)} px of ${menu.needed.toFixed(1)})`).toBeGreaterThanOrEqual(menu.needed - 0.5);
  }

  // The More panel: one row of keys under the toolbar, with the toolbar still one row.
  await moreKey(page).click();
  const panel = morePanel(page);
  await expect(panel).toBeVisible();
  await painted(page);
  const toolbarOpen = await readRow(row);
  expect.soft(toolbarOpen.oneRow, `${where}: the toolbar stays one row with its More panel open`).toBe(true);
  const panelRead = await expectOneRow(page, panel, `${where}, the More panel`, width);
  if (panelRead.scrolls) await expectScrollKeys(page, panel, `${where}, the More panel`);
  // Every key the toolbar has stands in its row or its More panel.
  await expect.soft(page.getByRole('button', { name: /^(Show|Hide) A-vs-B diff overlay/ }), `${where}: the diff key is in reach`).toBeVisible();
  await expect.soft(page.getByRole('button', { name: 'Open help overlay (shortcut: ?)', exact: true }), `${where}: the help key is in reach`).toBeVisible();
  if (mode === 'forge') await expect.soft(page.getByRole('button', { name: /^Forged toolbox · / }), `${where}: the forged toolbox key is in reach`).toBeVisible();
  await moreKey(page).click();
  await expect(panel).toBeHidden();
}

for (const look of LOOKS) {
  test(`the Viz toolbar is one row in every mode at 320, 390 and 1440, with its mode's whole word and 44 px keys on a phone, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(300_000);
    await openViz(page, request, 'pair', look, 60_000);
    for (const width of WIDTHS) {
      await page.setViewportSize(sizeOf(width));
      await painted(page);
      for (const mode of MODES) {
        await test.step(`${mode} at ${width}`, async () => {
          await chooseMode(page, mode);
          if (mode === 'forge') {
            await expect(page.getByRole('button', { name: 'Forged toolbox · 12', exact: true })).toBeVisible();
            await picture(page, `${width}-${look}-viz-toolbar-forge`, vizToolbar(page), 260);
          }
          await expectToolbar(page, mode, width, `${width}, ${look}, ${mode}`);
        });
      }
      await chooseMode(page, 'living');
    }
  });
}

for (const look of LOOKS) {
  test(`the Viz toolbar of the 24-actor run is one row in FORGE mode with "Forged toolbox · 286" at 320, 390 and 1440, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(300_000);
    await openViz(page, request, RUNS.dozens, look, 90_000);
    for (const width of WIDTHS) {
      await test.step(`FORGE at ${width}`, async () => {
        await page.setViewportSize(sizeOf(width));
        await painted(page);
        await chooseMode(page, 'forge');
        await expect(page.getByRole('button', { name: 'Forged toolbox · 286', exact: true })).toBeVisible();
        await picture(page, `${width}-${look}-viz-toolbar-forge-24-actors`, vizToolbar(page), 260);
        await expectToolbar(page, 'forge', width, `${width}, ${look}, the 24-actor run's FORGE`);
      });
    }
  });
}

// ── The Sim tab's evidence row ───────────────────────────────────────────

/** The Sim footer's row of evidence keys: the row that holds the Forged Toolbox key. */
const evidenceRow = (page: Page) => page.getByRole('button', { name: /^Open Forged Toolbox/ }).locator('xpath=..');

for (const look of LOOKS) {
  test(`the Sim tab's evidence row is one row at 320, 390 and 1440 with 44 px keys on a phone, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(sizeOf(1440));
    await useLook(page, look);
    await page.goto(replayUrl(PAIR_SERVER, await pairSessionId(request), 'sim'));
    await lookShown(page, look);
    await replayComplete(page, 60_000);
    const region = page.getByRole('region', { name: 'Simulation evidence' });
    for (const width of WIDTHS) {
      await test.step(`${width}`, async () => {
        await page.setViewportSize(sizeOf(width));
        await painted(page);
        await expect(region).toBeVisible();
        await picture(page, `${width}-${look}-sim-evidence-row`, region, 220);
        const row = evidenceRow(page);
        // The Forged Toolbox key and the layout switch stand in the row.
        await expect.soft(row.getByRole('group', { name: 'Sim layout' }), `${width}, ${look}: the layout switch is in the evidence row`).toBeVisible();
        const read = await expectOneRow(page, row, `${width}, ${look}, the evidence row`, width);
        if (read.scrolls) await expectScrollKeys(page, row, `${width}, ${look}, the evidence row`);
      });
    }
  });
}

// ── The living grid's window under the turn's words ─────────────────────

/** The id of the stored run with two commanders, and its number of turns, from the server's own replay route. */
async function pairRun(request: APIRequestContext): Promise<{ id: string; turns: number }> {
  const res = await request.get(`${VIZ_SERVER}/sessions`);
  expect(res.ok()).toBe(true);
  const { sessions } = await res.json() as { sessions: Array<{ id: string }> };
  for (const { id } of sessions) {
    const replay = await request.get(`${VIZ_SERVER}/sessions/${encodeURIComponent(id)}/replay`);
    expect(replay.ok()).toBe(true);
    const frames: Array<{ type: string; leader: string; data: Record<string, unknown> }> = [];
    for (const chunk of (await replay.text()).split('\n\n')) {
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (event === 'sim' && data) frames.push(JSON.parse(data));
    }
    if (new Set(frames.map(f => f.leader)).size !== 2) continue;
    return { id, turns: Math.max(...frames.filter(f => f.type === 'systems_snapshot').map(f => Number(f.data.turn))) };
  }
  throw new Error('The server stores no run with two commanders.');
}

/** The turn's words for one commander: the line that opens "A: Aria Chen" or "B: Dietrich Voss". */
const turnLine = (page: Page, label: 'A' | 'B', name: string) => page.locator('div').filter({ hasText: new RegExp(`^${label}: ${name}`) });

/**
 * How much of the shown living grid stands in its window: the height of the
 * canvas's part inside the scroll window that holds the grids, read from the
 * window's top.
 */
async function gridWindow(page: Page): Promise<{ shown: number; window: number; canvas: number }> {
  return page.evaluate(() => {
    const row = document.querySelector('.viz-content .leaders-row') as HTMLElement | null;
    const canvas = Array.from(document.querySelectorAll('[data-testid^="living-colony-grid-"] canvas'))
      .find(c => c.getBoundingClientRect().height > 0) as HTMLCanvasElement | undefined;
    if (!row || !canvas) return { shown: -1, window: -1, canvas: -1 };
    row.scrollTop = 0;
    const box = row.getBoundingClientRect();
    const top = box.top + row.clientTop;
    const bottom = top + row.clientHeight;
    const c = canvas.getBoundingClientRect();
    return { shown: Math.max(0, Math.min(bottom, c.bottom) - Math.max(top, c.top)), window: row.clientHeight, canvas: c.height };
  });
}

const foldKey = (page: Page) => page.getByRole('button', { name: 'Collapse per-actor outcomes', exact: true });
const openKey = (page: Page) => page.getByRole('button', { name: 'Expand per-actor outcomes', exact: true });
const stepBack = (page: Page) => page.getByRole('button', { name: 'Previous turn', exact: true });

for (const look of LOOKS) {
  test(`at 390 x 844 the living grid keeps a window with the turn's words open at least as tall as with them folded, on every turn, in the ${look} look`, async ({ page, request }) => {
    test.setTimeout(240_000);
    const run = await pairRun(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await useLook(page, look);
    await page.goto(`${VIZ_SERVER}/sim?replay=${encodeURIComponent(run.id)}&tab=viz`);
    await lookShown(page, look);
    await expect(page.getByRole('img', { name: new RegExp(`^${ARIA} colony, turn ${run.turns}\\.`) })).toBeAttached({ timeout: 30_000 });

    // Each turn from the last back to the first: the words' length, and the
    // grid's window with them open and folded.
    const turns: Array<{ turn: number; words: number; open: number; folded: number }> = [];
    for (let turn = run.turns; turn >= 1; turn -= 1) {
      if (turn < run.turns) {
        await stepBack(page).click();
        await expect(page.getByRole('img', { name: new RegExp(`^${ARIA} colony, turn ${turn}\\.`) })).toBeAttached();
      }
      await expect(foldKey(page)).toBeVisible();
      await painted(page);
      const words = ((await turnLine(page, 'A', ARIA).first().textContent()) ?? '').length
        + ((await turnLine(page, 'B', DIETRICH).first().textContent()) ?? '').length;
      const open = await gridWindow(page);
      await foldKey(page).click();
      await expect(openKey(page)).toBeVisible();
      await painted(page);
      const folded = await gridWindow(page);
      await openKey(page).click();
      await expect(foldKey(page)).toBeVisible();
      turns.push({ turn, words, open: open.shown, folded: folded.shown });
    }

    // Pictures of the turn with the longest words, open and folded, at 390 and at 1440.
    const longest = turns.reduce((a, b) => (b.words > a.words ? b : a));
    for (let turn = 1; turn < longest.turn; turn += 1) await page.getByRole('button', { name: 'Next turn', exact: true }).click();
    await expect(page.getByRole('img', { name: new RegExp(`^${ARIA} colony, turn ${longest.turn}\\.`) })).toBeAttached();
    await painted(page);
    await picture(page, `390-${look}-viz-grid-window-words-open`);
    await foldKey(page).click();
    await painted(page);
    await picture(page, `390-${look}-viz-grid-window-words-folded`);
    await openKey(page).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await painted(page);
    await picture(page, `1440-${look}-viz-grid-window-words-open`);

    for (const t of turns) {
      expect.soft(t.folded, `T${t.turn}: the grid shows in its window with the words folded`).toBeGreaterThan(0);
      expect.soft(t.open, `T${t.turn} (${t.words} characters of words): with the words open the grid keeps a window of ${t.open.toFixed(1)} px, at least the ${t.folded.toFixed(1)} px it has with them folded`).toBeGreaterThanOrEqual(t.folded - 0.5);
    }
    expect(longest.words, 'the run has turn words to read').toBeGreaterThan(0);
  });
}
