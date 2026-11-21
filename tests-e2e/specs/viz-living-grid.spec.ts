/**
 * The Viz tab on a replayed run: the living grid, the turn banner, the
 * highlight strip, the ECOLOGY mode and the grid settings.
 *
 * The page talks to the real server over HTTP (tests-e2e/support/viz-replay-server.ts):
 * one finished Mars Genesis pair run is stored there as a session, with a
 * second run that adds a third commander to the same colonies, so
 * /sim?replay=<id>&tab=viz plays either through the server's own replay route.
 * The spec reads the same stored stream from that route to know each turn's
 * deaths, their causes and the morale changes of each commander's outcomes.
 *
 * - The Conway tiles draw on the replay. They ease in rather than painting at
 *   full strength in one frame, a frame read two seconds after the first one
 *   that holds them differs from it, they follow the turn, they ease in again
 *   on a jump of several turns, and the panel keeps its morale tint.
 * - On a phone, where one actor shows at a time, an actor's panel that was
 *   hidden draws its tiles when shown: the second actor's when first shown,
 *   and the first actor's when shown again after the turn changed.
 * - In the pair view of a run with three commanders, a panel whose commander
 *   changes seeds its tiles from the new colony and eases them in.
 * - Each turn-banner line says what the commander chose, and a turn with
 *   deaths or a morale crack says so: the deaths with their cause, and with
 *   the largest cause's own count when the turn has several.
 * - The highlight strip names each side's losses that turn: no negative
 *   count, and each count with its own noun.
 * - ECOLOGY on a replay draws the living grid under its quadrants, and the
 *   panel names the replay's food, water, power and volume it tints them by.
 * - The grid settings offer only switches that change something.
 *
 * Each width and look saves pictures into test-pictures/viz-living-grid/,
 * which CI uploads: two replay frames two seconds apart, a hidden actor's
 * panel when shown, a panel after its commander changed, the turn banner and
 * the highlight strip, ECOLOGY and the settings.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stored run lives on a local server of its own.');

const SERVER = 'http://127.0.0.1:3466';
const PICTURES = 'test-pictures/viz-living-grid';
const ARIA = 'Aria Chen';
const DIETRICH = 'Dietrich Voss';
const YUKI = 'Yuki Tanaka';

test.use({ baseURL: SERVER, deviceScaleFactor: 2 });

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;
const LOOKS = ['light', 'dark'] as const;

interface SimFrame {
  type: string;
  leader: string;
  data: Record<string, unknown>;
}

interface StoredRun {
  id: string;
  frames: SimFrame[];
  turns: number;
}

/**
 * A stored run's id and the frames its replay route sends. The server stores
 * two: the pair run, and the same colonies with a third commander.
 */
async function storedRun(request: APIRequestContext, commanders = 2): Promise<StoredRun> {
  const res = await request.get(`${SERVER}/sessions`);
  expect(res.ok()).toBe(true);
  const { sessions } = await res.json() as { sessions: Array<{ id: string }> };
  expect(sessions).toHaveLength(2);
  for (const { id } of sessions) {
    const replay = await request.get(`${SERVER}/sessions/${encodeURIComponent(id)}/replay`);
    expect(replay.ok()).toBe(true);
    const frames: SimFrame[] = [];
    for (const chunk of (await replay.text()).split('\n\n')) {
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (event === 'sim' && data) frames.push(JSON.parse(data) as SimFrame);
    }
    if (new Set(frames.map(f => f.leader)).size !== commanders) continue;
    const turns = Math.max(...frames.filter(f => f.type === 'systems_snapshot').map(f => Number(f.data.turn)));
    return { id, frames, turns };
  }
  throw new Error(`The server stores no run with ${commanders} commanders.`);
}

interface TurnFacts {
  /** Deaths the turn's systems_snapshot counts. */
  deaths: number;
  /** The turn_done frame's causes of those deaths, when it names any. */
  causes?: Record<string, number>;
  /** The morale changes of the commander's outcomes this turn, added up. */
  morale: number;
  /** True when the commander made a decision this turn. */
  decided: boolean;
}

function turnFacts(run: StoredRun, leader: string, turn: number): TurnFacts {
  const mine = run.frames.filter(f => f.leader === leader && Number(f.data.turn) === turn);
  const causes = mine.find(f => f.type === 'turn_done')?.data.deathCauses as Record<string, number> | undefined;
  const snapshot = mine.find(f => f.type === 'systems_snapshot');
  const morale = mine
    .filter(f => f.type === 'outcome')
    .reduce((sum, f) => sum + Number((f.data.systemDeltas as Record<string, number> | undefined)?.morale ?? 0), 0);
  return {
    deaths: Number(snapshot?.data.deaths ?? 0),
    causes,
    morale,
    decided: mine.some(f => f.type === 'decision_made' && String(f.data.decision ?? '').length > 0),
  };
}

/** The cause with the most deaths, the first named on a tie. */
function dominantCause(causes: Record<string, number>): string {
  let best = '';
  let most = 0;
  for (const [cause, n] of Object.entries(causes)) {
    if (n > most) { best = cause; most = n; }
  }
  return best;
}

async function useLook(page: Page, look: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((t) => { window.localStorage.setItem('paracosm-theme', t); }, look);
}

const replayUrl = (id: string) => `/sim?replay=${encodeURIComponent(id)}&tab=viz`;
const panel = (page: Page, side: 'a' | 'b') => page.getByTestId(`living-colony-grid-${side}`);
const canvasOf = (page: Page, side: 'a' | 'b') => panel(page, side).locator('canvas');

/** Opens the replay on the Viz tab and waits until both panels show its last turn. */
async function openReplay(page: Page, run: StoredRun): Promise<void> {
  await page.goto(replayUrl(run.id));
  await expect(page.getByRole('img', { name: new RegExp(`^${ARIA} colony, turn ${run.turns}\\.`) })).toBeAttached({ timeout: 30_000 });
}

/**
 * What the Conway layer paints on a panel's canvas, read from its pixels. A
 * Conway tile is a solid square tens of pixels wide in the actor's colour at
 * under 0.65 alpha; nothing else the LIVING mode draws is: glyphs are rings,
 * names are text and their plates are 0.85 alpha. So a tile is found as a
 * 16-pixel block whose pixels are one colour with alpha from 1 to 160.
 */
interface GridRead {
  blocks: number;
  maxAlpha: number;
  signature: string;
}

/** A panel's reads around a change of its commander, kept on the page. */
interface CommanderSwitch {
  /** When the picker's value changed, on the page's clock; 0 until it does. */
  at: number;
  reads: Array<GridRead & { t: number }>;
  done: boolean;
}

type SwitchWindow = { __switch: CommanderSwitch; __readTiles: (canvas: HTMLCanvasElement) => GridRead };

/**
 * Page-side reader; serialised into the page by evaluate and the init script.
 * `minAlpha` and `maxAlpha` bound the alpha a tile pixel may have: 1 to 160
 * on LIVING's clear canvas, higher where ECOLOGY's quadrant tint lies under
 * the tiles.
 */
function readTiles(canvas: HTMLCanvasElement, minAlpha = 1, maxAlpha = 160): GridRead {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return { blocks: 0, maxAlpha: 0, signature: '' };
  const { width, height } = canvas;
  const px = ctx.getImageData(0, 0, width, height).data;
  const B = 16;
  const found: string[] = [];
  let peak = 0;
  for (let y = 0; y + B <= height; y += B) {
    for (let x = 0; x + B <= width; x += B) {
      const i0 = (y * width + x) * 4;
      const a0 = px[i0 + 3];
      if (a0 === 0 || a0 < minAlpha || a0 > maxAlpha) continue;
      let same = true;
      for (let dy = 0; dy < B && same; dy += 5) {
        for (let dx = 0; dx < B; dx += 5) {
          const i = ((y + dy) * width + x + dx) * 4;
          if (px[i] !== px[i0] || px[i + 1] !== px[i0 + 1] || px[i + 2] !== px[i0 + 2] || px[i + 3] !== a0) { same = false; break; }
        }
      }
      if (same) {
        found.push(`${x},${y},${a0}`);
        if (a0 > peak) peak = a0;
      }
    }
  }
  return { blocks: found.length, maxAlpha: peak, signature: found.join(';') };
}

/** Before any page script runs: puts the tile reader on the page as window.__readTiles. */
async function installTileReader(page: Page): Promise<void> {
  await page.addInitScript(`window.__readTiles = ${readTiles.toString()};`);
}

/**
 * Before any page script runs: watches panel A's canvas from the page's start,
 * keeps every read from the first one that holds a Conway tile until two
 * seconds after it, and stops there (or 15 seconds after the canvas first
 * appears with none).
 */
async function recordFirstTiles(page: Page): Promise<void> {
  await installTileReader(page);
  await page.addInitScript(`(() => {
    const out = window.__vizTiles = { reads: [], done: false };
    let began = 0;
    let lastRead = 0;
    const panelCanvas = () => document.querySelector('[data-testid="living-colony-grid-a"] canvas');
    const loop = () => {
      const now = performance.now();
      const first = out.reads[0];
      if (first && now - first.t >= 2000) {
        const canvas = panelCanvas();
        if (canvas) out.reads.push({ ...window.__readTiles(canvas), t: now });
        out.done = true;
        return;
      }
      if (!began && panelCanvas()) began = now;
      if (!first && began && now - began > 15000) { out.done = true; return; }
      if (first || now - lastRead >= 40) {
        lastRead = now;
        const canvas = panelCanvas();
        if (canvas) {
          const read = window.__readTiles(canvas);
          if (first || read.blocks > 0) out.reads.push({ ...read, t: now });
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  })();`);
}

async function readGrid(page: Page, side: 'a' | 'b'): Promise<GridRead> {
  return canvasOf(page, side).evaluate(readTiles);
}

/** The panel's morale tint, as its canvas wrapper's style sets it. */
async function tintOf(page: Page, side: 'a' | 'b'): Promise<string> {
  return panel(page, side).locator('[class*="canvasWrap"]').evaluate(el => (el as HTMLElement).style.getPropertyValue('--tint-color').trim());
}

/** Steps the replay from turn `from` to turn `to` with the Previous and Next keys. */
async function stepTurns(page: Page, from: number, to: number): Promise<void> {
  const key = page.getByRole('button', { name: to < from ? 'Previous turn' : 'Next turn', exact: true });
  for (let t = from; t !== to; t += to < from ? -1 : 1) await key.click();
  await expect(page.getByRole('img', { name: new RegExp(`^${ARIA} colony, turn ${to}\\.`) })).toBeAttached();
}

for (const { width, height } of WIDTHS) {
  for (const look of LOOKS) {
    test(`a replay draws the living grid at ${width} in the ${look} look`, async ({ page, request }) => {
      const run = await storedRun(request);
      await page.setViewportSize({ width, height });
      await useLook(page, look);
      await recordFirstTiles(page);
      await openReplay(page, run);
      await canvasOf(page, 'a').scrollIntoViewIfNeeded();

      // Two frames two seconds apart, as a visitor meets the replay.
      await page.screenshot({ path: `${PICTURES}/replay-${width}-${look}-f1.png` });
      await page.waitForTimeout(2_000);
      await page.screenshot({ path: `${PICTURES}/replay-${width}-${look}-f2.png` });

      // The Conway tiles: present, eased in, and changed two seconds on.
      await page.waitForFunction(() => (window as unknown as { __vizTiles: { done: boolean } }).__vizTiles.done, undefined, { timeout: 20_000 });
      const reads = await page.evaluate(() => (window as unknown as { __vizTiles: { reads: Array<GridRead & { t: number }> } }).__vizTiles.reads);
      expect(reads.length, 'the replay canvas never drew a Conway tile').toBeGreaterThan(1);
      const first = reads[0];
      const later = reads[reads.length - 1];
      expect(later.t - first.t).toBeGreaterThanOrEqual(2_000);
      expect(later.blocks, 'two seconds after the first tiles, the canvas holds tiles').toBeGreaterThan(0);
      expect(later.signature, 'a frame two seconds after the first tiles differs from it').not.toBe(first.signature);
      // No full-strength wash: some frame shows the tiles at under 60% of the
      // strength they settle at before they reach it.
      expect(Math.min(...reads.filter(r => r.blocks > 0).map(r => r.maxAlpha)), 'the tiles ease in').toBeLessThan(later.maxAlpha * 0.6);

      // The morale tint behind the canvas is drawn on the replay.
      const tint = await tintOf(page, 'a');
      expect(tint).not.toBe('');
      expect(tint).not.toBe('transparent');

      // The tiles follow the turn: one turn back, a panel's tiles change.
      const sides: Array<'a' | 'b'> = width >= 768 ? ['a', 'b'] : ['a'];
      const atLast = await Promise.all(sides.map(s => readGrid(page, s)));
      await stepTurns(page, run.turns, run.turns - 1);
      await page.waitForTimeout(600);
      const oneBack = await Promise.all(sides.map(s => readGrid(page, s)));
      expect(oneBack.some(r => r.blocks > 0)).toBe(true);
      expect(oneBack.map(r => r.signature), 'the tiles change with the turn').not.toEqual(atLast.map(r => r.signature));

      // A jump of several turns eases the tiles in again.
      await page.waitForTimeout(3_000);
      // The reads start before the key is pressed and run for two seconds.
      await page.evaluate(() => {
        const w = window as unknown as { __readTiles: (c: HTMLCanvasElement) => GridRead; __jump: { reads: GridRead[]; done: boolean } };
        const canvas = document.querySelector('[data-testid="living-colony-grid-a"] canvas') as HTMLCanvasElement;
        w.__jump = { reads: [], done: false };
        const began = performance.now();
        const loop = () => {
          w.__jump.reads.push(w.__readTiles(canvas));
          if (performance.now() - began >= 2_000) { w.__jump.done = true; return; }
          requestAnimationFrame(loop);
        };
        loop();
      });
      await page.getByRole('slider', { name: 'Scrub timeline' }).press('Home');
      await page.waitForFunction(() => (window as unknown as { __jump: { done: boolean } }).__jump.done);
      const jump = await page.evaluate(() => (window as unknown as { __jump: { reads: GridRead[] } }).__jump.reads);
      await expect(page.getByRole('img', { name: new RegExp(`^${ARIA} colony, turn 1\\.`) })).toBeAttached();
      const settled = jump[jump.length - 1];
      expect(settled.blocks).toBeGreaterThan(0);
      expect(jump.some(r => r.blocks > 0 && r.maxAlpha < settled.maxAlpha * 0.6), 'a jump of several turns eases the tiles in').toBe(true);
    });
  }
}

/**
 * Conway tiles on a panel's canvas outside its top-left corner (the first
 * third of its width by the first two thirds of its height). A colony's
 * tiles spread over the panel; a pattern planted at the canvas origin stays
 * inside that corner.
 */
async function tilesBeyondTopLeft(page: Page, side: 'a' | 'b'): Promise<number> {
  return canvasOf(page, side).evaluate((canvas: HTMLCanvasElement) => {
    const read = (window as unknown as { __readTiles: (c: HTMLCanvasElement) => GridRead }).__readTiles(canvas);
    return read.signature.split(';').filter(Boolean).filter(block => {
      const [x, y] = block.split(',').map(Number);
      return x >= canvas.width / 3 || y >= (canvas.height * 2) / 3;
    }).length;
  });
}

test('in the pair view of a run with three commanders, a panel whose commander changes seeds its tiles from the new colony and eases them in', async ({ page, request }) => {
  const run = await storedRun(request, 3);
  await page.setViewportSize({ width: 1440, height: 900 });
  await useLook(page, 'dark');
  await installTileReader(page);
  await page.goto(replayUrl(run.id));
  // Three actors open on every actor's panel; the pair view gives each of its
  // two panels a commander picker.
  await page.getByRole('tab', { name: 'Focus pair' }).click({ timeout: 30_000 });
  const shows = (name: string) => page.getByRole('img', { name: new RegExp(`^${name} colony, turn ${run.turns}\\.`) });
  await expect(shows(ARIA)).toBeAttached({ timeout: 30_000 });
  await canvasOf(page, 'a').scrollIntoViewIfNeeded();
  await expect.poll(async () => (await readGrid(page, 'a')).blocks, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1_000);

  // Reads the left panel's canvas every frame for two and a half seconds, and marks the
  // moment its commander changes.
  const picker = page.getByRole('combobox', { name: 'Left panel actor' });
  await picker.evaluate((select) => {
    const w = window as unknown as SwitchWindow;
    const out: CommanderSwitch = { at: 0, reads: [], done: false };
    w.__switch = out;
    select.addEventListener('change', () => { out.at = performance.now(); }, { once: true });
    const began = performance.now();
    const loop = () => {
      const now = performance.now();
      const canvas = document.querySelector('[data-testid="living-colony-grid-a"] canvas') as HTMLCanvasElement | null;
      if (canvas) out.reads.push({ ...w.__readTiles(canvas), t: now });
      if (now - began < 2_500) requestAnimationFrame(loop); else out.done = true;
    };
    requestAnimationFrame(loop);
  });
  await page.waitForTimeout(300);
  await picker.selectOption(YUKI);
  await expect(shows(YUKI)).toBeAttached();
  await page.waitForFunction(() => (window as unknown as SwitchWindow).__switch.done, undefined, { timeout: 10_000 });
  const { at, reads } = await page.evaluate(() => (window as unknown as SwitchWindow).__switch);
  await page.screenshot({ path: `${PICTURES}/commander-change-1440-dark.png` });

  expect(at, 'the picker changed the left panel\'s commander').toBeGreaterThan(0);
  const earlier = reads.filter(r => r.t < at);
  const before = earlier[earlier.length - 1];
  expect(before?.blocks ?? 0, 'the left panel drew tiles before its commander changed').toBeGreaterThan(0);
  const after = reads.filter(r => r.t >= at);
  const firstNew = after.find(r => r.blocks > 0 && r.signature !== before!.signature);
  expect(firstNew, 'the left panel drew a new pattern after its commander changed').toBeDefined();
  expect(firstNew!.maxAlpha, 'the new colony\'s tiles ease in rather than appearing at full strength').toBeLessThan(before!.maxAlpha);
  const last = after[after.length - 1];
  expect(last.blocks, 'the new colony\'s tiles are drawn once the ease-in ends').toBeGreaterThan(0);
  expect(last.signature, 'the new colony\'s tiles are not the old colony\'s').not.toBe(before!.signature);
});

for (const look of LOOKS) {
  test(`on a phone, an actor's panel that was hidden draws its tiles when shown, at 390 in the ${look} look`, async ({ page, request }) => {
    const run = await storedRun(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await useLook(page, look);
    await installTileReader(page);
    await openReplay(page, run);
    await canvasOf(page, 'a').scrollIntoViewIfNeeded();
    const actorTab = (name: string) => page.getByRole('tablist', { name: 'Leader panel selector' }).getByRole('tab', { name });
    const shows = (name: string, turn: number) => page.getByRole('img', { name: new RegExp(`^${name} colony, turn ${turn}\\.`) });

    // One turn back with Aria Chen's panel on screen: its tiles spread
    // beyond the top-left corner. Then forward again.
    await stepTurns(page, run.turns, run.turns - 1);
    await page.waitForTimeout(1_000);
    expect(await tilesBeyondTopLeft(page, 'a'), 'the colony draws tiles beyond the top-left corner at this turn').toBeGreaterThan(0);
    await stepTurns(page, run.turns - 1, run.turns);

    // A phone shows one actor at a time. The other actor's panel, hidden
    // while the replay's turns arrived, draws its tiles when first shown.
    // The picture first, so a failing check still leaves it.
    await actorTab(DIETRICH).click();
    await expect(shows(DIETRICH, run.turns)).toBeVisible();
    await page.waitForTimeout(1_000);
    await canvasOf(page, 'b').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${PICTURES}/second-actor-390-${look}.png` });
    expect(await tilesBeyondTopLeft(page, 'b'), 'the second actor\'s panel draws its tiles when first shown').toBeGreaterThan(0);

    // The turn changes while Aria Chen's panel is hidden.
    await page.getByRole('button', { name: 'Previous turn', exact: true }).click();
    await expect(shows(DIETRICH, run.turns - 1)).toBeVisible();

    // Shown again, it draws that turn's tiles.
    await actorTab(ARIA).click();
    await expect(shows(ARIA, run.turns - 1)).toBeVisible();
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: `${PICTURES}/shown-again-390-${look}.png` });
    expect(await tilesBeyondTopLeft(page, 'a'), 'a panel hidden while the turn changed draws its Conway tiles when shown again').toBeGreaterThan(0);
  });
}

for (const look of LOOKS) {
  test(`the turn banner says what each commander chose, the deaths and a morale crack, in the ${look} look`, async ({ page, request }) => {
    const run = await storedRun(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await useLook(page, look);
    await openReplay(page, run);
    const banner = page.getByRole('status', { name: 'Current turn narrative' });
    const line = (label: 'A' | 'B', name: string) => banner.locator('div').filter({ hasText: new RegExp(`^${label}: ${name}`) });

    // The stored run holds the inputs this test reads: a turn after the
    // first where Aria Chen's colony loses people to a named cause, and a
    // turn whose outcomes cost her colony 0.08 of morale or more.
    const lossTurn = Array.from({ length: run.turns }, (_, i) => i + 1).find(t => t > 1 && turnFacts(run, ARIA, t).causes);
    const crackTurn = Array.from({ length: run.turns }, (_, i) => i + 1).find(t => turnFacts(run, ARIA, t).morale <= -0.08);
    expect(lossTurn, 'the stored run has a turn with deaths and their causes').toBeDefined();
    expect(crackTurn, 'the stored run has a turn whose outcomes crack morale').toBeDefined();
    // And a turn whose deaths have more than one cause, where the line gives
    // the total and the largest cause's own count.
    const severalCausesTurn = Array.from({ length: run.turns }, (_, i) => i + 1)
      .find(t => [ARIA, DIETRICH].some(name => Object.keys(turnFacts(run, name, t).causes ?? {}).length > 1));
    expect(severalCausesTurn, 'the stored run has a turn whose deaths have more than one cause').toBeDefined();

    // Pictures of those turns first, so a failing check still leaves them.
    let at = run.turns;
    for (const turn of [...new Set([crackTurn!, lossTurn!])].sort((x, y) => x - y)) {
      await stepTurns(page, at, turn);
      at = turn;
      await page.screenshot({ path: `${PICTURES}/banner-turn-${turn}-1440-${look}.png` });
    }

    await stepTurns(page, at, 1);
    for (let turn = 1; turn <= run.turns; turn++) {
      if (turn > 1) await stepTurns(page, turn - 1, turn);
      for (const [label, name] of [['A', ARIA], ['B', DIETRICH]] as const) {
        const facts = turnFacts(run, name, turn);
        const text = (await line(label, name).first().textContent()) ?? '';
        if (facts.decided) expect(text, `T${turn} ${name}`).not.toContain('held position');
        if (facts.causes) {
          // Every death under one cause reads "N lost to <cause>"; several
          // causes read the total, then the largest cause's own count.
          const counts = Object.values(facts.causes);
          const lost = counts.reduce((s, n) => s + n, 0);
          const most = Math.max(...counts);
          const cause = dominantCause(facts.causes);
          expect(text, `T${turn} ${name}`).toContain(most === lost ? `${lost} lost to ${cause}` : `${lost} lost, ${most} to ${cause}`);
        } else if (facts.deaths > 0) {
          expect(text, `T${turn} ${name}`).toContain(`${facts.deaths} lost`);
        } else {
          expect(text, `T${turn} ${name}`).not.toContain(' lost');
        }
        if (facts.morale <= -0.08) expect(text, `T${turn} ${name}`).toContain('morale cracked');
        else if (facts.morale >= 0.08) expect(text, `T${turn} ${name}`).toContain('morale steadied');
        else expect(text, `T${turn} ${name}`).not.toContain('morale');
      }
    }
  });
}

for (const look of LOOKS) {
  test(`the highlight strip names each side's losses that turn, in the ${look} look`, async ({ page, request }) => {
    const run = await storedRun(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await useLook(page, look);
    await openReplay(page, run);
    const strip = page.locator('div[role="status"][data-turn]');

    // A turn where one side's deaths fall from the turn before while the
    // two sides' changes differ: the turn a running-total reading of the
    // per-turn counts turns negative.
    const deathsOf = (name: string, turn: number) => turnFacts(run, name, turn).deaths;
    const fallTurn = Array.from({ length: run.turns }, (_, i) => i + 1).find(t => {
      if (t < 2) return false;
      const changeA = deathsOf(ARIA, t) - deathsOf(ARIA, t - 1);
      const changeB = deathsOf(DIETRICH, t) - deathsOf(DIETRICH, t - 1);
      return changeA !== changeB && Math.min(changeA, changeB) < 0;
    });
    expect(fallTurn, 'the stored run has a turn whose deaths fall on one side').toBeDefined();

    const count = (n: number) => (n === 0 ? 'none' : `${n} ${n === 1 ? 'colonist' : 'colonists'}`);
    // A picture of that turn first, so a failing check still leaves it.
    await stepTurns(page, run.turns, fallTurn!);
    await page.screenshot({ path: `${PICTURES}/strip-turn-${fallTurn}-1440-${look}.png` });

    await stepTurns(page, fallTurn!, 1);
    for (let turn = 1; turn <= run.turns; turn++) {
      if (turn > 1) await stepTurns(page, turn - 1, turn);
      const text = (await strip.textContent()) ?? '';
      expect(text, `T${turn}`).not.toMatch(/-\d/);
      const a = deathsOf(ARIA, turn);
      const b = deathsOf(DIETRICH, turn);
      if (a !== b) {
        const [heavy, light] = a > b ? [[ARIA, a], [DIETRICH, b]] as const : [[DIETRICH, b], [ARIA, a]] as const;
        expect(text, `T${turn}`).toContain(`${heavy[0]} lost ${count(heavy[1])}; ${light[0]} lost ${count(light[1])}.`);
      }
    }
  });
}

for (const look of LOOKS) {
  test(`ECOLOGY on a replay draws the living grid and names the replay's food, water, power and volume, in the ${look} look`, async ({ page, request }) => {
    const run = await storedRun(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await useLook(page, look);
    await installTileReader(page);
    await openReplay(page, run);
    await page.getByRole('tablist', { name: 'Grid viz mode' }).getByRole('tab', { name: /ECOLOGY/ }).click();
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: `${PICTURES}/ecology-1440-${look}.png` });

    // The four readings the replay's last turn carries for Aria Chen.
    const metrics = run.frames.find(f => f.leader === ARIA && f.type === 'turn_done' && Number(f.data.turn) === run.turns)?.data.metrics as Record<string, number>;
    for (const key of ['foodMonthsReserve', 'waterLitersPerDay', 'powerKw', 'pressurizedVolumeM3']) expect(typeof metrics[key], key).toBe('number');

    // The panel names the readings its quadrants are tinted by.
    const name = (await canvasOf(page, 'a').getAttribute('aria-label')) ?? '';
    expect(name).toContain(`food reserve ${metrics.foodMonthsReserve.toFixed(1)} months`);
    expect(name).toContain(`water ${Math.round(metrics.waterLitersPerDay)} litres a day`);
    expect(name).toContain(`power ${Math.round(metrics.powerKw)} kW`);
    expect(name).toContain(`pressurized volume ${Math.round(metrics.pressurizedVolumeM3)} cubic metres`);

    // Not an empty panel: the Conway tiles draw under the quadrants. The
    // quadrant tint alone stays under alpha 60 and the HUD's plates over 200.
    const tiles = await canvasOf(page, 'a').evaluate((canvas: HTMLCanvasElement) =>
      (window as unknown as { __readTiles: (c: HTMLCanvasElement, min: number, max: number) => GridRead }).__readTiles(canvas, 60, 200));
    expect(tiles.blocks, 'ECOLOGY draws the living grid on a replay').toBeGreaterThan(0);
  });
}

/** A fingerprint of a canvas's pixels. */
async function canvasPrint(page: Page, side: 'a' | 'b'): Promise<number> {
  return canvasOf(page, side).evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let h = 2166136261;
    for (let i = 0; i < px.length; i += 7) h = Math.imul(h ^ px[i], 16777619);
    return h >>> 0;
  });
}

for (const look of LOOKS) {
  test(`the grid settings offer only switches that change something, in the ${look} look`, async ({ page, request }) => {
    const run = await storedRun(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await useLook(page, look);
    await openReplay(page, run);
    await page.getByRole('button', { name: 'Show advanced tools (palette, stats, export, settings)' }).click();
    await page.getByRole('button', { name: 'Open grid settings' }).click();
    const drawer = page.getByRole('dialog', { name: 'Grid viz settings' });
    await expect(drawer).toBeVisible();
    await page.screenshot({ path: `${PICTURES}/settings-1440-${look}.png` });

    // Animation speed, Dept rings, Family lines, Star dust bg and Ghost
    // trail drew layers that no longer exist; the switches left are read.
    await expect(drawer.locator('[class*="rowLabel"]')).toHaveText(['Dept labels', 'Crosshair', 'Alert toasts', 'Sound cues']);

    // Dept labels changes the canvas.
    await page.waitForTimeout(3_000);
    const before = await canvasPrint(page, 'a');
    await drawer.getByText('Dept labels', { exact: true }).locator('..').getByRole('button', { name: 'on', exact: true }).click();
    await page.waitForTimeout(400);
    expect(await canvasPrint(page, 'a')).not.toBe(before);
  });
}
