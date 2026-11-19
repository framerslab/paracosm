/**
 * Forged tools on the dashboard, on runs of 2, 24 and 300 actors.
 *
 * The page talks to the real server over HTTP. The pair run is stored on
 * tests-e2e/support/shared-run-server.ts and the runs of 24 and 300 actors,
 * written from a seed, on tests-e2e/support/cohort-run-server.ts; each plays
 * through the server's own replay route at /sim?replay=<id>.
 *
 * - What a visitor compares today stays: the Viz tab draws every actor's
 *   living grid at each size.
 * - The forge view's tokens: the quiet tone, the edge tone, the problem
 *   colour and the three text sizes hold their values in both looks, and
 *   --rust keeps its own.
 * - Feature 1 on the run's record: a forge card's INSPECT key opens the
 *   tool's trace, a dialog with the tool's outcome in one sentence over its
 *   line of five stations. Each test walks a phone and a desktop in both
 *   looks and is named for the step of the feature it proves.
 * - The stations on the run's record: each station opens what the run
 *   recorded in place (Request the actor's line, what the tool does and its
 *   fields; Judge the confidence; Added each history row), the station that
 *   decided the outcome open first; Code and Tests have nothing to open;
 *   Open all opens every station with evidence; the stations a visitor
 *   opened open on the run's next tool too.
 * - Record and the attempts on the run's record: Record, one key at the
 *   line's foot, opens the actor's frames that name the tool with Copy
 *   record, Download JSON and Show in Event Log, which opens the Event Log
 *   on this actor's tool by its whole name; a tool forged more than once
 *   opens at its latest attempt, with keys to its other attempts and a row
 *   for each where it leaves the line.
 * - A link to one tool: Copy link to this tool copies a replay link that
 *   names the tool by its number and its open stations; the link opens that
 *   tool once the replay has played in, and a link to a tool the run lacks
 *   opens the run with no dialog and leaves the address clean.
 * - The forged toolbox on the run's record: one row for each actor's tool,
 *   with its outcome, its line in small under the five station names, what
 *   it does and who made it; a count line that counts forges, a filter that
 *   counts rows, Find a tool, and Export JSON for the rows shown. A row
 *   opens its tool's trace over the toolbox, and Reports shows the same
 *   rows in its page.
 *
 * Each picture is saved into test-pictures/forged-tool-view/, which CI uploads.
 */
import { readFileSync } from 'node:fs';
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  COHORT_SERVER, LOOKS, PAIR_SERVER, PICTURES, RUNS, SWEEP_WIDTHS, WIDTHS,
  pairSessionId, replayUrl, sessionIdByName, useLook, type Look,
} from '../support/forge-view-pages.js';
import { DOZENS, MAXIMUM, REPORT_ONLY_PAIR, generateCohortRun } from '../support/forge-fixtures.js';
import { pairRunFrames } from '../support/pair-run.js';
import { framesToSimEvents } from '../support/run-frames.js';
import { buildToolRegistry } from '../../src/dashboard/src/hooks/toolRegistry.helpers.js';
import { computeGameState } from '../../src/dashboard/src/hooks/useGameState.js';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stored runs live on local servers of their own.');

test.use({ deviceScaleFactor: 2 });

const LANDING = 'mars_landing_site_score';
/** The last tool of the pair run's stream: it is on the page once the replay has played in. */
const LAST_TOOL = 'rover_route_planner';

/** One column of the Viz tab's cohort view: an actor's living grid under its name. */
const cohortGrids = (page: Page) => page.getByLabel(/^Living swarm grid for actor \d+: /);

/** What the pair run's record says of its first tool. */
const LANDING_TEXT = 'Scores a landing site on radiation and subsurface ice.';
/** Dietrich Voss's tool that did not pass, and the reason its forge recorded. */
const RADIATION = 'radiation_dose_budget';
const RADIATION_REASON = 'The output did not match the declared output schema: "budget_msv" is required.';
/** Dietrich Voss's tool that did not pass with no reason on the record. */
const MORALE = 'crew_morale_index';
/** The name both actors of the pair run forged. */
const HABITAT = 'habitat_pressure_check';
/** Dietrich Voss's passed tool that declares no fields and was used again in turn 2. */
const OXYGEN = 'oxygen_reserve_days';
/** Aria Chen's passed tool that nothing used after its forge. */
const GREENHOUSE = 'greenhouse_yield_forecast';
/** Aria Chen's tool forged twice: its turn 1 forge did not pass and its turn 2 forge passed. */
const RATION = 'water_ration_index';
/** Dietrich Voss's first tool: the Event Log on Aria Chen's first tool shows none of its rows. */
const WATER = 'perchlorate_water_response_score';
/** Where the trace keeps the stations a visitor opened, on this device, for each run. */
const OPEN_STATIONS_KEY = 'paracosm:forgeOpenStations';

/** The forge's five stations, in the order a forge passes them. */
const STATIONS = ['request', 'code', 'tests', 'judge', 'added'] as const;

type Size = { width: number; height: number };

/** Every size and look a test walks: a phone and a desktop, light and dark. */
const WALKS: Array<{ size: Size; look: Look }> = WIDTHS.flatMap(size => LOOKS.map(look => ({ size, look })));

/** A forge card's INSPECT key, in the whole page or in one actor's column. */
const inspectKey = (scope: Page | Locator, tool: string): Locator =>
  scope.locator(`button[aria-label="Inspect forged tool ${tool}"]`);

/** Presses a forge card's INSPECT key. The key sits in the card's fold, which opens on its summary row. */
async function pressInspect(inspect: Locator): Promise<void> {
  await expect(inspect).toBeAttached();
  const summary = inspect.locator('..').locator('summary').first();
  await summary.scrollIntoViewIfNeeded();
  if (!(await inspect.isVisible())) await summary.click();
  await inspect.click();
}

/** Waits until the page shows the look it was opened in. */
const lookShown = (page: Page, look: Look) =>
  page.waitForFunction((l) => document.documentElement.classList.contains('light') === (l === 'light'), look);

/** Opens the pair run's replay on the Sim tab at one size in one look, played in to its last tool. */
async function openPairSim(page: Page, request: APIRequestContext, size: Size, look: Look): Promise<void> {
  await page.setViewportSize(size);
  await useLook(page, look);
  await page.goto(replayUrl(PAIR_SERVER, await pairSessionId(request), 'sim'));
  await lookShown(page, look);
  await expect(page.getByText(LAST_TOOL).first()).toBeAttached();
}

/** A tool's trace: a dialog named for the tool and its number in the run's list. */
const traceOf = (page: Page, tool: string, n: number | RegExp = /\d+/): Locator =>
  page.getByRole('dialog', {
    name: typeof n === 'number' ? `${tool}, forged tool ${n}` : new RegExp(`^${tool}, forged tool ${n.source}$`),
  });

/** A token's colour as the page resolves it in the look it shows. */
const resolved = (page: Page, token: string): Promise<string> => page.evaluate((v) => {
  const probe = document.createElement('span');
  probe.style.color = `var(${v})`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, token);

/** Saves a picture of the window, with a dialog's opening motion finished. */
const picture = (page: Page, name: string) =>
  page.screenshot({ path: `${PICTURES}/${name}.png`, animations: 'disabled' });

const colourOf = (part: Locator): Promise<string> => part.evaluate(el => getComputedStyle(el).color);
const groundOf = (part: Locator): Promise<string> => part.evaluate(el => getComputedStyle(el).backgroundColor);

/** The filled cell of a reached station: it is drawn in the line's colour. */
const reachedCell = (trace: Locator, station: string): Locator =>
  trace.locator(`[data-station="${station}"] [data-cell="reached"]`);

/** A station of the trace: its list item, holding its key and its one line or its evidence. */
const stationOf = (trace: Locator, station: string): Locator => trace.locator(`[data-station="${station}"]`);
/** A station's own key, the button that opens and closes its evidence. */
const stationKey = (trace: Locator, station: string): Locator => trace.locator(`[data-station="${station}"] > button`);

/** Opens a station of the trace unless it opened with the trace. */
async function openStation(trace: Locator, station: string): Promise<Locator> {
  const key = stationKey(trace, station);
  // A station with evidence says whether it is open; one with nothing to open says neither.
  await expect(key, `${station} has evidence to open`).toHaveAttribute('aria-expanded', /^(true|false)$/);
  if ((await key.getAttribute('aria-expanded')) === 'false') await key.click();
  await expect(key).toHaveAttribute('aria-expanded', 'true');
  return stationOf(trace, station);
}

/** Each station's key reads open or closed: true, false, or no state for a station with nothing to open. */
async function expectOpen(trace: Locator, open: Record<string, boolean | 'inactive'>): Promise<void> {
  for (const [station, state] of Object.entries(open)) {
    const key = stationKey(trace, station);
    if (state === 'inactive') {
      await expect(key, `${station} has nothing to open`).toHaveAttribute('aria-disabled', 'true');
      await expect(key, `${station} has nothing to open`).not.toHaveAttribute('aria-expanded');
    } else {
      await expect(key, `${station} is ${state ? 'open' : 'closed'}`).toHaveAttribute('aria-expanded', String(state));
    }
  }
}

/** Forgets the stations kept on this device, so a trace opens on its deciding station alone. */
const forgetOpenStations = (page: Page) => page.evaluate((k) => window.localStorage.removeItem(k), OPEN_STATIONS_KEY);

/** Closes the open trace by its Close key. */
async function closeTrace(trace: Locator): Promise<void> {
  await trace.getByRole('button', { name: 'Close the trace' }).click();
  await expect(trace).toBeHidden();
}

test.describe('what a visitor compares today stays', () => {
  test('the 24-actor run sets every actor\'s living grid side by side on the Viz tab', async ({ page, request }) => {
    const id = await sessionIdByName(request, COHORT_SERVER, RUNS.dozens);
    await page.goto(replayUrl(COHORT_SERVER, id, 'viz'));
    await expect(cohortGrids(page)).toHaveCount(24);
    // The first actor's grid is drawn and in view: its population at a turn, not a grid still waiting.
    const first = page.getByLabel('Living swarm grid for actor 1: Aria Chen');
    await expect(first).toBeInViewport();
    await expect(first.getByRole('img', { name: /^Aria Chen \S+, turn \d+\. 12 alive/ })).toBeVisible();
  });

  test('the 300-actor run lists all 300 actors\' grids on the Viz tab', async ({ page, request }) => {
    test.setTimeout(180_000);
    const id = await sessionIdByName(request, COHORT_SERVER, RUNS.maximum);
    await page.goto(replayUrl(COHORT_SERVER, id, 'viz'));
    // The page is busy while a run of this size plays in, so each check waits longer.
    await expect(cohortGrids(page)).toHaveCount(300, { timeout: 120_000 });
    const first = page.getByLabel('Living swarm grid for actor 1: Aria Chen');
    await expect(first).toBeInViewport({ timeout: 60_000 });
    await expect(first.getByRole('img', { name: /^Aria Chen \S+, turn \d+\. 6 alive/ })).toBeVisible({ timeout: 60_000 });
  });

  test('the pair run shows both actors\' grids on the Viz tab', async ({ page, request }) => {
    const id = await pairSessionId(request);
    await page.goto(replayUrl(PAIR_SERVER, id, 'viz'));
    // A pair's two grids are regions named for their leaders, each a canvas that says what it draws.
    await expect(page.getByRole('region', { name: /^(Aria Chen|Dietrich Voss) \S+ viz$/ })).toHaveCount(2);
    for (const leader of ['Aria Chen', 'Dietrich Voss']) {
      const grid = page.getByRole('region', { name: new RegExp(`^${leader} \\S+ viz$`) });
      await expect(grid).toBeInViewport();
      await expect(grid.getByRole('img', { name: new RegExp(`^${leader} \\S+, turn \\d+\\. 30 alive`) })).toBeVisible();
    }
  });
});

test.describe('the forge view\'s tokens', () => {
  test('the six forge tokens hold their values in both looks, and --rust keeps its own', async ({ page }) => {
    const expected = {
      dark: { quiet: 'rgb(216, 204, 176)', edge: 'rgb(168, 152, 120)', problem: 'rgb(242, 148, 106)', rust: 'rgb(224, 101, 48)' },
      light: { quiet: 'rgb(74, 62, 44)', edge: 'rgb(106, 92, 68)', problem: 'rgb(142, 44, 12)', rust: 'rgb(142, 44, 12)' },
    };
    for (const look of LOOKS) {
      await useLook(page, look);
      await page.goto(`${PAIR_SERVER}/sim`);
      // The page puts the light look's class on its root once it has read the stored look.
      await page.waitForFunction((l) => document.documentElement.classList.contains('light') === (l === 'light'), look);
      // Each colour is read through a probe element, so the assertion is on the resolved colour.
      const got = await page.evaluate(() => {
        const host = document.querySelector('.light') ?? document.body;
        const probe = document.createElement('span');
        host.append(probe);
        const read = (v: string) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
        const sizes = ['--forge-text-meta', '--forge-text-body', '--forge-text-title']
          .map((k) => getComputedStyle(host).getPropertyValue(k).trim());
        const colours = { quiet: read('--forge-quiet'), edge: read('--forge-edge'), problem: read('--problem'), rust: read('--rust') };
        probe.remove();
        return { ...colours, sizes };
      });
      expect(got, `the ${look} look`).toEqual({ ...expected[look], sizes: ['15px', '18px', '22px'] });
    }
  });
});

test.describe('feature 1 on the run\'s record', () => {
  test('f1 q4: a passed tool and a tool that did not pass, on the run\'s record', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);

        // A tool the record marks approved: five filled stations, each closed to its one line.
        await pressInspect(inspectKey(page, LANDING));
        const passed = traceOf(page, LANDING, 1);
        await expect(passed.getByText('Passed. The judge approved it.', { exact: true })).toBeVisible();
        for (const id of STATIONS) await expect(passed.locator(`[data-station="${id}"]`)).toHaveAttribute('data-state', 'reached');
        await expect(passed.locator('[data-station="request"]')).toContainText(LANDING_TEXT);
        await expect(passed.locator('[data-station="code"]')).toContainText('The code was not recorded for this run.');
        await expect(passed.locator('[data-station="tests"]')).toContainText('The tests were not recorded for this run.');
        // Judge, the station that decided a passed tool, opens with the trace: the confidence shows open or closed.
        await expect(passed.locator('[data-station="judge"]')).toContainText('0.98 out of 1');
        await expect(passed.locator('[data-station="added"]')).toContainText('Used 1 time');
        await expect(passed.getByText('Written by an AI model during this paracosm run', { exact: true })).toBeVisible();
        await expect(passed.getByText('The reason the run recorded')).toHaveCount(0);
        await picture(page, `${size.width}-${look}-f1-passed`);
        await passed.getByRole('button', { name: 'Close the trace' }).click();
        await expect(passed).toBeHidden();

        // A tool the record does not mark approved: the record does not say where its forge stopped.
        await pressInspect(inspectKey(page, RADIATION));
        const failed = traceOf(page, RADIATION);
        await expect(failed.getByText('Did not pass. The run\'s record does not say where the forge stopped.', { exact: true })).toBeVisible();
        await expect(failed.locator('[data-station="request"]')).toHaveAttribute('data-state', 'reached');
        for (const id of ['code', 'tests', 'judge']) {
          const station = failed.locator(`[data-station="${id}"]`);
          await expect(station).toHaveAttribute('data-state', 'unknown');
          await expect(station).toContainText('Unknown');
        }
        const added = failed.locator('[data-station="added"]');
        await expect(added).toHaveAttribute('data-state', 'notReached');
        await expect(added).toContainText('Not reached');
        await expect(failed.getByText('The reason the run recorded', { exact: true })).toBeVisible();
        await expect(failed.getByText(RADIATION_REASON, { exact: true })).toBeVisible();
        await expect(failed.getByText('The run\'s record keeps at most 240 characters of this reason.', { exact: true })).toBeVisible();
        await expect(failed.getByText('Written by an AI model during this paracosm run', { exact: true })).toBeVisible();
        await picture(page, `${size.width}-${look}-f1-did-not-pass`);
        await failed.getByRole('button', { name: 'Close the trace' }).click();
        await expect(failed).toBeHidden();

        // A tool that did not pass and whose forge recorded no reason.
        await pressInspect(inspectKey(page, MORALE));
        const unexplained = traceOf(page, MORALE);
        await expect(unexplained.getByText('Did not pass. The run\'s record does not say where the forge stopped.', { exact: true })).toBeVisible();
        await expect(unexplained.getByText('The reason the run recorded', { exact: true })).toBeVisible();
        await expect(unexplained.getByText('The record gave no reason.', { exact: true })).toBeVisible();
        await expect(unexplained.getByText('The run\'s record keeps at most 240 characters of this reason.')).toHaveCount(0);
        await picture(page, `${size.width}-${look}-f1-no-reason`);
      });
    }
  });

  test('f1 q7: Escape, and Back on a phone, close the trace and return focus to the key that opened it', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const inspect = inspectKey(page, LANDING);
        const trace = traceOf(page, LANDING, 1);

        await pressInspect(inspect);
        await expect(trace).toBeVisible();
        // The trace opens with focus on its heading, the tool's name.
        await expect(trace.getByRole('heading', { level: 2, name: LANDING })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(trace).toBeHidden();
        await expect(inspect).toBeFocused();

        // Back, as a phone's Back key sends it: the trace closes and the run stays on the page.
        const address = page.url();
        await pressInspect(inspect);
        await expect(trace).toBeVisible();
        await page.evaluate(() => window.history.back());
        await expect(trace).toBeHidden();
        await expect(inspect).toBeFocused();
        expect(page.url()).toBe(address);
        await expect(inspect).toBeVisible();

        // Close does the same.
        await pressInspect(inspect);
        await trace.getByRole('button', { name: 'Close the trace' }).click();
        await expect(trace).toBeHidden();
        await expect(inspect).toBeFocused();
      });
    }
  });

  test('f1 q8: focus stays inside the open trace and no focused key sits under its header', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        await expect(trace).toBeVisible();

        const focused = new Set<string>();
        for (let press = 1; press <= 30; press++) {
          await page.keyboard.press('Tab');
          const at = await trace.evaluate((dialog) => {
            const el = document.activeElement;
            const header = dialog.querySelector('[data-forge-header]');
            if (!el || !header) return null;
            return {
              name: el.getAttribute('aria-label') ?? el.textContent ?? '',
              inside: dialog.contains(el),
              inHeader: header.contains(el),
              top: el.getBoundingClientRect().top,
              headerBottom: header.getBoundingClientRect().bottom,
            };
          });
          expect(at, `Tab ${press}: the trace has a header row and a focused element`).not.toBeNull();
          expect(at!.inside, `Tab ${press}: "${at!.name}" is inside the trace`).toBe(true);
          if (!at!.inHeader) {
            expect(at!.top, `Tab ${press}: "${at!.name}" is clear of the header row`).toBeGreaterThanOrEqual(at!.headerBottom - 0.5);
          }
          focused.add(at!.name);
        }
        // Tab reaches the header row's keys and comes round to them again.
        expect([...focused]).toContain('Close the trace');
        expect([...focused].some(name => /^Switch to (light|dark) mode$/.test(name))).toBe(true);
      });
    }
  });

  test('f1 q17: the header row is one row at 320, 360, 390, 430, 480 and 768', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const look of LOOKS) {
      // The trace opens on a phone, then the window takes each width with it open.
      await openPairSim(page, request, WIDTHS[0], look);
      await pressInspect(inspectKey(page, LANDING));
      const trace = traceOf(page, LANDING, 1);
      await expect(trace).toBeVisible();

      for (const width of SWEEP_WIDTHS) {
        await test.step(`${width} in the ${look} look`, async () => {
          await page.setViewportSize({ width, height: 844 });
          await expect(trace.getByRole('button', { name: 'Close the trace' })).toBeVisible();
          const row = await trace.evaluate((dialog) => {
            const header = dialog.querySelector('[data-forge-header]');
            if (!header) return null;
            const box = (el: Element) => {
              const r = el.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
            };
            const shown = (el: Element) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
            return {
              window: window.innerWidth,
              sheet: box(dialog),
              // The sheet's own widest content against the room it has.
              sheetScroll: dialog.scrollWidth - dialog.clientWidth,
              headerScroll: header.scrollWidth - header.clientWidth,
              keys: Array.from(header.querySelectorAll('button')).filter(shown).map(key => ({
                name: key.getAttribute('aria-label') ?? '', rowTop: (key as HTMLElement).offsetTop, ...box(key),
              })),
              parts: Array.from(header.children).filter(shown).map(box),
            };
          });
          expect(row, 'the trace has a header row').not.toBeNull();
          const { keys, parts, sheet } = row!;
          // Close and the look key, each on the row.
          expect(keys.map(key => key.name)).toEqual(expect.arrayContaining(['Close the trace', expect.stringMatching(/^Switch to (light|dark) mode$/)]));
          expect(new Set(keys.map(key => key.rowTop)).size, 'every key of the header row shares one top').toBe(1);
          // One row: every part of the header stands beside the others, none under another.
          const lowestTop = Math.max(...parts.map(part => part.top));
          const highestBottom = Math.min(...parts.map(part => part.bottom));
          expect(lowestTop, 'no part of the header row sits under another').toBeLessThan(highestBottom);
          // No sideways scroll: the sheet is inside the window, and nothing in it is wider than it.
          expect(sheet.left).toBeGreaterThanOrEqual(-0.5);
          expect(sheet.right).toBeLessThanOrEqual(row!.window + 0.5);
          expect(row!.sheetScroll, 'the sheet does not scroll sideways').toBeLessThanOrEqual(0);
          expect(row!.headerScroll, 'the header row does not scroll sideways').toBeLessThanOrEqual(0);
          for (const key of keys) {
            expect(key.left, `"${key.name}" is inside the sheet`).toBeGreaterThanOrEqual(sheet.left - 0.5);
            expect(key.right, `"${key.name}" is inside the sheet`).toBeLessThanOrEqual(sheet.right + 0.5);
          }
          if (width === 320) await picture(page, `320-${look}-f1-header-row`);
        });
      }
    }
  });

  test('f1 q18: the look key flips the page and the trace together and keeps focus', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} from the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        await expect(trace).toBeVisible();

        const other: Look = look === 'light' ? 'dark' : 'light';
        const key = trace.getByRole('button', { name: `Switch to ${other} mode` });
        // The key is a sun in the dark look and a moon in the light look.
        await expect(key).toHaveText(look === 'dark' ? '☀' : '☽');
        await key.click();
        await lookShown(page, other);
        // The trace takes the other look's ground with the page, and stays open.
        await expect(trace).toBeVisible();
        expect(await groundOf(trace)).toBe(await resolved(page, '--bg-card'));
        expect(await groundOf(trace)).toBe(other === 'light' ? 'rgb(248, 240, 224)' : 'rgb(28, 25, 21)');
        // Focus stays on the key, which now names the way back.
        const back = trace.getByRole('button', { name: `Switch to ${look} mode` });
        await expect(back).toBeFocused();
        await expect(back).toHaveText(other === 'dark' ? '☀' : '☽');
        await picture(page, `${size.width}-${other}-f1-look-switched`);
      });
    }
  });

  test('f1 q26: A1\'s tool draws its line amber and A2\'s teal, each tile reads its label', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const ink = await resolved(page, '--text-1');
        const tools = [
          { tool: LANDING, label: 'A1', token: '--vis' },
          { tool: RADIATION, label: 'A2', token: '--eng' },
        ];
        for (const { tool, label, token } of tools) {
          await pressInspect(inspectKey(page, tool));
          const trace = traceOf(page, tool);
          await expect(trace).toBeVisible();
          // The line and its reached cell take the actor's run colour.
          expect(await groundOf(reachedCell(trace, 'request')), `${label}'s line`).toBe(await resolved(page, token));
          // The header row's tile names the actor by its slot label.
          await expect(trace.locator('[data-forge-header] [data-actor-tile]')).toHaveText(label);
          // Every station name is in the ink.
          for (const name of ['Request', 'Code', 'Tests', 'Judge', 'Added']) {
            const word = trace.locator(`[data-station="${name.toLowerCase()}"] button`).getByText(name, { exact: true });
            expect(await colourOf(word), `${label}: ${name}`).toBe(ink);
          }
          await picture(page, `${size.width}-${look}-f1-line-${label.toLowerCase()}`);
          await trace.getByRole('button', { name: 'Close the trace' }).click();
          await expect(trace).toBeHidden();
        }
      });
    }
  });

  test('f1 q28: the outcome is one sentence in the ink with one glyph', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const ink = await resolved(page, '--text-1');
        const tools = [
          { tool: LANDING, sentence: 'Passed. The judge approved it.', glyph: 'passed' },
          { tool: RADIATION, sentence: 'Did not pass. The run\'s record does not say where the forge stopped.', glyph: 'didNotPass' },
        ];
        for (const { tool, sentence, glyph } of tools) {
          await pressInspect(inspectKey(page, tool));
          const trace = traceOf(page, tool);
          await expect(trace).toBeVisible();
          // One element holds the outcome: its sentence, in the ink, with its one glyph.
          const outcome = trace.locator('[data-forge-outcome]');
          await expect(outcome).toHaveCount(1);
          await expect(outcome).toHaveText(sentence);
          expect(await colourOf(outcome.getByText(sentence, { exact: true }))).toBe(ink);
          await expect(outcome.locator('svg[data-glyph]')).toHaveCount(1);
          await expect(outcome.locator('svg[data-glyph]')).toHaveAttribute('data-glyph', glyph);
          // The outcome is said once: no banner, bar or second mark repeats it above the line.
          await expect(trace.getByText(sentence, { exact: true })).toHaveCount(1);
          await expect(trace.locator('[data-forge-head] svg[data-glyph]')).toHaveCount(1);
          // The look key is a sun or a moon.
          await expect(trace.getByRole('button', { name: /^Switch to (light|dark) mode$/ })).toHaveText(look === 'dark' ? '☀' : '☽');
          await trace.getByRole('button', { name: 'Close the trace' }).click();
          await expect(trace).toBeHidden();
        }
      });
    }
  });

  test('f1 q29: a tool of the 24-actor run\'s A3 draws its line in the quiet tone and A3\'s band in its run colour', async ({ page, request }) => {
    test.setTimeout(240_000);
    const id = await sessionIdByName(request, COHORT_SERVER, RUNS.dozens);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await page.setViewportSize(size);
        await useLook(page, look);
        await page.goto(replayUrl(COHORT_SERVER, id, 'sim'));
        await lookShown(page, look);
        // The first forge card of A3's column, once the run's last actor has played in.
        await expect(page.locator('[aria-label^="Events for actor 24 on turn "] button[aria-label^="Inspect forged tool "]').first())
          .toBeAttached({ timeout: 60_000 });
        const inspect = page.locator('[aria-label^="Events for actor 3 on turn "] button[aria-label^="Inspect forged tool "]').first();
        const tool = ((await inspect.getAttribute('aria-label')) ?? '').replace('Inspect forged tool ', '');
        expect(tool).not.toBe('');
        await pressInspect(inspect);
        const trace = traceOf(page, tool);
        await expect(trace).toBeVisible();
        // From three actors the line and its reached cell are in the quiet tone.
        expect(await groundOf(reachedCell(trace, 'request'))).toBe(await resolved(page, '--forge-quiet'));
        // The actor's run colour stays on its tile's band: A3's is the third of the run's colours.
        const tile = trace.locator('[data-forge-header] [data-actor-tile]');
        await expect(tile).toHaveText('A3');
        expect(await groundOf(tile.locator('[aria-hidden="true"]'))).toBe(await resolved(page, '--rust'));
        await picture(page, `${size.width}-${look}-f1-24-actors-a3`);
      });
    }
  });

  test('two actors\' tools of one name open each actor\'s own trace', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const numbers: string[] = [];
        for (const [column, label] of [['Leader A events for this turn', 'A1'], ['Leader B events for this turn', 'A2']]) {
          // The same name on each actor's card: each key opens that actor's own tool.
          await pressInspect(inspectKey(page.locator(`[aria-label="${column}"]`), HABITAT));
          const trace = traceOf(page, HABITAT);
          await expect(trace).toBeVisible();
          await expect(trace.locator('[data-forge-header] [data-actor-tile]')).toHaveText(label);
          const number = await trace.locator('[data-forge-header]').getByText(/^Forged tool \d+$/).textContent();
          numbers.push(number ?? '');
          await expect(trace).toHaveAccessibleName(`${HABITAT}, ${(number ?? '').toLowerCase()}`);
          await trace.getByRole('button', { name: 'Close the trace' }).click();
          await expect(trace).toBeHidden();
        }
        // Two tools of the run's list, each with a number of its own.
        expect(numbers[0]).toMatch(/^Forged tool \d+$/);
        expect(numbers[1]).toMatch(/^Forged tool \d+$/);
        expect(numbers[0]).not.toBe(numbers[1]);
      });
    }
  });
});

test.describe('the stations on the run\'s record', () => {
  test('f9 q15: Request holds the actor\'s line, what the tool does and its fields', async ({ page, request }) => {
    test.setTimeout(180_000);
    const tables: Record<string, string[][]> = {
      'Input fields': [
        ['dose_msv_per_day', 'number', 'Yes', 'Measured dose a day, in millisieverts.'],
        ['mission_days', 'integer', 'No', ''],
      ],
      'Output fields': [['budget_msv', 'number', 'Yes', 'Dose left before the career limit.']],
    };
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, RADIATION));
        const trace = traceOf(page, RADIATION);
        const station = await openStation(trace, 'request');

        // The actor by its tile's label and name, its department and turn, and the event the tool was made for.
        await expect(station.getByText('A2 Dietrich Voss, The Engineer · medical · turn 1 · for “Landfall”', { exact: true })).toBeVisible();
        await expect(station.getByRole('link', { name: 'Go to the event: Landfall', exact: true })).toBeVisible();
        // What the tool does, then its declared fields as two tables.
        await expect(station.getByRole('heading', { name: 'What it does', exact: true })).toBeVisible();
        await expect(station.getByText('Budgets the radiation dose left for a crew member.', { exact: true })).toBeVisible();
        for (const [caption, rows] of Object.entries(tables)) {
          const table = station.getByRole('table', { name: caption, exact: true });
          await expect(table).toBeVisible();
          await expect(table.getByRole('columnheader')).toHaveText(['Field', 'Type', 'Required', 'Description']);
          const bodyRows = table.getByRole('row').filter({ has: page.getByRole('cell') });
          await expect(bodyRows).toHaveCount(rows.length);
          for (const [i, cells] of rows.entries()) await expect(bodyRows.nth(i).getByRole('cell')).toHaveText(cells);
        }
        // The run's record holds no reason for a tool, so no part says why it was made.
        await expect(trace.getByText('Why it was made')).toHaveCount(0);
        await picture(page, `${size.width}-${look}-f9-request`);

        // Raw JSON shows the two schemas as JSON in place of the tables, and back.
        const raw = station.getByRole('switch', { name: 'Raw JSON', exact: true });
        await expect(raw).toHaveAttribute('aria-checked', 'false');
        await raw.click();
        await expect(raw).toHaveAttribute('aria-checked', 'true');
        await expect(station.getByRole('table')).toHaveCount(0);
        const json = JSON.parse((await station.locator('[data-raw-json]').textContent()) ?? '') as {
          input: { properties: Record<string, unknown> }; output: { required: string[] };
        };
        expect(Object.keys(json)).toEqual(['input', 'output']);
        expect(Object.keys(json.input.properties)).toEqual(['dose_msv_per_day', 'mission_days']);
        expect(json.output.required).toEqual(['budget_msv']);
        await picture(page, `${size.width}-${look}-f9-raw-json`);
        await raw.click();
        await expect(station.getByRole('table')).toHaveCount(2);
        await closeTrace(trace);

        // A tool that declares no fields says so for its input and its output.
        await pressInspect(inspectKey(page, OXYGEN));
        const oxygen = traceOf(page, OXYGEN);
        const empty = await openStation(oxygen, 'request');
        await expect(empty.getByText('This tool declares no input fields.', { exact: true })).toBeVisible();
        await expect(empty.getByText('This tool declares no output fields.', { exact: true })).toBeVisible();
        await expect(empty.getByRole('row').filter({ has: page.getByRole('cell') })).toHaveCount(0);
        await picture(page, `${size.width}-${look}-f9-no-fields`);
        await closeTrace(oxygen);
      });
    }
  });

  test('f9 q15: a field the record names with no schema reads "Not recorded" in its Type cell', async ({ page, request }) => {
    test.setTimeout(180_000);
    // The pair run's first tool: its record names its fields and holds no schema.
    const tables: Record<string, string[]> = { 'Input fields': ['radiation_msv_per_day', 'ice_index'], 'Output fields': ['score'] };
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const quiet = await resolved(page, '--forge-quiet');
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        const station = await openStation(trace, 'request');
        for (const [caption, fields] of Object.entries(tables)) {
          const rows = station.getByRole('table', { name: caption, exact: true }).getByRole('row').filter({ has: page.getByRole('cell') });
          await expect(rows).toHaveCount(fields.length);
          for (const [i, field] of fields.entries()) {
            const cells = rows.nth(i).getByRole('cell');
            // The name the record holds, "Not recorded" for its type, and nothing the record does not say.
            await expect(cells).toHaveText([field, 'Not recorded', '', '']);
            expect(await colourOf(cells.nth(1)), `${field}'s type, in the quiet tone`).toBe(quiet);
          }
        }
        await picture(page, `${size.width}-${look}-f9-not-recorded`);
      });
    }
  });

  test('f4 q16: Judge of a passed tool holds the notice, the confidence and its meter, and no checks', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await forgetOpenStations(page);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        // Judge decided a passed tool, so it is open when the trace opens.
        await expect(stationKey(trace, 'judge')).toHaveAttribute('aria-expanded', 'true');
        const judge = stationOf(trace, 'judge');
        await expect(judge.getByRole('heading', { name: 'What the judge said', exact: true })).toBeVisible();
        const notice = judge.getByText('A model\'s review of this code, not a security audit. Check before reuse.', { exact: true });
        const confidence = judge.getByText('The judge\'s confidence: 0.98 out of 1', { exact: true });
        await expect(notice).toBeVisible();
        await expect(confidence).toBeVisible();
        // The notice comes before the confidence.
        expect((await notice.boundingBox())!.y).toBeLessThan((await confidence.boundingBox())!.y);
        // The meter is 120 px wide, its fill the accent on the edge tone's track, never green.
        const meter = judge.getByRole('meter', { name: 'The judge\'s confidence', exact: true });
        await expect(meter).toHaveAttribute('aria-valuenow', '0.98');
        expect(Math.round((await meter.boundingBox())!.width)).toBe(120);
        expect(await groundOf(meter)).toBe(await resolved(page, '--forge-edge'));
        expect(await groundOf(meter.locator('[data-meter-fill]'))).toBe(await resolved(page, '--amber'));
        await expect(judge.getByText('The judge\'s words were not recorded for this run.', { exact: true })).toBeVisible();
        // The run's record holds none of the judge's four checks.
        await expect(trace.getByText(/^(Safe|Correct|Repeatable|Finishes)\b/)).toHaveCount(0);
        await picture(page, `${size.width}-${look}-f4-judge`);
      });
    }
  });

  test('f2 q15 and f3 q19: Code and Tests are inactive on the run\'s record', async ({ page, request }) => {
    test.setTimeout(180_000);
    const lines: Array<[string, string]> = [
      ['code', 'The code was not recorded for this run.'],
      ['tests', 'The tests were not recorded for this run.'],
    ];
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        await expect(trace).toBeVisible();
        for (const [station, line] of lines) {
          const key = stationKey(trace, station);
          await expect(key).toHaveAttribute('aria-disabled', 'true');
          await expect(key).toHaveAttribute('tabindex', '-1');
          // Pressing it opens nothing: no state to open, no evidence, and its one line stays.
          await key.click({ force: true });
          await expect(key).not.toHaveAttribute('aria-expanded');
          await expect(stationOf(trace, station).getByRole('region')).toHaveCount(0);
          await expect(stationOf(trace, station)).toContainText(line);
        }
        await picture(page, `${size.width}-${look}-f2-f3-inactive`);
      });
    }
  });

  test('f16 q3: Added lists each history row with the output the run recorded', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        const added = await openStation(trace, 'added');
        await expect(added.getByText('Used 1 time', { exact: true })).toBeVisible();
        const rows = added.getByRole('listitem');
        await expect(rows).toHaveCount(2);
        // The forge: its turn, department and event, the output its run recorded, and no test.
        const forged = rows.nth(0);
        await expect(forged.getByText('Turn 1 · engineering · “Landfall”', { exact: true })).toBeVisible();
        await expect(forged.getByText('Output the run recorded', { exact: true })).toBeVisible();
        await expect(forged.getByText('{"score":82}', { exact: true })).toBeVisible();
        await expect(forged.getByText('This forge\'s test was not recorded.', { exact: true })).toBeVisible();
        // The use in turn 2, with the output the run recorded.
        const used = rows.nth(1);
        await expect(used.getByText('Turn 2 · engineering · “Dust Season”', { exact: true })).toBeVisible();
        await expect(used.getByText('Output the run recorded', { exact: true })).toBeVisible();
        await expect(used.getByText('This forge\'s test was not recorded.')).toHaveCount(0);
        await expect(added.getByText('Not used after it was forged.')).toHaveCount(0);
        await picture(page, `${size.width}-${look}-f16-added`);
        await closeTrace(trace);

        // A tool nothing used after its forge.
        await pressInspect(inspectKey(page, GREENHOUSE));
        const greenhouse = traceOf(page, GREENHOUSE);
        const none = await openStation(greenhouse, 'added');
        await expect(none.getByText('Used 0 times', { exact: true })).toBeVisible();
        await expect(none.getByRole('listitem')).toHaveCount(1);
        await expect(none.getByText('Not used after it was forged.', { exact: true })).toBeVisible();
        await picture(page, `${size.width}-${look}-f16-not-used`);
        await closeTrace(greenhouse);
      });
    }
  });

  test('f12 q1: a passed tool opens with Judge open and every other station closed to its one line', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await forgetOpenStations(page);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        await expectOpen(trace, { request: false, code: 'inactive', tests: 'inactive', judge: true, added: false });
        await expect(stationOf(trace, 'request')).toContainText(LANDING_TEXT);
        await expect(stationOf(trace, 'added')).toContainText('Used 1 time');
        await expect(stationOf(trace, 'request').getByRole('region')).toHaveCount(0);
        await expect(stationOf(trace, 'added').getByRole('region')).toHaveCount(0);
        await picture(page, `${size.width}-${look}-f12-opens-at-judge`);
      });
    }
  });

  test('f12 q2: stations opened on one tool open on the next tool of the run beside its own deciding station', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await forgetOpenStations(page);
        await pressInspect(inspectKey(page, LANDING));
        const landing = traceOf(page, LANDING, 1);
        await openStation(landing, 'request');
        await openStation(landing, 'added');
        await closeTrace(landing);

        await pressInspect(inspectKey(page, OXYGEN));
        const oxygen = traceOf(page, OXYGEN);
        await expectOpen(oxygen, { request: true, code: 'inactive', tests: 'inactive', judge: true, added: true });
        await picture(page, `${size.width}-${look}-f12-kept-open`);
        await closeTrace(oxygen);

        // A kept station with nothing to open on a tool stays closed: Request alone opens on a tool that did not pass.
        await pressInspect(inspectKey(page, RADIATION));
        const radiation = traceOf(page, RADIATION);
        await expectOpen(radiation, { request: true, code: 'inactive', tests: 'inactive', judge: 'inactive', added: 'inactive' });
        await closeTrace(radiation);
      });
    }
  });

  test('f12 q4: Open all opens every station with evidence and Close all leaves the deciding one', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await forgetOpenStations(page);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        const openAll = trace.getByRole('button', { name: 'Open all stations', exact: true });
        await expect(openAll).toHaveText('Open all');
        await openAll.click();
        await expectOpen(trace, { request: true, code: 'inactive', tests: 'inactive', judge: true, added: true });
        const closeAll = trace.getByRole('button', { name: 'Close all stations', exact: true });
        await expect(closeAll).toHaveText('Close all');
        await expect(closeAll).toBeFocused();
        await picture(page, `${size.width}-${look}-f12-open-all`);
        await closeAll.click();
        await expectOpen(trace, { request: false, code: 'inactive', tests: 'inactive', judge: true, added: false });
        await expect(trace.getByRole('button', { name: 'Open all stations', exact: true })).toBeFocused();
      });
    }
  });

  test('f12 q8: Enter on a station opens it and keeps focus on its button', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await forgetOpenStations(page);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        const key = trace.getByRole('button', { name: 'Request: reached', exact: true });
        await key.focus();
        await page.keyboard.press('Enter');
        await expect(key).toHaveAttribute('aria-expanded', 'true');
        await expect(key).toBeFocused();
        // Space closes it again, and focus stays.
        await page.keyboard.press('Space');
        await expect(key).toHaveAttribute('aria-expanded', 'false');
        await expect(key).toBeFocused();
        // Judge closes the same way, to its one line on the record.
        const judge = trace.getByRole('button', { name: 'Judge: reached', exact: true });
        await judge.focus();
        await page.keyboard.press('Enter');
        await expect(judge).toHaveAttribute('aria-expanded', 'false');
        await expect(judge).toBeFocused();
        await expect(stationOf(trace, 'judge')).toContainText('Approved · confidence 0.98 out of 1');
      });
    }
  });

  test('f9 q3: the event link closes the trace and focuses that event in the run view', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        const station = await openStation(trace, 'request');
        await station.getByRole('link', { name: 'Go to the event: Landfall', exact: true }).click();
        await expect(trace).toBeHidden();
        // The pair run's turns hold one event each, so the turn row's heading is the event.
        const heading = page.locator('#turn-row-1-h');
        await expect(heading).toBeFocused();
        await expect(heading).toContainText('Landfall');
        await expect(heading).toBeInViewport();
        await picture(page, `${size.width}-${look}-f9-event-focused`);
      });
    }
  });

  test('a tool that did not pass opens with Request open', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await forgetOpenStations(page);
        await pressInspect(inspectKey(page, RADIATION));
        const trace = traceOf(page, RADIATION);
        await expectOpen(trace, { request: true, code: 'inactive', tests: 'inactive', judge: 'inactive', added: 'inactive' });
        // Request is the one station with evidence, so there is no Open all key.
        await expect(trace.getByRole('button', { name: /^(Open|Close) all stations$/ })).toHaveCount(0);
        await picture(page, `${size.width}-${look}-f12-did-not-pass`);
      });
    }
  });

  test('at 24 actors, Request names the actor by its tile\'s label and draws its rule in the actor\'s run colour', async ({ page, request }) => {
    test.setTimeout(240_000);
    const id = await sessionIdByName(request, COHORT_SERVER, RUNS.dozens);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await page.setViewportSize(size);
        await useLook(page, look);
        await page.goto(replayUrl(COHORT_SERVER, id, 'sim'));
        await lookShown(page, look);
        // The first forge card of A3's column, once the run's last actor has played in.
        await expect(page.locator('[aria-label^="Events for actor 24 on turn "] button[aria-label^="Inspect forged tool "]').first())
          .toBeAttached({ timeout: 60_000 });
        const inspect = page.locator('[aria-label^="Events for actor 3 on turn "] button[aria-label^="Inspect forged tool "]').first();
        const tool = ((await inspect.getAttribute('aria-label')) ?? '').replace('Inspect forged tool ', '');
        expect(tool).not.toBe('');
        await pressInspect(inspect);
        const trace = traceOf(page, tool);
        const station = await openStation(trace, 'request');
        // The actor's line begins with its tile's label, and its rule takes A3's run colour.
        await expect(station.locator('[data-actor-line]')).toHaveText(/^A3 \S/);
        expect(await groundOf(station.locator('[data-actor-rule]'))).toBe(await resolved(page, '--rust'));
        await picture(page, `${size.width}-${look}-f9-24-actors-a3`);
      });
    }
  });
});

/** Record, the key at the line's foot. */
const recordKey = (trace: Locator): Locator => trace.getByRole('button', { name: 'Record', exact: true });

/** Opens Record unless it is open, and returns what it opened. */
async function openRecord(trace: Locator): Promise<Locator> {
  const key = recordKey(trace);
  await expect(key).toHaveAttribute('aria-expanded', /^(true|false)$/);
  if ((await key.getAttribute('aria-expanded')) === 'false') await key.click();
  await expect(key).toHaveAttribute('aria-expanded', 'true');
  const panel = trace.locator('[data-record-panel]');
  await expect(panel).toBeVisible();
  return panel;
}

/** The raw record Record shows: the frames that name the tool, each frame's data, as JSON. */
async function rawRecordOf(panel: Locator): Promise<Array<Record<string, unknown>>> {
  return JSON.parse((await panel.locator('[data-raw-record]').textContent()) ?? '') as Array<Record<string, unknown>>;
}

/** Whether a frame's data names a tool: a forge's own name, or a report's list of tools. */
const namesTool = (data: Record<string, unknown>, tool: string): boolean =>
  data.name === tool
  || (Array.isArray(data.forgedTools) && (data.forgedTools as Array<{ name?: unknown }>).some(t => t?.name === tool));

/** Replaces the page's clipboard before any script runs: it keeps what it is given, or refuses. */
async function clipboardThat(page: Page, answer: 'keeps' | 'refuses'): Promise<void> {
  await page.addInitScript((how) => {
    const writeText = how === 'refuses'
      ? () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'))
      : (text: string) => { (window as unknown as { copied?: string }).copied = text; return Promise.resolve(); };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText: () => Promise.resolve('') } });
  }, answer);
}

/** The Event Log shows the three events of Aria Chen's first tool and nothing of another tool. */
async function expectLogFilteredToLandingTool(page: Page): Promise<void> {
  const log = page.getByRole('log', { name: 'Event log' });
  await expect(log).toBeVisible();
  await expect(log.getByText(`tool: ${LANDING}`)).toBeVisible();
  await expect(log.getByRole('heading', { name: /^Event Log \(3 of \d+ events\)$/ })).toBeVisible();
  // Its forge in turn 1, the report that used it in turn 1, the report that used it again in turn 2.
  await expect(log.locator('summary')).toHaveText([
    /forge_attempt\s*Aria Chen\s*T1\s*engineering/,
    /specialist_done\s*Aria Chen\s*T1\s*engineering/,
    /specialist_done\s*Aria Chen\s*T2\s*engineering/,
  ]);
  await expect(log).not.toContainText(WATER);
}

/** The attempt keys of the trace's head: Previous attempt, the count, Next attempt. */
const attemptKeys = (trace: Locator) => ({
  previous: trace.getByRole('button', { name: 'Previous attempt', exact: true }),
  next: trace.getByRole('button', { name: 'Next attempt', exact: true }),
  line: trace.locator('[data-attempt-line]'),
});

/** A1's tools in the 24-actor run that it forged more than once, each with the data of A1's frames that name it. */
function dozensReforgedOfA1(): Array<{ tool: string; forges: number; frames: Array<Record<string, unknown>> }> {
  const a1 = framesToSimEvents(generateCohortRun(DOZENS)).filter(e => e.leader === 'Aria Chen');
  const forges = new Map<string, number>();
  for (const e of a1) {
    if (e.type === 'forge_attempt' && typeof e.data?.name === 'string') forges.set(e.data.name, (forges.get(e.data.name) ?? 0) + 1);
  }
  return [...forges].filter(([, n]) => n > 1).map(([tool, n]) => ({
    tool,
    forges: n,
    frames: a1
      .filter(e => (e.type === 'forge_attempt' || e.type === 'specialist_done') && namesTool((e.data ?? {}) as Record<string, unknown>, tool))
      .map(e => e.data as Record<string, unknown>),
  }));
}

test.describe('Record and the attempts on the run\'s record', () => {
  test('f12 q18: Record on a run with no trace holds the run\'s record of the tool and its three keys', async ({ page, request }) => {
    test.setTimeout(180_000);
    await clipboardThat(page, 'keeps');
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        await expect(trace).toBeVisible();

        // Record is one key at the line's foot, never a sixth station.
        const stations = trace.getByRole('list', { name: 'The forge\'s stations' });
        await expect(stations.getByRole('listitem')).toHaveCount(5);
        await expect(stations.getByRole('button', { name: 'Record', exact: true })).toHaveCount(0);
        await expect(recordKey(trace)).toHaveAttribute('aria-expanded', 'false');

        const panel = await openRecord(trace);
        await expect(panel.getByText('The raw record', { exact: true })).toBeVisible();
        // Aria Chen's three frames that name the tool, in stream order, each as the Event Log lists its data.
        const record = await rawRecordOf(panel);
        expect(record).toHaveLength(3);
        expect(record[0].name).toBe(LANDING);
        expect(record.map(data => data.turn)).toEqual([1, 1, 2]);
        for (const data of record) {
          expect(namesTool(data, LANDING)).toBe(true);
          expect(Object.keys(data)).not.toContain('_filteredTools');
        }
        for (const key of ['Copy record', 'Download JSON', 'Show in Event Log']) {
          await expect(panel.getByRole('button', { name: key, exact: true })).toBeVisible();
        }
        await picture(page, `${size.width}-${look}-f12-record`);

        // Copy record copies the raw record and says so.
        await panel.getByRole('button', { name: 'Copy record', exact: true }).click();
        await expect(panel.getByText('Copied', { exact: true })).toBeVisible();
        const copied = await page.evaluate(() => (window as unknown as { copied?: string }).copied ?? '');
        expect(JSON.parse(copied)).toEqual(record);

        // Record closes again on its key.
        await recordKey(trace).click();
        await expect(recordKey(trace)).toHaveAttribute('aria-expanded', 'false');
        await expect(trace.locator('[data-record-panel]')).toBeHidden();
      });
    }
  });

  test('f12 q5: Download JSON saves "{tool name}-trace.json"', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, LANDING));
        const panel = await openRecord(traceOf(page, LANDING, 1));
        const record = await rawRecordOf(panel);
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          panel.getByRole('button', { name: 'Download JSON', exact: true }).click(),
        ]);
        expect(download.suggestedFilename()).toBe(`${LANDING}-trace.json`);
        // The file holds the record the panel shows.
        expect(JSON.parse(readFileSync(await download.path(), 'utf8'))).toEqual(record);
      });
    }
  });

  test('f12 q6: Show in Event Log closes the trace and opens the Event Log on this actor\'s tool', async ({ page, request }) => {
    test.setTimeout(180_000);
    const id = await pairSessionId(request);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        const panel = await openRecord(trace);
        await panel.getByRole('button', { name: 'Show in Event Log', exact: true }).click();
        await expect(trace).toBeHidden();
        // The address holds the replay, Settings, its Event Log, this actor, and the tool by its whole name.
        await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('settings');
        const address = new URL(page.url());
        expect(address.searchParams.get('replay')).toBe(id);
        expect(address.searchParams.get('sub')).toBe('log');
        expect(address.searchParams.get('logLeader')).toBe('Aria Chen');
        expect(address.hash).toBe(`#log=${LANDING}&logExact=1`);
        await expectLogFilteredToLandingTool(page);
        await picture(page, `${size.width}-${look}-f12-show-in-event-log`);
      });
    }
  });

  test('f12 q13: a refused clipboard says the record was not copied', async ({ page, request }) => {
    test.setTimeout(180_000);
    await clipboardThat(page, 'refuses');
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, LANDING));
        const panel = await openRecord(traceOf(page, LANDING, 1));
        await panel.getByRole('button', { name: 'Copy record', exact: true }).click();
        await expect(panel.getByText('Could not copy. Select the record and copy it.', { exact: true })).toBeVisible();
        await expect(panel.getByText('Copied', { exact: true })).toHaveCount(0);
        // The record stays on show to select by hand.
        await expect(panel.locator('[data-raw-record]')).toBeVisible();
        await picture(page, `${size.width}-${look}-f12-copy-refused`);
      });
    }
  });

  test('f12 q15: a download that fails says so', async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      URL.createObjectURL = () => { throw new Error('The browser could not make the file.'); };
    });
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, LANDING));
        const panel = await openRecord(traceOf(page, LANDING, 1));
        await panel.getByRole('button', { name: 'Download JSON', exact: true }).click();
        await expect(panel.getByText('Could not download. Try again, or use Copy record.', { exact: true })).toBeVisible();
        await picture(page, `${size.width}-${look}-f12-download-failed`);
      });
    }
  });

  test('f13 q1 and q2: a tool forged twice opens at attempt 2, with the spur of attempt 1 after Request', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        // Either forge card's key opens the tool at its latest attempt.
        await pressInspect(inspectKey(page, RATION).first());
        const trace = traceOf(page, RATION);
        const keys = attemptKeys(trace);

        // Attempt 2, the latest: its head says what its forge said, with "2 of 2" between its keys.
        await expect(trace.getByText('Passed. The judge approved it.', { exact: true })).toBeVisible();
        await expect(trace.getByRole('group', { name: 'Attempt 2 of 2', exact: true })).toBeVisible();
        await expect(keys.line).toHaveText('2 of 2');
        await expect(keys.previous).toBeEnabled();
        await expect(keys.next).toBeDisabled();
        const order = await trace.evaluate((dialog) => {
          const named = (name: string) => dialog.querySelector(`[aria-label="${name}"]`);
          const [prev, line, next] = [named('Previous attempt'), dialog.querySelector('[data-attempt-line]'), named('Next attempt')];
          if (!prev || !line || !next) return null;
          const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
          return follows(prev, line) && follows(line, next);
        });
        expect(order, 'the count stands between Previous attempt and Next attempt').toBe(true);
        await expect(trace.getByText('The reason the run recorded')).toHaveCount(0);
        // Attempt 1 leaves the line after Request as one row, a link to that attempt.
        const request1 = stationOf(trace, 'request');
        const spur = request1.getByRole('link', { name: 'Attempt 1 · Did not pass', exact: true });
        await expect(spur).toBeVisible();
        await expect(spur.locator('svg[data-glyph]')).toHaveAttribute('data-glyph', 'didNotPass');
        await expect(trace.getByRole('link', { name: /^Attempt \d+ · / })).toHaveCount(1);
        await picture(page, `${size.width}-${look}-f13-attempt-2`);

        // Previous attempt: attempt 1's trace, the branch to attempt 2, and focus on the key pressed.
        await keys.previous.click();
        await expect(trace.getByRole('group', { name: 'Attempt 1 of 2', exact: true })).toBeVisible();
        await expect(keys.line).toHaveText('Attempt 1 of 2');
        const firstInHead = trace.locator('[data-forge-head] > *').first();
        await expect(firstInHead).toContainText('Attempt 1 of 2');
        await expect(trace.getByText('Did not pass. The run\'s record does not say where the forge stopped.', { exact: true })).toBeVisible();
        await expect(trace.getByText('The reason the run recorded', { exact: true })).toBeVisible();
        const branch = stationOf(trace, 'request').getByRole('link', { name: 'Attempt 2 · Passed', exact: true });
        await expect(branch).toBeVisible();
        await expect(branch.locator('svg[data-glyph]')).toHaveAttribute('data-glyph', 'passed');
        await expect(trace.getByRole('link', { name: /^Attempt \d+ · / })).toHaveCount(1);
        await expect(keys.previous).toBeDisabled();
        await expect(keys.next).toBeEnabled();
        await expect(keys.previous).toBeFocused();
        await expect(trace).toHaveAccessibleName(new RegExp(`^${RATION}, forged tool \\d+$`));
        await picture(page, `${size.width}-${look}-f13-attempt-1`);

        // The branch is a link to attempt 2: the trace swaps back, and focus stays on that row, now attempt 1's spur.
        await branch.click();
        await expect(keys.line).toHaveText('2 of 2');
        await expect(stationOf(trace, 'request').getByRole('link', { name: 'Attempt 1 · Did not pass', exact: true })).toBeFocused();
      });
    }
  });

  test('f13 q3: a tool forged once has no attempt keys, spur or branch', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        await expect(trace).toBeVisible();
        const keys = attemptKeys(trace);
        await expect(keys.previous).toHaveCount(0);
        await expect(keys.next).toHaveCount(0);
        await expect(keys.line).toHaveCount(0);
        await expect(trace.getByRole('link', { name: /^Attempt \d+ · / })).toHaveCount(0);
      });
    }
  });

  test('f13 q4: the attempt keys and their count stay one row at 320', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const look of LOOKS) {
      await test.step(`320 in the ${look} look`, async () => {
        await openPairSim(page, request, { width: 320, height: 844 }, look);
        await pressInspect(inspectKey(page, RATION).first());
        const trace = traceOf(page, RATION);
        for (const shown of ['2 of 2', 'Attempt 1 of 2']) {
          const keys = attemptKeys(trace);
          if (shown !== '2 of 2') await keys.previous.click();
          await expect(keys.line).toHaveText(shown);
          const boxes = await Promise.all([keys.previous, keys.line, keys.next].map(part => part.boundingBox()));
          expect(boxes.every(Boolean), 'each part of the attempt row is drawn').toBe(true);
          const [prev, line, next] = boxes as Array<{ x: number; y: number; width: number; height: number }>;
          // One row: each part stands beside the others, left to right, none under another.
          for (const part of [line, next]) {
            expect(part.y, `"${shown}": no part sits under Previous attempt`).toBeLessThan(prev.y + prev.height);
            expect(prev.y, `"${shown}": no part sits over Previous attempt`).toBeLessThan(part.y + part.height);
          }
          expect(prev.x + prev.width).toBeLessThanOrEqual(line.x + 0.5);
          expect(line.x + line.width).toBeLessThanOrEqual(next.x + 0.5);
          // A phone's keys are 44 px tall, and the sheet does not scroll sideways.
          expect(prev.height).toBeGreaterThanOrEqual(44);
          expect(next.height).toBeGreaterThanOrEqual(44);
          expect(await trace.evaluate(dialog => dialog.scrollWidth - dialog.clientWidth)).toBeLessThanOrEqual(0);
          await picture(page, `320-${look}-f13-attempt-row-${shown === '2 of 2' ? 'latest' : 'earlier'}`);
        }
      });
    }
  });

  test('at 24 actors, a re-forged tool opens at its latest attempt with its spur, and Record holds that actor\'s frames alone', async ({ page, request }) => {
    test.setTimeout(240_000);
    const id = await sessionIdByName(request, COHORT_SERVER, RUNS.dozens);
    const reforged = dozensReforgedOfA1();
    expect(reforged.length, 'A1 of the 24-actor run holds a tool it forged more than once').toBeGreaterThan(0);
    const { tool, forges, frames } = reforged[0];
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await page.setViewportSize(size);
        await useLook(page, look);
        await page.goto(replayUrl(COHORT_SERVER, id, 'sim'));
        await lookShown(page, look);
        // A1's forge card of the tool, once the run's last actor has played in.
        await expect(page.locator('[aria-label^="Events for actor 24 on turn "] button[aria-label^="Inspect forged tool "]').first())
          .toBeAttached({ timeout: 60_000 });
        await pressInspect(inspectKey(page.locator('[aria-label^="Events for actor 1 on turn "]'), tool).first());
        const trace = traceOf(page, tool);
        await expect(trace).toBeVisible();
        await expect(trace.locator('[data-forge-header] [data-actor-tile]')).toHaveText('A1');

        // The latest attempt, with each earlier one as a row after Request.
        await expect(attemptKeys(trace).line).toHaveText(`${forges} of ${forges}`);
        await expect(attemptKeys(trace).next).toBeDisabled();
        await expect(stationOf(trace, 'request').getByRole('link', { name: 'Attempt 1 · Did not pass', exact: true })).toBeVisible();
        await expect(stationOf(trace, 'request').getByRole('link', { name: /^Attempt \d+ · / })).toHaveCount(forges - 1);

        // Record: A1's own frames that name the tool, and no other actor's.
        const panel = await openRecord(trace);
        expect(await rawRecordOf(panel)).toEqual(frames);
        await picture(page, `${size.width}-${look}-f13-24-actors-a1`);

        // Show in Event Log: the log of A1's tool, by A1's name.
        await panel.getByRole('button', { name: 'Show in Event Log', exact: true }).click();
        await expect(trace).toBeHidden();
        await expect.poll(() => new URL(page.url()).searchParams.get('logLeader')).toBe('Aria Chen');
        const log = page.getByRole('log', { name: 'Event log' });
        await expect(log.getByText(`tool: ${tool}`)).toBeVisible();
        await expect(log.getByRole('heading', { name: new RegExp(`^Event Log \\(${frames.length} of \\d+ events\\)$`) })).toBeVisible();
      });
    }
  });
});

/** The run's tools as the dashboard numbers them: its own registry, built from the frames the server stores. */
const registryOf = (frames: string[]) => buildToolRegistry(computeGameState(framesToSimEvents(frames), true));

/** The trace's Copy link to this tool key. */
const copyLinkKey = (trace: Locator): Locator => trace.getByRole('button', { name: 'Copy link to this tool', exact: true });

/** The words Copy link to this tool says when the link is on the clipboard. */
const LINK_COPIED = 'Link copied. Anyone with it can open this tool\'s trace and replay the run.';

/** The address with the parameters given added, every other one kept. */
function withParams(address: string, params: Record<string, string>): string {
  const url = new URL(address);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** Records the name of every forged tool's dialog the page shows, from before its first script runs. */
async function recordTraceNames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { traceNames: string[] }).traceNames = seen;
    const note = () => {
      for (const el of document.querySelectorAll('[role="dialog"][aria-label*=", forged tool "]')) {
        const name = el.getAttribute('aria-label') ?? '';
        if (!seen.includes(name)) seen.push(name);
      }
    };
    new MutationObserver(note).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
  });
}

/** Waits until the replay has played in to its end: the page's run status reads Complete. */
const replayComplete = (page: Page, timeout: number) =>
  expect(page.locator('[role="status"][aria-label^="Complete."]').first()).toBeAttached({ timeout });

const traceNamesSeen = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { traceNames?: string[] }).traceNames ?? []);

/** The 300-actor run's actor and its tool a test opens by link. */
function maximumTool(actorIndex: number, which: 'reforged' | 'first') {
  const frames = generateCohortRun(MAXIMUM);
  const registry = registryOf(frames);
  // A re-forged tool: its first forge did not pass and its latest did, so Added holds its uses.
  const entry = registry.list.find(e => e.actorIndex === actorIndex
    && (which === 'first' || (e.attempts.length > 1 && !e.attempts[0].approved && e.outcome === 'passed')));
  expect(entry, `A${actorIndex + 1} of the 300-actor run holds the tool`).toBeTruthy();
  const leader = registry.actors[actorIndex].name;
  const own = framesToSimEvents(frames)
    .filter(e => e.leader === leader)
    .filter(e => (e.type === 'forge_attempt' || e.type === 'specialist_done') && namesTool((e.data ?? {}) as Record<string, unknown>, entry!.name))
    .map(e => e.data as Record<string, unknown>);
  return { tool: entry!.name, n: entry!.n, forges: entry!.attempts.length, leader, frames: own };
}

test.describe('a link to one tool', () => {
  test('f1 q6 and f12 q10: a copied link opens the same tool with the same stations open in a new browser', async ({ browser, page, request }) => {
    test.setTimeout(240_000);
    await clipboardThat(page, 'keeps');
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await forgetOpenStations(page);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        await expect(trace).toBeVisible();
        await openStation(trace, 'request');
        await openStation(trace, 'added');

        await expect(copyLinkKey(trace)).toBeVisible();
        await copyLinkKey(trace).click();
        const said = trace.getByRole('status').filter({ hasText: LINK_COPIED });
        await expect(said).toBeVisible();
        await expect(said).toHaveAttribute('aria-live', 'polite');
        await picture(page, `${size.width}-${look}-f1-link-copied`);
        const link = await page.evaluate(() => (window as unknown as { copied?: string }).copied ?? '');
        const url = new URL(link);
        expect(url.origin).toBe(PAIR_SERVER);
        expect(url.searchParams.get('replay')).toBe(await pairSessionId(request));
        expect(url.searchParams.get('tool')).toBe('1');
        expect(url.searchParams.get('open')).toBe('request,judge,added');
        // Copied stays for 5 seconds, then the key stands on its own again.
        await expect(said).toBeHidden({ timeout: 8_000 });

        // A new browser: nothing kept on its device, the link alone opens the tool and its stations.
        const other = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
        try {
          const visitor = await other.newPage();
          await visitor.goto(link);
          await replayComplete(visitor, 60_000);
          const shared = traceOf(visitor, LANDING, 1);
          await expect(shared).toBeVisible();
          await expectOpen(shared, { request: true, code: 'inactive', tests: 'inactive', judge: true, added: true });
          await visitor.screenshot({ path: `${PICTURES}/${size.width}-${look}-f12-link-opened.png`, animations: 'disabled' });
          // Close leaves the run on the page, with no tool in the address.
          await closeTrace(shared);
          await expect.poll(() => new URL(visitor.url()).searchParams.get('tool')).toBeNull();
          expect(new URL(visitor.url()).searchParams.get('open')).toBeNull();
          expect(new URL(visitor.url()).searchParams.get('replay')).toBe(url.searchParams.get('replay'));
        } finally {
          await other.close();
        }
      });
    }
  });

  test('f1 q14: offline, the key copies and says "You are offline"', async ({ page, context, request }) => {
    test.setTimeout(180_000);
    await clipboardThat(page, 'keeps');
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await context.setOffline(false);
        await openPairSim(page, request, size, look);
        await context.setOffline(true);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        await expect(trace).toBeVisible();
        const key = copyLinkKey(trace);
        await expect(key).toBeEnabled();
        await expect(key).not.toHaveAttribute('aria-disabled', 'true');
        await key.click();
        await expect(trace.getByText('You are offline', { exact: true })).toBeVisible();
        await expect(trace.getByText(LINK_COPIED, { exact: true })).toBeVisible();
        const link = await page.evaluate(() => (window as unknown as { copied?: string }).copied ?? '');
        expect(new URL(link).searchParams.get('tool')).toBe('1');
        await picture(page, `${size.width}-${look}-f1-offline`);
        // Back online, the words go.
        await context.setOffline(false);
        await expect(trace.getByText('You are offline', { exact: true })).toBeHidden();
        await closeTrace(trace);
      });
    }
  });

  test('f1 q16: a refused clipboard shows the link to copy by hand', async ({ page, request }) => {
    test.setTimeout(180_000);
    await clipboardThat(page, 'refuses');
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        await pressInspect(inspectKey(page, LANDING));
        const trace = traceOf(page, LANDING, 1);
        await expect(trace).toBeVisible();
        await expect(copyLinkKey(trace)).toBeVisible();
        await copyLinkKey(trace).click();
        await expect(trace.getByText('Could not copy. Select the link and copy it.', { exact: true })).toBeVisible();
        // The link stands as text to select and copy.
        const shown = trace.locator('[data-tool-link]');
        await expect(shown).toBeVisible();
        const link = new URL((await shown.textContent()) ?? '');
        expect(link.origin).toBe(PAIR_SERVER);
        expect(link.searchParams.get('tool')).toBe('1');
        expect(await shown.evaluate(el => getComputedStyle(el).userSelect)).not.toBe('none');
        await picture(page, `${size.width}-${look}-f1-copy-refused`);
      });
    }
  });

  test('f1 q30: a link to A300\'s tool opens with its 40px tile', async ({ page, request }) => {
    test.setTimeout(240_000);
    const id = await sessionIdByName(request, COHORT_SERVER, RUNS.maximum);
    const { tool, n } = maximumTool(299, 'first');
    await page.setViewportSize(WIDTHS[0]);
    await useLook(page, 'light');
    await page.goto(withParams(replayUrl(COHORT_SERVER, id, 'sim'), { tool: String(n) }));
    await replayComplete(page, 150_000);
    const trace = traceOf(page, tool, n);
    await expect(trace).toBeVisible();
    const tile = trace.locator('[data-forge-header] [data-actor-tile]');
    await expect(tile).toHaveText('A300');
    expect((await tile.boundingBox())?.width ?? 0).toBeCloseTo(40, 0);
    // The tile's label and the tool's number stand whole on the header row.
    await expect(trace.locator('[data-forge-header]')).toContainText(`Forged tool ${n}`);
    await picture(page, '390-light-f1-a300-link');
  });

  test('a link to a tool the run lacks opens the run, with no dialog, and leaves the address clean', async ({ page, request }) => {
    test.setTimeout(180_000);
    const id = await pairSessionId(request);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await page.setViewportSize(size);
        await useLook(page, look);
        await recordTraceNames(page);
        await page.goto(withParams(replayUrl(PAIR_SERVER, id, 'sim'), { tool: '999', open: 'request,judge' }));
        await lookShown(page, look);
        // Once the replay has played in, the parameters that point at nothing leave the address.
        await replayComplete(page, 60_000);
        await expect.poll(() => new URL(page.url()).searchParams.has('tool')).toBe(false);
        const address = new URL(page.url());
        expect(address.searchParams.has('open')).toBe(false);
        expect(address.searchParams.get('replay')).toBe(id);
        expect(address.searchParams.get('tab')).toBe('sim');
        await expect(page.getByText(LAST_TOOL).first()).toBeAttached();
        await expect(page.getByRole('dialog', { name: /, forged tool \d+$/ })).toHaveCount(0);
        expect(await traceNamesSeen(page)).toEqual([]);
        await picture(page, `${size.width}-${look}-link-tool-the-run-lacks`);
      });
    }
  });

  test('a link to a later actor\'s tool opens that tool, not the one holding its number while the replay plays in', async ({ page, request }) => {
    test.setTimeout(180_000);
    const id = await pairSessionId(request);
    const rover = registryOf(pairRunFrames()).getEntryFor(1, LAST_TOOL);
    expect(rover, 'Dietrich Voss holds rover_route_planner').toBeTruthy();
    const n = rover!.n;
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await page.setViewportSize(size);
        await useLook(page, look);
        await recordTraceNames(page);
        await page.goto(withParams(replayUrl(PAIR_SERVER, id, 'sim'), { tool: String(n) }));
        await replayComplete(page, 60_000);
        const trace = traceOf(page, LAST_TOOL, n);
        await expect(trace).toBeVisible();
        await expect(trace.locator('[data-forge-header] [data-actor-tile]')).toHaveText('A2');
        await expect(trace.getByRole('heading', { level: 2, name: LAST_TOOL }).first()).toBeAttached();
        // The one trace the page opened is the one the link names.
        expect(await traceNamesSeen(page)).toEqual([`${LAST_TOOL}, forged tool ${n}`]);
        await expect.poll(() => new URL(page.url()).searchParams.get('tool')).toBe(String(n));
        await closeTrace(trace);
        await expect.poll(() => new URL(page.url()).searchParams.get('tool')).toBeNull();
      });
    }
  });

  test('f1 q17 again: the header row with Copy link stays one row at the sweep widths', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const look of LOOKS) {
      await openPairSim(page, request, WIDTHS[0], look);
      await pressInspect(inspectKey(page, LANDING));
      const trace = traceOf(page, LANDING, 1);
      await expect(trace).toBeVisible();
      for (const width of SWEEP_WIDTHS) {
        await test.step(`${width} in the ${look} look`, async () => {
          await page.setViewportSize({ width, height: 844 });
          await expect(copyLinkKey(trace)).toBeVisible();
          const row = await trace.evaluate((dialog) => {
            const header = dialog.querySelector('[data-forge-header]');
            if (!header) return null;
            const box = (el: Element) => {
              const r = el.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
            };
            const shown = (el: Element) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
            return {
              sheet: box(dialog),
              headerScroll: header.scrollWidth - header.clientWidth,
              keys: Array.from(header.querySelectorAll('button')).filter(shown).map(key => ({
                name: key.getAttribute('aria-label') ?? '', rowTop: (key as HTMLElement).offsetTop, ...box(key),
              })),
            };
          });
          expect(row, 'the trace has a header row').not.toBeNull();
          const { keys, sheet } = row!;
          // Close, Copy link to this tool and the look key, in that order, on one row.
          expect(keys.map(key => key.name)).toEqual(['Close the trace', 'Copy link to this tool', expect.stringMatching(/^Switch to (light|dark) mode$/)]);
          expect(new Set(keys.map(key => key.rowTop)).size, 'every key of the header row shares one top').toBe(1);
          expect(row!.headerScroll, 'the header row does not scroll sideways').toBeLessThanOrEqual(0);
          for (const key of keys) {
            expect(key.left, `"${key.name}" is inside the sheet`).toBeGreaterThanOrEqual(sheet.left - 0.5);
            expect(key.right, `"${key.name}" is inside the sheet`).toBeLessThanOrEqual(sheet.right + 0.5);
            // A phone's keys are 44 px square; from 900 px they are 32 px.
            if (width < 900) expect(Math.round(key.height), `"${key.name}" is 44 px tall`).toBeGreaterThanOrEqual(44);
          }
          if (width === 320) await picture(page, `320-${look}-f1-header-row-copy-link`);
        });
      }
    }
  });

  test('at 300 actors, a link opens A299\'s re-forged tool with Request and Added open, and its Record holds A299\'s frames alone', async ({ page, request }) => {
    test.setTimeout(300_000);
    const id = await sessionIdByName(request, COHORT_SERVER, RUNS.maximum);
    const { tool, n, forges, frames } = maximumTool(298, 'reforged');
    expect(forges).toBeGreaterThan(1);
    for (const { size, look } of [{ size: WIDTHS[1], look: 'dark' as Look }, { size: WIDTHS[0], look: 'light' as Look }]) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await page.setViewportSize(size);
        await useLook(page, look);
        await page.goto(withParams(replayUrl(COHORT_SERVER, id, 'sim'), { tool: String(n), open: 'request,added' }));
        await replayComplete(page, 150_000);
        const trace = traceOf(page, tool, n);
        await expect(trace).toBeVisible();
        await expect(trace.locator('[data-forge-header] [data-actor-tile]')).toHaveText('A299');
        await expect(attemptKeys(trace).line).toHaveText(`${forges} of ${forges}`);
        await expect(stationOf(trace, 'request').getByRole('link', { name: 'Attempt 1 · Did not pass', exact: true })).toBeVisible();
        await expectOpen(trace, { request: true, judge: true, added: true });
        await expect(stationOf(trace, 'request').locator('[data-actor-line]')).toHaveText(/^A299 \S/);
        // Record: A299's own frames that name the tool, and no other actor's.
        const panel = await openRecord(trace);
        expect(await rawRecordOf(panel)).toEqual(frames);
        await picture(page, `${size.width}-${look}-f1-a299-link`);
      });
    }
  });
});

/** The forged toolbox: a dialog named for the run's count of tools. */
const toolboxOf = (page: Page, tools?: number): Locator =>
  page.getByRole('dialog', {
    name: tools === undefined ? /^Forged toolbox, [\d,]+ tools?$/ : `Forged toolbox, ${tools.toLocaleString('en-US')} tools`,
  });

/** The Sim footer's key that opens the forged toolbox. */
const toolboxKey = (page: Page): Locator => page.getByRole('button', { name: /^Open Forged Toolbox/ });

/** Opens the forged toolbox from the Sim footer. */
async function openToolbox(page: Page, tools?: number): Promise<Locator> {
  await toolboxKey(page).click();
  const toolbox = toolboxOf(page, tools);
  await expect(toolbox).toBeVisible();
  return toolbox;
}

/** The toolbox's rows, in a dialog or in Reports' page: one for each actor's tool. */
const rowsOf = (scope: Locator): Locator => scope.locator('[data-tool-row]');
/** One tool's row, of one actor where two actors forged the name. */
const rowOf = (scope: Locator, tool: string, actor?: string): Locator =>
  scope.locator(`[data-tool-row][data-tool-name="${tool}"]${actor ? `[data-actor="${actor}"]` : ''}`);
/** A row's own key: the button that opens its tool's trace. */
const rowKey = (row: Locator): Locator => row.getByRole('button');
/** The stations of a row's line in small, each with its state: "request:reached". */
const rowLine = (row: Locator): Promise<string[]> =>
  row.locator('[data-forge-line="row"] [data-station]')
    .evaluateAll(els => els.map(el => `${el.getAttribute('data-station')}:${el.getAttribute('data-state')}`));
/** The stations of a trace's line, each with its state. */
const traceLine = (trace: Locator): Promise<string[]> =>
  trace.locator('[data-forge-line="trace"] > [data-station]')
    .evaluateAll(els => els.map(el => `${el.getAttribute('data-station')}:${el.getAttribute('data-state')}`));
const namesOf = (rows: Locator): Promise<Array<string | null>> =>
  rows.evaluateAll(els => els.map(el => el.getAttribute('data-tool-name')));
const sizeOf = (part: Locator): Promise<string> => part.evaluate(el => getComputedStyle(el).fontSize);

const FIVE_REACHED = ['request:reached', 'code:reached', 'tests:reached', 'judge:reached', 'added:reached'];
const REQUEST_ALONE = ['request:reached', 'code:unknown', 'tests:unknown', 'judge:unknown', 'added:notReached'];
const PAIR_COUNT_LINE = '12 tools from 13 forges (1 re-forge) · 9 passed · 4 did not pass';
/** Aria Chen's tool whose only forge did not pass, and that no report lists. */
const SHELTER = 'dust_storm_shelter_plan';

/** Chooses one filter: a segment from 768 px, the one-row menu below it. */
async function chooseShow(toolbox: Locator, width: number, label: string): Promise<void> {
  if (width >= 768) await toolbox.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: label, exact: true }).check();
  else await toolbox.getByRole('combobox', { name: 'Show' }).selectOption({ label });
}

/** A row's name for a screen reader: the tool, its outcome, its actor, and its forges when it was forged again. */
const rowNameOf = (entry: { name: string; outcome: string; actorIndex: number; actorName: string; attempts: unknown[] }): string =>
  `${entry.name}, ${entry.outcome === 'passed' ? 'Passed' : 'Did not pass'}, made by A${entry.actorIndex + 1} ${entry.actorName}`
  + (entry.attempts.length > 1 ? `, forged ${entry.attempts.length} times` : '');

/** Opens a run of the cohort server on the Sim tab, played in to its end. */
async function openCohortSim(page: Page, request: APIRequestContext, run: string, size: Size, look: Look, timeout: number): Promise<void> {
  const id = await sessionIdByName(request, COHORT_SERVER, run);
  await page.setViewportSize(size);
  await useLook(page, look);
  await page.goto(replayUrl(COHORT_SERVER, id, 'sim'));
  await lookShown(page, look);
  await replayComplete(page, timeout);
}

test.describe('the forged toolbox on the run\'s record', () => {
  test('f10 q1 and q21: the count line and the filter of a run with no trace', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const toolbox = await openToolbox(page, 12);
        // The toolbox opens with focus on its title.
        await expect(toolbox.getByRole('heading', { level: 2, name: 'FORGED TOOLBOX' })).toBeFocused();
        // The count line counts forges: thirteen of them made twelve tools.
        await expect(toolbox.locator('[data-toolbox-count]')).toHaveText(PAIR_COUNT_LINE);
        await expect(rowsOf(toolbox)).toHaveCount(12);

        // The filter counts the rows it shows: segments on a desktop, the one-row menu on a phone.
        const segments = toolbox.getByRole('radiogroup', { name: 'Show' });
        const menu = toolbox.getByRole('combobox', { name: 'Show' });
        if (size.width >= 768) {
          await expect(segments.getByRole('radio')).toHaveCount(3);
          for (const name of ['All 12', 'Passed 9', 'Did not pass 3']) {
            await expect(segments.getByRole('radio', { name, exact: true })).toBeVisible();
          }
          await expect(segments.getByRole('radio', { name: 'All 12', exact: true })).toBeChecked();
          await expect(menu).toHaveCount(0);
        } else {
          await expect(menu).toBeVisible();
          await expect(toolbox.locator('[data-toolbox-menu]')).toContainText('Show:');
          expect(await menu.locator('option').allTextContents()).toEqual(['All 12', 'Passed 9', 'Did not pass 3']);
          expect(await menu.evaluate(el => (el as HTMLSelectElement).selectedOptions[0]?.textContent)).toBe('All 12');
          await expect(segments).toHaveCount(0);
        }

        // A passed row's line fills its five cells; a row that did not pass fills Request alone.
        expect(await rowLine(rowOf(toolbox, LANDING))).toEqual(FIVE_REACHED);
        expect(await rowLine(rowOf(toolbox, RADIATION))).toEqual(REQUEST_ALONE);
        await picture(page, `${size.width}-${look}-f10-toolbox`);

        // Each filter shows its rows alone, under the same count line.
        await chooseShow(toolbox, size.width, 'Did not pass 3');
        expect(await namesOf(rowsOf(toolbox))).toEqual([SHELTER, RADIATION, MORALE]);
        await expect.poll(() => new URL(page.url()).searchParams.get('show')).toBe('did_not_pass');
        await chooseShow(toolbox, size.width, 'Passed 9');
        await expect(rowsOf(toolbox)).toHaveCount(9);
        await expect(rowsOf(toolbox).locator('[data-row-outcome]')).toHaveText(Array.from({ length: 9 }, () => 'Passed'));
        await expect(toolbox.locator('[data-toolbox-count]')).toHaveText(PAIR_COUNT_LINE);
        await chooseShow(toolbox, size.width, 'All 12');
        await expect(rowsOf(toolbox)).toHaveCount(12);
        await expect.poll(() => new URL(page.url()).searchParams.get('show')).toBeNull();
      });
    }
  });

  test('f10 q3: Find a tool narrows by name, says so when nothing matches, and Clear brings every row back', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of [{ size: { width: 768, height: 900 }, look: 'dark' as Look }, { size: WIDTHS[0], look: 'light' as Look }]) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const toolbox = await openToolbox(page, 12);
        const find = toolbox.getByRole('searchbox', { name: 'Find a tool' });

        // Part of a name: both actors' rows of it, and no other row.
        await find.fill('habitat');
        await expect(rowsOf(toolbox)).toHaveCount(2);
        expect(await namesOf(rowsOf(toolbox))).toEqual([HABITAT, HABITAT]);
        await expect(rowOf(toolbox, HABITAT, 'A1')).toBeVisible();
        await expect(rowOf(toolbox, HABITAT, 'A2')).toBeVisible();
        await expect.poll(() => new URL(page.url()).searchParams.get('find')).toBe('habitat');

        // A name no tool holds: the list says so, and Clear is the way forward.
        await find.fill('zzz');
        await expect(rowsOf(toolbox)).toHaveCount(0);
        await expect(toolbox.getByText('No tool matches “zzz”.', { exact: true })).toBeVisible();
        await picture(page, `${size.width}-${look}-f10-no-tool-matches`);
        await toolbox.getByRole('button', { name: 'Clear', exact: true }).click();
        await expect(rowsOf(toolbox)).toHaveCount(12);
        await expect(find).toHaveValue('');
        await expect(find).toBeFocused();

        // The field's own key clears it too.
        await find.fill('rover');
        expect(await namesOf(rowsOf(toolbox))).toEqual([LAST_TOOL]);
        await toolbox.getByRole('button', { name: 'Clear the search', exact: true }).click();
        await expect(rowsOf(toolbox)).toHaveCount(12);
        await expect(find).toBeFocused();
        await expect.poll(() => new URL(page.url()).searchParams.get('find')).toBeNull();

        // The address holds the toolbox and the search, so the link opens the same rows.
        await find.fill('habitat');
        await expect.poll(() => new URL(page.url()).searchParams.get('find')).toBe('habitat');
        expect(new URL(page.url()).searchParams.get('toolbox')).toBe('1');
        await page.goto(page.url());
        await replayComplete(page, 60_000);
        const again = toolboxOf(page, 12);
        await expect(again).toBeVisible();
        await expect(again.getByRole('searchbox', { name: 'Find a tool' })).toHaveValue('habitat');
        expect(await namesOf(rowsOf(again))).toEqual([HABITAT, HABITAT]);
      });
    }
  });

  test('f10 q4: a row opens its trace, and closing it returns focus to the row', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of [{ size: WIDTHS[0], look: 'light' as Look }, { size: WIDTHS[1], look: 'dark' as Look }]) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const address = page.url();
        const toolbox = await openToolbox(page, 12);
        const row = rowKey(rowOf(toolbox, OXYGEN));
        const trace = traceOf(page, OXYGEN);

        // The trace opens over the toolbox; Close leaves the toolbox open with focus on the row.
        await row.click();
        await expect(trace).toBeVisible();
        await expect(trace.getByText('Passed. The judge approved it.', { exact: true })).toBeVisible();
        await picture(page, `${size.width}-${look}-f10-row-trace`);
        await closeTrace(trace);
        await expect(toolbox).toBeVisible();
        await expect(row).toBeFocused();
        await expect.poll(() => new URL(page.url()).searchParams.get('tool')).toBeNull();
        expect(new URL(page.url()).searchParams.get('toolbox')).toBe('1');

        // Escape closes the trace alone.
        await row.click();
        await expect(trace).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(trace).toBeHidden();
        await expect(toolbox).toBeVisible();
        await expect(row).toBeFocused();

        // Back, as a phone's Back key sends it, closes the trace alone too.
        await row.click();
        await expect(trace).toBeVisible();
        await page.evaluate(() => window.history.back());
        await expect(trace).toBeHidden();
        await expect(toolbox).toBeVisible();
        await expect(row).toBeFocused();

        // Escape then closes the toolbox: focus returns to the key that opened it, and the address is the run's.
        await page.keyboard.press('Escape');
        await expect(toolbox).toBeHidden();
        await expect(toolboxKey(page)).toBeFocused();
        await expect.poll(() => page.url()).toBe(address);

        // Back closes the toolbox as well, and Close does the same.
        await openToolbox(page, 12);
        await page.evaluate(() => window.history.back());
        await expect(toolbox).toBeHidden();
        await expect(toolboxKey(page)).toBeFocused();
        await openToolbox(page, 12);
        await toolbox.getByRole('button', { name: 'Close the toolbox', exact: true }).click();
        await expect(toolbox).toBeHidden();
        await expect(toolboxKey(page)).toBeFocused();
        await expect.poll(() => page.url()).toBe(address);
      });
    }
  });

  test('f10 q6 and q7: at 320 no row is cut, and the filter stays one row at every sweep width', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const look of LOOKS) {
      // The toolbox opens on a phone, then the window takes each width with it open.
      await openPairSim(page, request, WIDTHS[0], look);
      const toolbox = await openToolbox(page, 12);
      for (const width of SWEEP_WIDTHS) {
        await test.step(`${width} in the ${look} look`, async () => {
          await page.setViewportSize({ width, height: 844 });
          await expect(toolbox.getByRole('searchbox', { name: 'Find a tool' })).toBeVisible();
          const read = await toolbox.evaluate((dialog) => {
            const box = (el: Element) => {
              const r = el.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
            };
            const shown = (el: Element) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
            const menu = dialog.querySelector('[data-toolbox-menu]');
            const field = dialog.querySelector('input[type="search"]');
            return {
              window: window.innerWidth,
              sheet: box(dialog),
              sheetScroll: dialog.scrollWidth - dialog.clientWidth,
              segments: Array.from(dialog.querySelectorAll('[data-show]')).filter(shown).map(box),
              menu: menu && shown(menu) ? box(menu) : null,
              field: field && shown(field) ? box(field) : null,
              words: Array.from(dialog.querySelectorAll('[data-toolbox-stations] > *')).filter(shown).map(box),
              rows: Array.from(dialog.querySelectorAll('[data-tool-row]')).map(box),
              header: Array.from(dialog.querySelectorAll('[data-toolbox-header] button')).filter(shown).map(box),
            };
          });
          // No sideways scroll, and no row cut at an edge: the 120-character name wraps inside its row.
          expect(read.sheet.left).toBeGreaterThanOrEqual(-0.5);
          expect(read.sheet.right).toBeLessThanOrEqual(read.window + 0.5);
          expect(read.sheetScroll, 'the toolbox does not scroll sideways').toBeLessThanOrEqual(0);
          expect(read.rows).toHaveLength(12);
          for (const row of read.rows) {
            expect(row.left, 'a row starts inside the toolbox').toBeGreaterThanOrEqual(read.sheet.left - 0.5);
            expect(row.right, 'a row ends inside the toolbox').toBeLessThanOrEqual(read.sheet.right + 0.5);
          }
          // The five station names stand on one row above the rows.
          expect(read.words).toHaveLength(5);
          expect(new Set(read.words.map(word => Math.round(word.top))).size, 'the station names share one row').toBe(1);
          // The header row's keys share one row.
          expect(new Set(read.header.map(key => Math.round(key.top))).size, 'the header row is one row').toBe(1);

          expect(read.field, 'Find a tool shows').not.toBeNull();
          if (width < 768) {
            // The one-row menu, beside Find a tool, each 44 px tall.
            expect(read.segments).toHaveLength(0);
            expect(read.menu, 'the filter is its menu').not.toBeNull();
            expect(Math.max(read.menu!.top, read.field!.top), 'the menu and Find a tool share a row')
              .toBeLessThan(Math.min(read.menu!.bottom, read.field!.bottom));
            expect(Math.round(read.menu!.height)).toBeGreaterThanOrEqual(44);
            expect(Math.round(read.field!.height)).toBeGreaterThanOrEqual(44);
            expect(read.menu!.right).toBeLessThanOrEqual(read.field!.left + 0.5);
            await expect(toolbox.locator('[data-toolbox-menu]')).toContainText('Show:');
            expect(await toolbox.getByRole('combobox', { name: 'Show' }).evaluate(el => (el as HTMLSelectElement).selectedOptions[0]?.textContent)).toBe('All 12');
          } else {
            // The segments, on one row, each 44 px tall below 900 px.
            expect(read.menu).toBeNull();
            expect(read.segments).toHaveLength(3);
            expect(new Set(read.segments.map(segment => Math.round(segment.top))).size, 'the segments share one row').toBe(1);
            for (const segment of read.segments) expect(Math.round(segment.height)).toBeGreaterThanOrEqual(44);
          }
          if (width === 320) await picture(page, `320-${look}-f10-toolbox`);
        });
      }
    }
  });

  test('f10 q8: Export JSON downloads the rows shown', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of [{ size: WIDTHS[1], look: 'dark' as Look }, { size: WIDTHS[0], look: 'light' as Look }]) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const toolbox = await openToolbox(page, 12);
        const exportKey = toolbox.getByRole('button', { name: 'Export JSON', exact: true });
        const exported = async (): Promise<Array<Record<string, unknown>>> => {
          const [download] = await Promise.all([page.waitForEvent('download'), exportKey.click()]);
          expect(download.suggestedFilename()).toBe('paracosm-toolbox.json');
          return JSON.parse(readFileSync(await download.path(), 'utf8'));
        };

        // Every row, each with the fields the file has always held and the actor that holds the tool.
        const all = await exported();
        expect(all.map(row => row.name)).toEqual(await namesOf(rowsOf(toolbox)));
        expect(all).toHaveLength(12);
        expect(all[0]).toMatchObject({
          n: 1, name: LANDING, description: LANDING_TEXT, firstForgedTurn: 1, firstForgedDepartment: 'engineering',
          departments: ['engineering'], approved: true, confidence: 0.98, actor: 'A1', actorName: 'Aria Chen',
        });
        for (const field of ['mode', 'reuseCount', 'sampleOutput', 'inputFields', 'outputFields']) expect(all[0]).toHaveProperty(field);
        const radiation = all.find(row => row.name === RADIATION);
        expect(radiation).toMatchObject({ approved: false, actor: 'A2', actorName: 'Dietrich Voss' });
        expect(radiation).toHaveProperty('inputSchema');
        expect(radiation).toHaveProperty('outputSchema');
        // The name both actors forged is two rows, told apart by their actor.
        expect(all.filter(row => row.name === HABITAT).map(row => row.actor)).toEqual(['A1', 'A2']);

        // With Did not pass chosen, the file holds its three rows.
        await chooseShow(toolbox, size.width, 'Did not pass 3');
        await expect(rowsOf(toolbox)).toHaveCount(3);
        const some = await exported();
        expect(some.map(row => [row.name, row.actor, row.actorName])).toEqual([
          [SHELTER, 'A1', 'Aria Chen'], [RADIATION, 'A2', 'Dietrich Voss'], [MORALE, 'A2', 'Dietrich Voss'],
        ]);
      });
    }
  });

  test('f10 q11 and q23: a row\'s words, sizes and parts', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const toolbox = await openToolbox(page, 12);
        const ink = await resolved(page, '--text-1');
        const quiet = await resolved(page, '--forge-quiet');

        // A passed tool's row: its number and name, its outcome, what it does and its meta line.
        const landing = rowOf(toolbox, LANDING);
        await expect(landing.locator('[data-row-name]')).toHaveText(`[1] ${LANDING}`);
        expect(await sizeOf(landing.locator('[data-row-name]'))).toBe('18px');
        const does = landing.locator('[data-row-does]');
        await expect(does).toHaveText(LANDING_TEXT);
        expect(await sizeOf(does)).toBe('18px');
        expect(await colourOf(does)).toBe(ink);
        const meta = landing.locator('[data-row-meta]');
        await expect(meta).toHaveText('A1 Aria Chen · engineering · turn 1 · used 1 time');
        expect(await sizeOf(meta)).toBe('15px');
        expect(await colourOf(meta)).toBe(quiet);
        // The actor's label and name lead the meta line in the ink.
        await expect(meta.locator('[data-row-actor]')).toHaveText('A1 Aria Chen');
        expect(await colourOf(meta.locator('[data-row-actor]'))).toBe(ink);
        // The outcome word in the ink beside its one glyph.
        const outcome = landing.locator('[data-row-outcome]');
        await expect(outcome).toHaveText('Passed');
        await expect(outcome.locator('svg[data-glyph]')).toHaveCount(1);
        await expect(outcome.locator('svg[data-glyph="passed"]')).toBeVisible();
        expect(await colourOf(outcome)).toBe(ink);

        // The other rows' meta lines: uses on a tool that was added, the re-forge on a tool forged again.
        await expect(rowOf(toolbox, GREENHOUSE).locator('[data-row-meta]')).toHaveText('A1 Aria Chen · agriculture · turn 1 · used 0 times');
        await expect(rowOf(toolbox, RATION).locator('[data-row-meta]')).toHaveText('A1 Aria Chen · agriculture · turn 1 · used 0 times · 1 re-forge');
        await expect(rowOf(toolbox, OXYGEN).locator('[data-row-meta]')).toHaveText('A2 Dietrich Voss · engineering · turn 1 · used 1 time');
        const radiation = rowOf(toolbox, RADIATION);
        await expect(radiation.locator('[data-row-meta]')).toHaveText('A2 Dietrich Voss · medical · turn 1');
        await expect(radiation.locator('[data-row-outcome]')).toHaveText('Did not pass');
        await expect(radiation.locator('[data-row-outcome] svg[data-glyph="didNotPass"]')).toBeVisible();
        expect(await colourOf(radiation.locator('[data-row-outcome]'))).toBe(ink);
        // A name another actor forged too says which.
        await expect(rowOf(toolbox, HABITAT, 'A1').locator('[data-row-same]')).toHaveText('Same name: A2');
        await expect(rowOf(toolbox, HABITAT, 'A2').locator('[data-row-same]')).toHaveText('Same name: A1');
        await expect(landing.locator('[data-row-same]')).toHaveCount(0);

        // No stage word, chip or arrow on a row: the station names stand above the rows alone.
        for (const word of ['Request', 'Code', 'Tests', 'Judge', 'Added']) {
          await expect(rowsOf(toolbox).getByText(word, { exact: true })).toHaveCount(0);
        }
        // Rows part by one hairline: no outline and no box round a row or its key.
        const edges = await rowOf(toolbox, GREENHOUSE).evaluate((row) => {
          const item = getComputedStyle(row);
          const key = getComputedStyle(row.querySelector('button')!);
          return {
            row: [item.borderTopWidth, item.borderRightWidth, item.borderBottomWidth, item.borderLeftWidth],
            key: [key.borderTopWidth, key.borderRightWidth, key.borderBottomWidth, key.borderLeftWidth],
            outline: key.outlineStyle,
          };
        });
        expect(edges).toEqual({ row: ['1px', '0px', '0px', '0px'], key: ['0px', '0px', '0px', '0px'], outline: 'none' });

        // The count line in the ink with no coloured word.
        const count = toolbox.locator('[data-toolbox-count]');
        expect(await colourOf(count)).toBe(ink);
        expect(await sizeOf(count)).toBe('15px');
        await expect(count.locator('*')).toHaveCount(0);
        // "Find a tool" is a label that shows, and "Tool name…" its field's placeholder.
        await expect(toolbox.getByText('Find a tool', { exact: true })).toBeVisible();
        await expect(toolbox.getByRole('searchbox', { name: 'Find a tool' })).toHaveAttribute('placeholder', 'Tool name…');
        // The title is the one run of capitals, in the ink.
        expect(await colourOf(toolbox.getByRole('heading', { level: 2, name: 'FORGED TOOLBOX' }))).toBe(ink);
      });
    }
  });

  test('f10 q18 at the pair: each row\'s meta line names its actor, and the side mark and line take its colour', async ({ page, request }) => {
    test.setTimeout(180_000);
    const registry = registryOf(pairRunFrames());
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const toolbox = await openToolbox(page, 12);
        const colours = [await resolved(page, '--vis'), await resolved(page, '--eng')];
        expect(colours[0]).not.toBe(colours[1]);
        // One row for each actor's tool, in the run's order.
        expect(await namesOf(rowsOf(toolbox))).toEqual(registry.list.map(entry => entry.name));
        for (const entry of registry.list) {
          const actor = `A${entry.actorIndex + 1}`;
          const row = rowOf(toolbox, entry.name, actor);
          // The meta line begins with the actor's label and name.
          await expect(row.locator('[data-row-meta]')).toHaveText(new RegExp(`^${actor} ${entry.actorName} · `));
          // The 4 px side mark and the row's line are in one colour, the actor's: amber for A1, teal for A2.
          const mark = row.locator('[data-side-mark]');
          expect(await groundOf(mark), `${entry.name}: the side mark`).toBe(colours[entry.actorIndex]);
          expect((await mark.boundingBox())?.width, `${entry.name}: the side mark is 4 px wide`).toBe(4);
          expect(await groundOf(row.locator('[data-forge-line="row"] [data-station="request"] [data-cell]')), `${entry.name}: the line`)
            .toBe(colours[entry.actorIndex]);
          // A screen reader hears the tool, its outcome and its actor by label and name, and no colour word.
          await expect(rowKey(row)).toHaveAccessibleName(rowNameOf(entry));
        }
      });
    }
  });

  test('f10 q19 and q20: the stage words stand once above the rows, and each row\'s line is its trace\'s, cell for cell', async ({ page, request }) => {
    test.setTimeout(240_000);
    const registry = registryOf(pairRunFrames());
    for (const { size, look } of [{ size: WIDTHS[1], look: 'dark' as Look }, { size: WIDTHS[0], look: 'light' as Look }]) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const toolbox = await openToolbox(page, 12);
        // The five station names, once, in the quiet tone at 15 px.
        const words = toolbox.locator('[data-toolbox-stations] > *');
        await expect(words).toHaveText(['Request', 'Code', 'Tests', 'Judge', 'Added']);
        const quiet = await resolved(page, '--forge-quiet');
        for (const word of await words.all()) {
          expect(await colourOf(word)).toBe(quiet);
          expect(await sizeOf(word)).toBe('15px');
        }
        await expect(toolbox.locator('[data-toolbox-stations]')).toHaveCount(1);
        // Each name stands over its station's cell on the first row.
        const centre = (box: { x: number; width: number } | null) => (box ? box.x + box.width / 2 : Number.NaN);
        const cells = rowsOf(toolbox).first().locator('[data-forge-line="row"] [data-station]');
        for (let i = 0; i < 5; i++) {
          const over = Math.abs(centre(await words.nth(i).boundingBox()) - centre(await cells.nth(i).boundingBox()));
          expect(over, `"${STATIONS[i]}" stands over its cell`).toBeLessThanOrEqual(3);
        }

        // Every row's line is its trace's: the same state at each station, in the same colour.
        for (const entry of registry.list) {
          const row = rowOf(toolbox, entry.name, `A${entry.actorIndex + 1}`);
          const onRow = await rowLine(row);
          const rowColour = await groundOf(row.locator('[data-forge-line="row"] [data-station="request"] [data-cell]'));
          await rowKey(row).click();
          const trace = traceOf(page, entry.name, entry.n);
          await expect(trace).toBeVisible();
          expect(await traceLine(trace), `${entry.name}: the row's line is the trace's`).toEqual(onRow);
          expect(await groundOf(reachedCell(trace, 'request')), `${entry.name}: one colour`).toBe(rowColour);
          await closeTrace(trace);
          await expect(rowKey(row)).toBeFocused();
        }
      });
    }
  });

  test('f10 q22: the re-forged tool\'s row opens its latest attempt', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of [{ size: WIDTHS[0], look: 'dark' as Look }, { size: WIDTHS[1], look: 'light' as Look }]) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const toolbox = await openToolbox(page, 12);
        const row = rowOf(toolbox, RATION);
        // The row shows its latest forge's outcome, and its first attempt as a fork under Request.
        await expect(row.locator('[data-row-outcome]')).toHaveText('Passed');
        expect(await rowLine(row)).toEqual(FIVE_REACHED);
        await expect(row.locator('[data-forge-line="row"] [data-station="request"] [data-spurs]')).toHaveAttribute('data-spurs', '1');
        await expect(rowKey(row)).toHaveAccessibleName(`${RATION}, Passed, made by A1 Aria Chen, forged 2 times`);
        await picture(page, `${size.width}-${look}-f10-reforged-row`);

        await rowKey(row).click();
        const trace = traceOf(page, RATION);
        await expect(trace).toBeVisible();
        await expect(attemptKeys(trace).line).toHaveText('2 of 2');
        await expect(trace.getByText('Passed. The judge approved it.', { exact: true })).toBeVisible();
        await expect(stationOf(trace, 'request').getByRole('link', { name: 'Attempt 1 · Did not pass', exact: true })).toBeVisible();
      });
    }
  });

  test('a report-only run lists its tools from their reports, with no attempt keys', async ({ page, request }) => {
    test.setTimeout(180_000);
    const registry = registryOf(generateCohortRun(REPORT_ONLY_PAIR));
    expect(registry.list).toHaveLength(2);
    expect(registry.list.every(entry => entry.attempts.length === 0 && entry.outcome === 'passed')).toBe(true);
    for (const { size, look } of [{ size: WIDTHS[0], look: 'light' as Look }, { size: WIDTHS[1], look: 'dark' as Look }]) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openCohortSim(page, request, RUNS.reportOnlyPair, size, look, 60_000);
        const toolbox = await openToolbox(page, 2);
        expect(await namesOf(rowsOf(toolbox))).toEqual(registry.list.map(entry => entry.name));
        // The filter offers the outcomes the run's rows hold.
        if (size.width >= 768) {
          await expect(toolbox.getByRole('radiogroup', { name: 'Show' }).locator('[data-show]')).toHaveText(['All 2', 'Passed 2']);
        } else {
          expect(await toolbox.getByRole('combobox', { name: 'Show' }).locator('option').allTextContents()).toEqual(['All 2', 'Passed 2']);
        }
        for (const entry of registry.list) {
          // Each row draws its line from its report: passed, five reached cells, no fork.
          const row = rowOf(toolbox, entry.name, `A${entry.actorIndex + 1}`);
          await expect(row.locator('[data-row-outcome]')).toHaveText('Passed');
          expect(await rowLine(row)).toEqual(FIVE_REACHED);
          await expect(row.locator('[data-spurs]')).toHaveCount(0);
          await expect(rowKey(row)).toHaveAccessibleName(rowNameOf(entry));
          // Its trace opens with no attempt keys.
          await rowKey(row).click();
          const trace = traceOf(page, entry.name, entry.n);
          await expect(trace).toBeVisible();
          await expect(trace.getByText('Passed. The judge approved it.', { exact: true })).toBeVisible();
          expect(await traceLine(trace)).toEqual(FIVE_REACHED);
          const keys = attemptKeys(trace);
          await expect(keys.previous).toHaveCount(0);
          await expect(keys.next).toHaveCount(0);
          await expect(keys.line).toHaveCount(0);
          await closeTrace(trace);
        }
        await picture(page, `${size.width}-${look}-f10-report-only`);
      });
    }
  });

  test('the toolbox of the 24-actor and the 300-actor runs counts the whole run and names its actors', async ({ page, request }) => {
    test.setTimeout(300_000);
    const runs = [
      { run: RUNS.dozens, spec: DOZENS, timeout: 60_000, line: '286 tools from 331 forges (45 re-forges) · 268 passed · 63 did not pass · 24 actors' },
      { run: RUNS.maximum, spec: MAXIMUM, timeout: 150_000, line: '3,612 tools from 4,207 forges (595 re-forges) · 3,301 passed · 906 did not pass · 300 actors' },
    ];
    for (const { run, spec, timeout, line } of runs) {
      await test.step(run, async () => {
        const registry = registryOf(generateCohortRun(spec));
        await openCohortSim(page, request, run, WIDTHS[1], 'dark', timeout);
        // A list of this size takes the page a moment to draw, so each check waits longer.
        await toolboxKey(page).click();
        const toolbox = toolboxOf(page, spec.tools);
        await expect(toolbox).toBeVisible({ timeout: 60_000 });
        await expect(toolbox.locator('[data-toolbox-count]')).toHaveText(line, { timeout: 60_000 });
        // One flat list of every actor's rows in the run's order, each meta line led by its actor's label and name.
        await expect(rowsOf(toolbox)).toHaveCount(spec.tools, { timeout: 60_000 });
        const rows = await rowsOf(toolbox).evaluateAll(els => els.map(el => ({
          name: el.getAttribute('data-tool-name'),
          actor: el.getAttribute('data-actor'),
          meta: el.querySelector('[data-row-meta]')?.textContent ?? '',
        })));
        expect(rows.map(row => [row.name, row.actor])).toEqual(registry.list.map(entry => [entry.name, `A${entry.actorIndex + 1}`]));
        const strays = rows.filter((row, i) => !row.meta.startsWith(`A${registry.list[i].actorIndex + 1} ${registry.list[i].actorName} · `));
        expect(strays, 'every meta line begins with its actor\'s label and name').toEqual([]);
        // From three actors the rows' lines take the quiet tone, and each side mark its actor's run colour.
        const third = rowsOf(toolbox).filter({ has: page.locator('[data-row-meta]', { hasText: /^A3 / }) }).first();
        expect(await groundOf(third.locator('[data-forge-line="row"] [data-station="request"] [data-cell]'))).toBe(await resolved(page, '--forge-quiet'));
        expect(await groundOf(third.locator('[data-side-mark]'))).toBe(await resolved(page, '--rust'));
      });
    }
  });

  test('Reports shows the same rows in its page', async ({ page, request }) => {
    test.setTimeout(180_000);
    const id = await pairSessionId(request);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await page.setViewportSize(size);
        await useLook(page, look);
        await page.goto(replayUrl(PAIR_SERVER, id, 'reports'));
        await lookShown(page, look);
        const section = page.locator('#toolbox');
        const fold = section.locator('summary').first();
        await expect(fold).toHaveText('FORGED TOOLBOX');
        await expect(rowsOf(section)).toHaveCount(12, { timeout: 60_000 });
        if (!(await rowsOf(section).first().isVisible())) await fold.click();
        await expect(rowsOf(section).first()).toBeVisible();
        // The same count line, filter and rows as the dialog's, in the page.
        await expect(section.locator('[data-toolbox-count]')).toHaveText(PAIR_COUNT_LINE);
        expect(await rowLine(rowOf(section, RADIATION))).toEqual(REQUEST_ALONE);
        await expect(rowOf(section, LANDING).locator('[data-row-meta]')).toHaveText('A1 Aria Chen · engineering · turn 1 · used 1 time');
        await expect(section.locator('[data-toolbox-stations] > *')).toHaveText(['Request', 'Code', 'Tests', 'Judge', 'Added']);
        await chooseShow(section, size.width, 'Did not pass 3');
        expect(await namesOf(rowsOf(section))).toEqual([SHELTER, RADIATION, MORALE]);
        await chooseShow(section, size.width, 'All 12');
        await expect(rowsOf(section)).toHaveCount(12);
        await picture(page, `${size.width}-${look}-f10-reports-toolbox`);

        // A row opens its tool's trace over the page, and closing it returns focus to the row.
        const row = rowKey(rowOf(section, LANDING));
        await row.click();
        const trace = traceOf(page, LANDING, 1);
        await expect(trace).toBeVisible();
        await closeTrace(trace);
        await expect(row).toBeFocused();
        // No toolbox dialog opens on Reports: its rows are in the page.
        await expect(toolboxOf(page)).toHaveCount(0);
      });
    }
  });

  test('the WHY IT PASSED fold, its fixed sentences and the log key are gone', async ({ page, request }) => {
    test.setTimeout(180_000);
    const gone = ['WHY IT PASSED', 'WHY IT FAILED', '+0.04 outcome bonus', 'Cost of a failed forge', 'USE HISTORY', 'LATEST OUTPUT'];
    const expectGone = async () => {
      for (const words of gone) await expect(page.getByText(words)).toHaveCount(0);
      await expect(page.getByRole('button', { name: /in simulation log$/ })).toHaveCount(0);
    };
    const id = await pairSessionId(request);
    for (const { size, look } of [{ size: WIDTHS[0], look: 'dark' as Look }, { size: WIDTHS[1], look: 'light' as Look }]) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        // The Sim footer's toolbox.
        await openPairSim(page, request, size, look);
        const toolbox = await openToolbox(page, 12);
        await expect(rowsOf(toolbox)).toHaveCount(12);
        await expectGone();
        // Reports' toolbox, with its fold open.
        await page.goto(replayUrl(PAIR_SERVER, id, 'reports'));
        const section = page.locator('#toolbox');
        await expect(rowsOf(section)).toHaveCount(12, { timeout: 60_000 });
        if (!(await rowsOf(section).first().isVisible())) await section.locator('summary').first().click();
        await expect(rowsOf(section).first()).toBeVisible();
        await expectGone();
      });
    }
  });

  test('f10 q16 on the record: a link that sets Did not pass on a run where every tool passed shows the empty filter with All', async ({ page, request }) => {
    test.setTimeout(180_000);
    const id = await sessionIdByName(request, COHORT_SERVER, RUNS.reportOnlyPair);
    for (const { size, look } of [{ size: WIDTHS[0], look: 'dark' as Look }, { size: WIDTHS[1], look: 'light' as Look }]) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await page.setViewportSize(size);
        await useLook(page, look);
        await page.goto(withParams(replayUrl(COHORT_SERVER, id, 'sim'), { toolbox: '1', show: 'did_not_pass' }));
        await lookShown(page, look);
        await replayComplete(page, 60_000);
        // The link opens the toolbox on the filter it names, which holds no row in this run.
        const toolbox = toolboxOf(page, 2);
        await expect(toolbox).toBeVisible();
        await expect(rowsOf(toolbox)).toHaveCount(0);
        await expect(toolbox.getByText('Every tool in this run passed.', { exact: true })).toBeVisible();
        await picture(page, `${size.width}-${look}-f10-every-tool-passed`);
        // All is the way forward.
        await toolbox.getByRole('button', { name: 'All', exact: true }).click();
        await expect(rowsOf(toolbox)).toHaveCount(2);
        await expect.poll(() => new URL(page.url()).searchParams.get('show')).toBeNull();
        expect(new URL(page.url()).searchParams.get('toolbox')).toBe('1');
        // Close leaves the run on the page with no toolbox in its address.
        await toolbox.getByRole('button', { name: 'Close the toolbox', exact: true }).click();
        await expect(toolbox).toBeHidden();
        await expect.poll(() => new URL(page.url()).searchParams.get('toolbox')).toBeNull();
        expect(new URL(page.url()).searchParams.get('replay')).toBe(id);
      });
    }
  });
});
