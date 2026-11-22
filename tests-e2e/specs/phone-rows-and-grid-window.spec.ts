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
 * - The More panel's Export menu, drawn over the page so a row that scrolls
 *   cannot clip it: opened, it holds focus on its first action, the arrow
 *   keys move through its actions, and Escape and Tab hand focus back to the
 *   panel's keys; it closes when the panel scrolls its key out of view; and
 *   on a screen too short for it below its key, every action stays inside
 *   the window. On a phone the turn's outcomes below the grid are a status
 *   region of their own, so a screen reader reads them as the turn changes.
 * - From 481 to 899 px, where the mode tabs stand in the Viz toolbar, the
 *   toolbar is one row and every key in it, each mode tab included, is 44 px
 *   tall, at 600 px and on a phone on its side (844 x 390).
 * - Below 900 px every key of the Viz toolbar, its More panel and the Sim
 *   evidence row is 44 px wide as well as 44 px tall, at 320, 390, 600 and
 *   844 x 390. Below 900 px the toolbar holds its diff and help keys in its
 *   More panel, so its row scrolls only once its More panel holds them.
 * - At 390 x 844 the turn's outcomes stand below the whole living grid, never
 *   over its lower part.
 * - The open Export menu stays by its key when the toolbar moves with nothing
 *   scrolled or resized, as when a turn's words grow above it.
 * - A focused Previous or Next key whose end the row reaches hands focus to
 *   the other key, whether a press, a swipe or a trackpad moved the row.
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
 * Puts back any box around a row that a pointer action scrolled sideways.
 * At phone widths the Viz tab's play controls stand wider than the tab (a
 * fault of their own), so the tab's clipped box can be scrolled sideways,
 * and a click Playwright retries scrolls it to bring its key into view,
 * moving every row on the tab with it. Each box put back is named in the
 * test's annotations.
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

/**
 * One row of keys at one width: one row, inside the window, keys 44 px tall
 * on a phone, and, when its keys are wider than its window, a row that
 * scrolls with an edge fade and its Previous and Next keys. Soft checks, so
 * one run names every row that misses.
 */
async function expectOneRow(page: Page, row: Locator, where: string, width: number): Promise<RowRead> {
  await unshift(row);
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
  for (let i = 0; i < 12 && !(await next.isDisabled()); i += 1) {
    await pressAndSettle(row, next, `${where}: Next press ${i + 2} moves the row and it comes to rest`);
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
  await unshift(row);
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

test('from 481 to 899 px the Viz toolbar is one row of 44 px keys, its mode tabs among them, in LIVING and FORGE, at 600 and on a phone on its side', async ({ page, request }) => {
  test.setTimeout(240_000);
  await openViz(page, request, 'pair', 'dark', 60_000);
  for (const size of [{ width: 600, height: 900 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await painted(page);
    for (const mode of ['living', 'forge'] as const) {
      await test.step(`${mode} at ${size.width} x ${size.height}`, async () => {
        await chooseMode(page, mode);
        // The mode tabs stand in the row at these widths, not the menu.
        await expect(page.locator(`[data-grid-mode="${mode}"]`)).toBeVisible();
        await picture(page, `${size.width}x${size.height}-dark-viz-toolbar-${mode}`, vizToolbar(page), 200);
        const where = `${size.width} x ${size.height}, dark, ${mode}, the toolbar`;
        const read = await expectOneRow(page, vizToolbar(page), where, size.width);
        if (read.scrolls) await expectScrollKeys(page, vizToolbar(page), where);
      });
    }
  }
});

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

    // Each turn from the last back to the first: the words' length, how much
    // of the grid shows with them open and folded, and the scroll window's own
    // height in both states.
    const turns: Array<{ turn: number; words: number; open: number; folded: number; openWindow: number; foldedWindow: number }> = [];
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
      turns.push({ turn, words, open: open.shown, folded: folded.shown, openWindow: open.window, foldedWindow: folded.window });
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
      expect.soft(t.openWindow, `T${t.turn}: with the words open the grid's scroll window is ${t.openWindow.toFixed(1)} px tall, at least the ${t.foldedWindow.toFixed(1)} px it is with them folded`).toBeGreaterThanOrEqual(t.foldedWindow - 0.5);
    }
    expect(longest.words, 'the run has turn words to read').toBeGreaterThan(0);
  });
}

// ── The Export menu in the More panel, and the turn's outcomes on a phone ─

const exportKey = (page: Page) => morePanel(page).getByRole('button', { name: 'Export options', exact: true });
const exportMenu = (page: Page) => page.getByRole('menu');
const exportItem = (page: Page, name: RegExp) => page.getByRole('menuitem', { name });

/** Opens the More panel at a phone's width on the stored pair run, in the dark look. */
async function openMorePanel(page: Page, request: APIRequestContext, width: number): Promise<void> {
  await openViz(page, request, 'pair', 'dark', 60_000);
  await page.setViewportSize(sizeOf(width));
  await painted(page);
  await moreKey(page).click();
  await expect(morePanel(page)).toBeVisible();
}

/**
 * Puts the Export key outside the More panel's window by scrolling the panel
 * to one end or the other. True when one end hides the key.
 */
const scrollExportKeyAway = (page: Page) => morePanel(page).evaluate((row) => {
  const key = row.querySelector('[aria-label="Export options"]');
  if (!key) return false;
  for (const left of [0, row.scrollWidth]) {
    row.scrollLeft = left;
    const r = key.getBoundingClientRect();
    const b = row.getBoundingClientRect();
    const x = r.left + r.width / 2;
    if (x < b.left || x > b.right) return true;
  }
  return false;
});

test('the Export menu takes focus, moves with the arrow keys, and hands focus back on Escape and Tab, at 320', async ({ page, request }) => {
  test.setTimeout(180_000);
  await openMorePanel(page, request, 320);
  const key = exportKey(page);
  await key.scrollIntoViewIfNeeded();

  // Opened from the keyboard, the menu holds focus on its first action.
  await key.focus();
  await page.keyboard.press('Enter');
  await expect(exportMenu(page)).toBeVisible();
  await expect(exportItem(page, /^PNG/)).toBeFocused();

  // The arrow keys move through the actions and wrap at the ends.
  await page.keyboard.press('ArrowDown');
  await expect(exportItem(page, /^(REC|STOP)/)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(exportItem(page, /^JSON/)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(exportItem(page, /^PNG/)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(exportItem(page, /^JSON/)).toBeFocused();

  // Escape closes it and gives focus back to the Export key.
  await page.keyboard.press('Escape');
  await expect(exportMenu(page)).toBeHidden();
  await expect(key).toBeFocused();

  // Tab from the menu closes it and goes on to the key after Export.
  await page.keyboard.press('Enter');
  await expect(exportItem(page, /^PNG/)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(exportMenu(page)).toBeHidden();
  await expect(morePanel(page).getByRole('button', { name: 'Open grid settings', exact: true })).toBeFocused();

  // Shift+Tab from the menu closes it and goes back to the Export key.
  await key.focus();
  await page.keyboard.press('Enter');
  await expect(exportItem(page, /^PNG/)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(exportMenu(page)).toBeHidden();
  await expect(key).toBeFocused();
});

test('the Export menu closes when the More panel scrolls its key out of view, at 320', async ({ page, request }) => {
  test.setTimeout(180_000);
  await openMorePanel(page, request, 320);
  const key = exportKey(page);
  // Open, then the panel scrolls the Export key out of its window: the menu
  // closes rather than float over the page with no key under it.
  await key.scrollIntoViewIfNeeded();
  await key.click();
  await expect(exportMenu(page)).toBeVisible();
  expect(await scrollExportKeyAway(page), 'the More panel scrolls the Export key out of its window at 320').toBe(true);
  await expect(exportMenu(page)).toBeHidden();
});

test('on a screen too short for the Export menu below its key, every action stands inside the window, at 390', async ({ page, request }) => {
  test.setTimeout(180_000);
  await openMorePanel(page, request, 390);
  const key = exportKey(page);
  await key.scrollIntoViewIfNeeded();
  const keyBottom = (await key.boundingBox())!.y + (await key.boundingBox())!.height;
  // A window that ends 40 px under the Export key.
  await page.setViewportSize({ width: 390, height: Math.ceil(keyBottom + 40) });
  await painted(page);
  await key.scrollIntoViewIfNeeded();
  await key.click();
  await expect(exportMenu(page)).toBeVisible();
  await painted(page);
  const read = await page.evaluate(() => {
    const key = document.querySelector('[aria-label="Export options"]')!.getBoundingClientRect();
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    const box = menu.getBoundingClientRect();
    return {
      height: window.innerHeight,
      keyTop: key.top,
      keyBottom: key.bottom,
      menuHeight: menu.scrollHeight,
      menu: { top: box.top, bottom: box.bottom },
      items: Array.from(menu.querySelectorAll('[role="menuitem"]')).map((item) => {
        const r = item.getBoundingClientRect();
        return { name: (item.textContent ?? '').trim(), top: r.top, bottom: r.bottom };
      }),
    };
  });
  await page.screenshot({ path: `${PICTURES}/390-dark-export-menu-short-screen.png` });
  // The test's own ground: the key is in the window and the menu does not fit under it.
  expect(read.keyTop, 'the Export key stands in the window').toBeGreaterThanOrEqual(0);
  expect(read.keyBottom, 'the Export key stands in the window').toBeLessThanOrEqual(read.height);
  expect(read.height - read.keyBottom, 'the room under the Export key is less than the menu needs').toBeLessThan(read.menuHeight);
  expect.soft(read.menu.top, 'the menu starts inside the window').toBeGreaterThanOrEqual(0);
  expect.soft(read.menu.bottom, 'the menu ends inside the window').toBeLessThanOrEqual(read.height);
  for (const item of read.items) {
    expect.soft(item.top >= 0 && item.bottom <= read.height, `the ${item.name} action stands inside the window (${item.top.toFixed(1)} to ${item.bottom.toFixed(1)} of ${read.height})`).toBe(true);
  }
});

test('on a phone the turn outcomes below the grid are read out as the turn changes, and stand only once', async ({ page, request }) => {
  test.setTimeout(180_000);
  await openViz(page, request, 'pair', 'dark', 60_000);
  // Wider, the outcomes stand in the banner's own status region.
  await expect(page.getByRole('status', { name: 'Current turn narrative' }).locator('div').filter({ hasText: new RegExp(`^A: ${ARIA}`) })).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await painted(page);
  const outcomes = page.getByRole('status', { name: 'Turn outcomes' });
  await expect(outcomes, 'on a phone the outcomes below the grid are a status region').toBeAttached();
  await expect(outcomes.locator('div').filter({ hasText: new RegExp(`^A: ${ARIA}`) })).toHaveCount(1);
  await expect(outcomes.locator('div').filter({ hasText: new RegExp(`^B: ${DIETRICH}`) })).toHaveCount(1);
  await expect(page.getByRole('status', { name: 'Current turn narrative' }).locator('div').filter({ hasText: new RegExp(`^A: ${ARIA}`) }), 'the banner no longer holds the outcomes').toHaveCount(0);
});

// ── The review's follow-ups ──────────────────────────────────────────────

/** Each key, menu and tab of a row and its arrow keys that is narrower or shorter than a phone's 44 px target. */
const smallKeys = (box: Locator) => box.evaluate((el, target) => Array.from(el.querySelectorAll('button, select, [role="tab"]'))
  .filter(c => getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().width > 0)
  .map((c) => {
    const r = c.getBoundingClientRect();
    return { name: (c.getAttribute('aria-label') ?? (c as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 48), width: r.width, height: r.height };
  })
  .filter(k => k.width < target - 0.5 || k.height < target - 0.5)
  .map(k => `${k.name}: ${k.width.toFixed(1)} x ${k.height.toFixed(1)} px`), PHONE_TARGET);

/** The sizes below 900 px the rows are read at: the narrowest phone, a phone, a small tablet and a phone on its side. */
const BELOW_900 = [sizeOf(320), sizeOf(390), { width: 600, height: 900 }, { width: 844, height: 390 }];

test('below 900 px every key of the Viz toolbar, its More panel and the Sim evidence row is 44 px wide as well as 44 px tall', async ({ page, request }) => {
  test.setTimeout(300_000);
  await openViz(page, request, 'pair', 'dark', 60_000);
  for (const size of BELOW_900) {
    for (const mode of ['living', 'forge'] as const) {
      await test.step(`${mode} at ${size.width} x ${size.height}`, async () => {
        await page.setViewportSize(size);
        await painted(page);
        await chooseMode(page, mode);
        const where = `${size.width} x ${size.height}, ${mode}`;
        if (mode === 'forge') await picture(page, `review-${size.width}x${size.height}-dark-viz-toolbar-forge`, vizToolbar(page), 200);
        expect.soft(await smallKeys(vizToolbar(page).locator('xpath=..')), `${where}: every key of the toolbar is 44 by 44 px`).toEqual([]);
        await moreKey(page).click();
        await expect(morePanel(page)).toBeVisible();
        await painted(page);
        expect.soft(await smallKeys(morePanel(page).locator('xpath=..')), `${where}: every key of the More panel is 44 by 44 px`).toEqual([]);
        await moreKey(page).click();
        await expect(morePanel(page)).toBeHidden();
      });
    }
  }
  await page.setViewportSize(sizeOf(1440));
  await page.goto(replayUrl(PAIR_SERVER, await pairSessionId(request), 'sim'));
  await replayComplete(page, 60_000);
  for (const size of BELOW_900) {
    await test.step(`the evidence row at ${size.width} x ${size.height}`, async () => {
      await page.setViewportSize(size);
      await painted(page);
      expect.soft(await smallKeys(evidenceRow(page).locator('xpath=..')), `${size.width} x ${size.height}: every key of the evidence row is 44 by 44 px`).toEqual([]);
    });
  }
});

test('below 900 px the Viz toolbar holds its diff and help keys in its More panel before its row scrolls, at 600 x 900 and 844 x 390 in LIVING and FORGE', async ({ page, request }) => {
  test.setTimeout(240_000);
  await openViz(page, request, 'pair', 'dark', 60_000);
  for (const size of [{ width: 600, height: 900 }, { width: 844, height: 390 }]) {
    for (const mode of ['living', 'forge'] as const) {
      await test.step(`${mode} at ${size.width} x ${size.height}`, async () => {
        await page.setViewportSize(size);
        await painted(page);
        await chooseMode(page, mode);
        const row = vizToolbar(page);
        await unshift(row);
        const read = await readRow(row);
        // Fewer keys first, then the More panel, then a row that scrolls:
        // while the row scrolls, it holds no key the More panel holds.
        const inRow = await row.evaluate(el => Array.from(el.querySelectorAll('button'))
          .map(b => b.getAttribute('aria-label') ?? '')
          .filter(name => /^(Show|Hide) A-vs-B diff overlay|^Open help overlay/.test(name)));
        if (read.scrolls) expect.soft(inRow, `${size.width} x ${size.height}, ${mode}: the toolbar scrolls (${read.scrollWidth} of ${read.clientWidth} px) with keys its More panel holds`).toEqual([]);
        // Below 900 px the diff and help keys stand in the More panel, whether
        // or not the row would have room for them.
        await moreKey(page).click();
        await expect(morePanel(page)).toBeVisible();
        await expect.soft(morePanel(page).getByRole('button', { name: /^(Show|Hide) A-vs-B diff overlay/ }), `${size.width} x ${size.height}, ${mode}: the diff key is in the More panel`).toBeVisible();
        await expect.soft(morePanel(page).getByRole('button', { name: 'Open help overlay (shortcut: ?)', exact: true }), `${size.width} x ${size.height}, ${mode}: the help key is in the More panel`).toBeVisible();
        await moreKey(page).click();
        await expect(morePanel(page)).toBeHidden();
      });
    }
  }
});

test('at 390 x 844 the turn outcomes stand below the whole living grid, never over its lower part', async ({ page, request }) => {
  test.setTimeout(180_000);
  const run = await pairRun(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await useLook(page, 'dark');
  await page.goto(`${VIZ_SERVER}/sim?replay=${encodeURIComponent(run.id)}&tab=viz`);
  await lookShown(page, 'dark');
  await expect(page.getByRole('img', { name: new RegExp(`^${ARIA} colony, turn ${run.turns}\\.`) })).toBeAttached({ timeout: 30_000 });
  await expect(foldKey(page)).toBeVisible();
  const outcomes = page.getByRole('status', { name: 'Turn outcomes' });
  await expect(outcomes.locator('div').filter({ hasText: new RegExp(`^A: ${ARIA}`) })).toHaveCount(1);
  await painted(page);
  // The grid and the outcomes stand in one scroll window, so their places on
  // the page compare as they are.
  const read = await page.evaluate(() => {
    const grid = Array.from(document.querySelectorAll('[data-testid^="living-colony-grid-"]'))
      .find(g => g.getBoundingClientRect().height > 0)!.getBoundingClientRect();
    const slot = document.querySelector('[role="status"][aria-label="Turn outcomes"]')!.getBoundingClientRect();
    const row = document.querySelector('.viz-content .leaders-row') as HTMLElement;
    return { gridTop: grid.top, gridBottom: grid.bottom, outcomesTop: slot.top, window: row.clientHeight };
  });
  // A picture with the outcomes in the middle of the grids' window.
  await page.evaluate(() => {
    const row = document.querySelector('.viz-content .leaders-row') as HTMLElement;
    const slot = document.querySelector('[role="status"][aria-label="Turn outcomes"]')!.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    row.scrollTop += slot.top - (box.top + row.clientHeight / 2);
  });
  await painted(page);
  await picture(page, 'review-390-dark-viz-outcomes-below-grid');
  expect(read.outcomesTop, `the outcomes start at ${read.outcomesTop.toFixed(1)} px, at or below the grid's end at ${read.gridBottom.toFixed(1)} px (the grid is ${(read.gridBottom - read.gridTop).toFixed(1)} px tall in a ${read.window} px window)`).toBeGreaterThanOrEqual(read.gridBottom - 0.5);
});

test('the open Export menu stays by its key when the toolbar moves with nothing scrolled or resized, as when a turn\'s words grow, at 390', async ({ page, request }) => {
  test.setTimeout(180_000);
  await openMorePanel(page, request, 390);
  await exportKey(page).click();
  await expect(exportMenu(page)).toBeVisible();
  await painted(page);
  const where = () => page.evaluate(() => {
    const key = document.querySelector('[aria-label="Export options"]')!.getBoundingClientRect();
    const menu = document.querySelector('[role="menu"]')!.getBoundingClientRect();
    return { keyTop: key.top, keyBottom: key.bottom, menuTop: menu.top, menuBottom: menu.bottom };
  });
  const before = await where();
  const below = before.menuTop >= before.keyBottom - 0.5;
  const gapOf = (r: typeof before) => (below ? r.menuTop - r.keyBottom : r.keyTop - r.menuBottom);
  // The banner above the toolbar grows by 96 px, as when a live turn's
  // words come in: nothing scrolls and the window keeps its size.
  const moved = await page.evaluate(() => {
    const banner = document.querySelector('[role="status"][aria-label="Current turn narrative"]') as HTMLElement;
    const key = document.querySelector('[aria-label="Export options"]')!;
    const top = key.getBoundingClientRect().top;
    banner.style.paddingBottom = '96px';
    return key.getBoundingClientRect().top - top;
  });
  expect(moved, 'the taller banner moves the Export key down').toBeGreaterThan(40);
  await expect(exportMenu(page), 'the menu stays open while its key stays in view').toBeVisible();
  await expect.poll(async () => Math.abs(gapOf(await where()) - gapOf(before)), {
    message: `the menu keeps its ${gapOf(before).toFixed(1)} px gap to its key after the key moved ${moved.toFixed(1)} px`,
    timeout: 3_000,
  }).toBeLessThanOrEqual(1);
});

test('a focused arrow key whose end the row reaches hands focus to the other key, however the row got there, at 320', async ({ page, request }) => {
  test.setTimeout(180_000);
  await openMorePanel(page, request, 320);
  const panel = morePanel(page);
  await unshift(panel);
  expect((await readRow(panel)).scrolls, 'the More panel scrolls at 320').toBe(true);
  const previous = previousKey(panel);
  const next = nextKey(panel);
  await panel.evaluate((el) => { el.scrollLeft = 0; });
  await painted(page);
  await expect(previous).toBeDisabled();
  await next.focus();
  await expect(next).toBeFocused();
  // The row reaches its end by a swipe or a trackpad, not by the key.
  await panel.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await expect(next, 'Next is disabled at the end').toBeDisabled();
  await expect(previous, 'focus goes on to Previous rather than to the page').toBeFocused();
  // And back to the start the same way: focus goes on to Next.
  await panel.evaluate((el) => { el.scrollLeft = 0; });
  await expect(previous, 'Previous is disabled at the start').toBeDisabled();
  await expect(next, 'focus goes on to Next rather than to the page').toBeFocused();
});
