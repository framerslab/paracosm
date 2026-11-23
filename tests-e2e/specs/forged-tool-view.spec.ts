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
 * - The toolbox at 24 and 300 actors: Group folds the rows by actor (the
 *   default past two actors, its folds closed past 8) or by department, or
 *   lists them as one (the pair's default); an actor's fold head holds its
 *   tile, name and archetype, count line and forge strip, and names a full
 *   registry; Open all groups opens every fold; an actor whose reports
 *   cannot be read says so with the Event Log as the way forward; Export
 *   JSON says it is exporting a large file.
 * - Past 50 lines the toolbox renders only the lines in view: scrolling
 *   renders the fold heads as they come into view, Tab moves through every
 *   head in order, a screen reader counts every group and every row's place
 *   in the whole list, and a fold closed with focus inside gives focus to its
 *   head. The tests that read every row scroll the list through to read it.
 * - One actor picker for the toolbox: the Actors key opens "Choose actors",
 *   each actor with its tile, counts and forge strip; it finds actors by
 *   name, archetype or slot label, sorts them, and renders its rows as they
 *   scroll at 300 actors. A choice narrows the toolbox at once, its count
 *   line, its folds and Export JSON, and is kept in the page's link.
 * - The Viz tab opens the forge view over the living grid: a forge mark of
 *   its event strip opens that forge's attempt of the tool, and in FORGE
 *   mode a key opens the toolbox, each with the grid dimmed and in view at
 *   the dialog's sides; every actor's grid stays drawn with a dialog open
 *   and after it closes, at 2, 24 and 300 actors.
 * - Readability and one row: every word of the trace, the toolbox and the
 *   actor picker meets its contrast and size and every glyph and edge reads
 *   4.5:1 at 320 to 1440 in both looks, each control is 44 px tall on a
 *   phone and each key 32 px with 8 px between from 900 px, the pair's
 *   toolbox opens on its counted first screen, every header row and row of
 *   keys stays one row at the sweep widths with nothing scrolling sideways,
 *   and WCAG 1.4.12's text spacing cuts and overlaps nothing.
 * - Component captures: the toolbox, a tool's trace in each of its states, a
 *   station's key in each of its states, and the toolbox and the actor picker
 *   at 24 and 300 actors, each at a phone and a desktop in both looks. They
 *   are pictures for a reader to judge, saved into after/ with the place of
 *   every line of words each one shows; they assert nothing.
 *
 * Each picture is saved into test-pictures/forged-tool-view/, which CI uploads.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  COHORT_SERVER, LINE_PARTS, LOOKS, PAIR_SERVER, PICTURES, RUNS, SWEEP_WIDTHS, WIDTHS,
  pairSessionId, readAllLines, readLinesFrom, replayUrl, revealLine, scrollListBy, sessionIdByName, useLook,
  type Look, type ToolboxLine,
} from '../support/forge-view-pages.js';
import { DOZENS, DOZENS_A7_UNREADABLE, MAXIMUM, REPORT_ONLY_PAIR, generateCohortRun } from '../support/forge-fixtures.js';
import { LONG_NAME, pairRunFrames } from '../support/pair-run.js';
import { framesToSimEvents } from '../support/run-frames.js';
import {
  FIGURES, TEXT_SPACING, failures, firstScreen, keyRows, measureGlyphs, measureTargets, measureText, saidOf, settle, spacingFaults, targetFailures,
  wordBoxes,
} from '../support/readability.js';
import { buildToolRegistry } from '../../src/dashboard/src/hooks/toolRegistry.helpers.js';
import { computeGameState, getActorColorVar } from '../../src/dashboard/src/hooks/useGameState.js';
import { usesOf } from '../../src/dashboard/src/components/forge/forgeLine.js';

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

  test('after Back closes the toolbox or a trace, Forward opens it again', async ({ page, request }) => {
    test.setTimeout(120_000);
    await openPairSim(page, request, WIDTHS[1], 'dark');
    const toolbox = await openToolbox(page, 12);
    await page.goBack();
    await expect(toolbox).toBeHidden();
    await page.goForward();
    await expect(toolbox, 'Forward opens the toolbox again').toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('toolbox')).toBe('1');
    await toolbox.getByRole('button', { name: 'Close the toolbox', exact: true }).click();
    await expect(toolbox).toBeHidden();

    await pressInspect(inspectKey(page, LANDING));
    const trace = traceOf(page, LANDING);
    await expect(trace).toBeVisible();
    await page.goBack();
    await expect(trace).toBeHidden();
    await page.goForward();
    await expect(trace, 'Forward opens the trace again').toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.has('tool')).toBe(true);
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

  test('a re-forge that passes while the trace is open opens the station that decided it', async ({ page, request }) => {
    test.setTimeout(120_000);
    const id = await pairSessionId(request);
    const replay = await holdReplayAtTurn2(page, id);
    await page.setViewportSize(WIDTHS[1]);
    await useLook(page, 'dark');
    await page.goto(replayUrl(PAIR_SERVER, id, 'sim'));
    await lookShown(page, 'dark');
    // Turn 1 holds the first forge of water_ration_index, which did not pass: Request decided it.
    await pressInspect(inspectKey(page, RATION).first());
    const trace = traceOf(page, RATION);
    await expect(trace.getByText('Did not pass. The run\'s record does not say where the forge stopped.', { exact: true })).toBeVisible();
    await expect(stationKey(trace, 'request')).toHaveAttribute('aria-expanded', 'true');

    // The run goes on with the trace open: the second forge passes, and the trace follows it.
    replay.release();
    await expect(trace.getByRole('group', { name: 'Attempt 2 of 2', exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(trace.getByText('Passed. The judge approved it.', { exact: true })).toBeVisible();
    await expect(stationKey(trace, 'judge'), 'Judge, which decided the pass, opens').toHaveAttribute('aria-expanded', 'true');
    await expect(stationKey(trace, 'request'), 'Request, open before, stays open').toHaveAttribute('aria-expanded', 'true');
  });

  test('Raw JSON gives way to the fields on an attempt the first report\'s schema does not declare', async ({ page, request }) => {
    test.setTimeout(120_000);
    const id = await pairSessionId(request);
    await rationReforgedWithOtherFields(page, id);
    await page.setViewportSize(WIDTHS[1]);
    await useLook(page, 'dark');
    await page.goto(replayUrl(PAIR_SERVER, id, 'sim'));
    await lookShown(page, 'dark');
    await replayComplete(page, 60_000);
    await pressInspect(inspectKey(page, RATION).first());
    const trace = traceOf(page, RATION);
    const keys = attemptKeys(trace);
    // Attempt 1: its report's schema declares its two fields, so Raw JSON is one switch away.
    await keys.previous.click();
    await expect(keys.line).toHaveText('Attempt 1 of 2');
    const request1 = await openStation(trace, 'request');
    await request1.getByRole('switch', { name: 'Raw JSON', exact: true }).click();
    await expect(request1.locator('[data-raw-json]')).toContainText('radiation_msv_per_day');
    // Attempt 2 declares two other fields: Request shows them, and no schema stands for them.
    await keys.next.click();
    await expect(keys.line).toHaveText('2 of 2');
    await expect(request1.locator('[data-raw-json]')).toHaveCount(0);
    await expect(request1.getByText('crew_count', { exact: true })).toBeVisible();
    await expect(request1.getByText('days_left', { exact: true })).toBeVisible();
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
          // Read once the sheet has slid in: mid-slide a 44 px key reads 43.99999237.
          await settle(trace);
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
          expect(Math.round(prev.height * 100) / 100).toBeGreaterThanOrEqual(44);
          expect(Math.round(next.height * 100) / 100).toBeGreaterThanOrEqual(44);
          expect(await trace.evaluate(dialog => dialog.scrollWidth - dialog.clientWidth)).toBeLessThanOrEqual(0);
          await picture(page, `320-${look}-f13-attempt-row-${shown === '2 of 2' ? 'latest' : 'earlier'}`);
        }
      });
    }
  });

  test('a link to an earlier attempt that leaves no row for the attempt left keeps focus in the trace', async ({ page, request }) => {
    test.setTimeout(240_000);
    // A tool of the 24-actor run forged three times or more: at its latest
    // attempt the line holds a spur for each earlier one, and attempt 1's view
    // holds a row to attempt 2 alone.
    const entry = registryOf(generateCohortRun(DOZENS)).list.find(e => e.attempts.length >= 3);
    if (!entry) throw new Error('the 24-actor run holds no tool forged three times');
    const total = entry.attempts.length;
    const id = await sessionIdByName(request, COHORT_SERVER, RUNS.dozens);
    await page.setViewportSize(WIDTHS[1]);
    await useLook(page, 'dark');
    await page.goto(withParams(replayUrl(COHORT_SERVER, id, 'sim'), { tool: String(entry.n) }));
    await lookShown(page, 'dark');
    await replayComplete(page, 90_000);
    const trace = traceOf(page, entry.name, entry.n);
    await expect(trace).toBeVisible();
    await expect(trace.getByRole('group', { name: `Attempt ${total} of ${total}`, exact: true })).toBeVisible();

    // From the keyboard, the spur of attempt 1 swaps the trace to attempt 1.
    const spur = trace.getByRole('link', { name: /^Attempt 1 · / });
    await spur.focus();
    await page.keyboard.press('Enter');
    await expect(trace.getByRole('group', { name: `Attempt 1 of ${total}`, exact: true })).toBeVisible();
    await expect(trace.getByRole('link', { name: new RegExp(`^Attempt ${total} · `) })).toHaveCount(0);
    // Focus stays in the trace, and Tab moves on inside it.
    const inTrace = () => trace.evaluate(dialog => dialog.contains(document.activeElement));
    await expect.poll(inTrace, 'focus stays in the trace after the swap').toBe(true);
    await page.keyboard.press('Tab');
    await expect.poll(inTrace, 'Tab keeps focus in the trace').toBe(true);
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

/** A schema of the two fields the pair run's tools declare. */
const TWO_FIELD_SCHEMA = {
  type: 'object',
  properties: {
    radiation_msv_per_day: { type: 'number', description: 'Radiation at the site, in millisieverts a day.' },
    ice_index: { type: 'number', description: 'How much ice lies under the site.' },
  },
  required: ['radiation_msv_per_day', 'ice_index'],
};

/**
 * Serves the pair run's replay with water_ration_index's first report
 * holding a schema of its two fields, and its second forge and report
 * declaring two other fields.
 */
async function rationReforgedWithOtherFields(page: Page, id: string): Promise<void> {
  await page.route(`**/sessions/${id}/replay**`, async (route) => {
    const response = await route.fetch();
    const edit = (chunk: string): string => chunk.replace(/^data: (.*)$/m, (line, json: string) => {
      let f: { type?: string; data?: Record<string, unknown> };
      try {
        f = JSON.parse(json) as typeof f;
      } catch {
        return line;
      }
      const d = f.data;
      if (!d) return line;
      const tools = Array.isArray(d.forgedTools) ? d.forgedTools as Array<Record<string, unknown>> : null;
      if (f.type === 'specialist_done' && d.turn === 1 && tools?.some(t => t.name === RATION)) {
        d.forgedTools = tools.map(t => (t.name === RATION ? { ...t, inputSchema: TWO_FIELD_SCHEMA } : t));
      } else if (f.type === 'forge_attempt' && d.turn === 2 && d.name === RATION) {
        d.inputFields = ['crew_count', 'days_left'];
      } else if (f.type === 'specialist_done' && d.turn === 2 && tools?.some(t => t.name === RATION)) {
        d.forgedTools = tools.map(t => (t.name === RATION ? { ...t, inputFields: ['crew_count', 'days_left'] } : t));
      } else {
        return line;
      }
      return `data: ${JSON.stringify(f)}`;
    });
    await route.fulfill({ response, body: (await response.text()).split(/(?<=\n\n)/).map(edit).join('') });
  });
}

/**
 * Serves the pair run's replay without its second turn and its end, so the
 * page plays in turn 1 and waits for more. `release` serves the whole run
 * on the stream's next connection, which brings the rest as a run that goes
 * on does; the page drops the frames it holds already.
 */
async function holdReplayAtTurn2(page: Page, id: string): Promise<{ release: () => void }> {
  let held = true;
  await page.route(`**/sessions/${id}/replay**`, async (route) => {
    if (!held) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const frames = (await response.text()).split(/(?<=\n\n)/);
    const turnOf = (chunk: string): number | null => {
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (!data) return null;
      try {
        const turn = (JSON.parse(data) as { data?: { turn?: unknown } }).data?.turn;
        return typeof turn === 'number' ? turn : null;
      } catch {
        return null;
      }
    };
    const cut = frames.findIndex(chunk => turnOf(chunk) === 2);
    expect(cut, 'the pair run holds a second turn').toBeGreaterThan(0);
    const body = frames.slice(0, cut).filter(chunk => !/^event: complete$/m.test(chunk)).join('');
    await route.fulfill({ response, body });
  });
  return { release: () => { held = false; } };
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
          // The look alone is set, so the picture shows the look its name says; the stations come from the link.
          await useLook(visitor, look);
          await visitor.goto(link);
          await lookShown(visitor, look);
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

  test('while the replay plays in, the trace offers no link to copy, and offers it once the run is complete', async ({ page, request }) => {
    test.setTimeout(120_000);
    const id = await pairSessionId(request);
    const replay = await holdReplayAtTurn2(page, id);
    await page.setViewportSize(WIDTHS[1]);
    await useLook(page, 'dark');
    await page.goto(replayUrl(PAIR_SERVER, id, 'sim'));
    await lookShown(page, 'dark');
    await pressInspect(inspectKey(page, RATION).first());
    const trace = traceOf(page, RATION);
    await expect(trace).toBeVisible();
    // A tool's number is fixed once the run is complete: a link copied before then could name another tool.
    await expect(copyLinkKey(trace)).toHaveCount(0);
    replay.release();
    await replayComplete(page, 60_000);
    await expect(copyLinkKey(trace)).toBeVisible();
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

/** How many rows the 300-actor test reads at each end of its flat list. */
const STRETCH = 200;

/** From three actors the rows' lines take the quiet tone and each side mark its actor's run colour: read on A3's first row. */
async function expectThirdActorsTones(page: Page, toolbox: Locator): Promise<void> {
  await revealLine(toolbox, '[data-tool-row][data-actor="A3"]');
  const third = toolbox.locator('[data-tool-row][data-actor="A3"]').first();
  expect(await groundOf(third.locator('[data-forge-line="row"] [data-station="request"] [data-cell]'))).toBe(await resolved(page, '--forge-quiet'));
  expect(await groundOf(third.locator('[data-side-mark]'))).toBe(await resolved(page, '--rust'));
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
        const lifecycle = await page.evaluateHandle(() => {
          const state = { attachedAtClick: false, detachedAfterClick: false, revokedAfterClick: false };
          const click = HTMLAnchorElement.prototype.click;
          const revoke = URL.revokeObjectURL;
          const revoked = new Set<string>();
          URL.revokeObjectURL = (url) => {
            revoked.add(url);
            revoke.call(URL, url);
          };
          HTMLAnchorElement.prototype.click = function () {
            if (this.download === 'paracosm-toolbox.json') {
              const link = this;
              const url = link.href;
              state.attachedAtClick = link.isConnected;
              HTMLAnchorElement.prototype.click = click;
              queueMicrotask(() => {
                state.detachedAfterClick = !link.isConnected;
                state.revokedAfterClick = revoked.has(url);
                URL.revokeObjectURL = revoke;
              });
            }
            click.call(this);
          };
          return state;
        });
        const exported = async (): Promise<Array<Record<string, unknown>>> => {
          const [download] = await Promise.all([page.waitForEvent('download'), exportKey.click()]);
          expect(download.suggestedFilename()).toBe('paracosm-toolbox.json');
          return JSON.parse(readFileSync(await download.path(), 'utf8'));
        };

        // Every row, each with the fields the file has always held and the actor that holds the tool.
        const all = await exported();
        expect(await lifecycle.jsonValue(), 'the export link and blob URL must survive the download click').toEqual({
          attachedAtClick: true,
          detachedAfterClick: true,
          revokedAfterClick: false,
        });
        await lifecycle.dispose();
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

  test('the toolbox of the 24-actor run counts the whole run and names its actors', async ({ page, request }) => {
    test.setTimeout(240_000);
    const registry = registryOf(generateCohortRun(DOZENS));
    await openCohortSim(page, request, RUNS.dozens, WIDTHS[1], 'dark', 60_000);
    // A list of this size takes the page a moment to draw, so each check waits longer.
    await toolboxKey(page).click();
    const toolbox = toolboxOf(page, DOZENS.tools);
    await expect(toolbox).toBeVisible({ timeout: 60_000 });
    await expect(toolbox.locator('[data-toolbox-count]')).toHaveText(DOZENS_LINE, { timeout: 60_000 });
    // Past two actors the toolbox opens grouped by actor with its folds closed; Group: None lists every row.
    await expect(groupKey(toolbox)).toHaveAccessibleName('Group: Actor');
    await chooseGroup(toolbox, 'None');
    // One flat list of every actor's rows in the run's order, each meta line led by its actor's label and name.
    // Past 50 lines the list renders the rows in view, so the read scrolls it through, all 286 rows of it.
    const rows = (await readAllLines(toolbox)).filter(line => line.kind === 'row');
    expect(rows.map(row => [row.name, row.actor])).toEqual(registry.list.map(entry => [entry.name, `A${entry.actorIndex + 1}`]));
    const strays = rows.filter((row, i) => !row.meta.startsWith(`A${registry.list[i].actorIndex + 1} ${registry.list[i].actorName} · `));
    expect(strays, 'every meta line begins with its actor\'s label and name').toEqual([]);
    await expectThirdActorsTones(page, toolbox);
  });

  test('the toolbox of the 300-actor run counts the whole run and names its actors', async ({ page, request }) => {
    test.setTimeout(300_000);
    const registry = registryOf(generateCohortRun(MAXIMUM));
    await openCohortSim(page, request, RUNS.maximum, WIDTHS[1], 'dark', 150_000);
    // A list of this size takes the page a moment to draw, so each check waits longer.
    await toolboxKey(page).click();
    const toolbox = toolboxOf(page, MAXIMUM.tools);
    await expect(toolbox).toBeVisible({ timeout: 60_000 });
    await expect(toolbox.locator('[data-toolbox-count]')).toHaveText(MAXIMUM_LINE, { timeout: 60_000 });
    await expect(groupKey(toolbox)).toHaveAccessibleName('Group: Actor');
    await chooseGroup(toolbox, 'None');
    // One flat list of 3,612 lines, every one a row. The list renders the rows in view, so this reads
    // its first rows down from the top and its last back up from the end: each row's place in the whole
    // list, its tool, its actor and its meta line's lead. The 24-actor test above reads a whole list
    // through, and tests/dashboard/toolbox-list-order.test.ts holds the order of all 3,612 lines.
    await expect(toolbox.locator('[data-toolbox-rows]')).toHaveAttribute('data-line-count', '3612');
    const whole = registry.list.map((entry, i) => ({
      pos: i + 1, size: 3612, name: entry.name, actor: `A${entry.actorIndex + 1}`,
      lead: `A${entry.actorIndex + 1} ${entry.actorName} · `,
    }));
    // What the page shows of each row read, its meta line cut to the length of the lead it should begin with.
    const asRead = (lines: ToolboxLine[], rows: typeof whole) => lines.map((line, i) => ({
      pos: line.pos, size: line.size, name: line.name, actor: line.actor,
      lead: line.meta.slice(0, rows[i]?.lead.length ?? 0),
    }));
    const first = whole.slice(0, STRETCH);
    expect(asRead(await readLinesFrom(toolbox, 'top', STRETCH), first), 'the first rows').toEqual(first);
    const last = whole.slice(-STRETCH);
    expect(asRead(await readLinesFrom(toolbox, 'end', STRETCH), last), 'the last rows').toEqual(last);
    await expectThirdActorsTones(page, toolbox);
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

// ── The toolbox at 24 and 300 actors ─────────────────────────────────────

/** The toolbox's Group key: a menu button that names the grouping it shows. */
const groupKey = (scope: Locator): Locator => scope.getByRole('button', { name: /^Group: / });

/** Chooses a grouping in the Group menu, and waits for the key to name it. */
async function chooseGroup(scope: Locator, choice: 'Actor' | 'Department' | 'None'): Promise<void> {
  const key = groupKey(scope);
  await key.click();
  await scope.getByRole('menu', { name: 'Group' }).getByRole('menuitemradio', { name: choice, exact: true }).click();
  await expect(key).toHaveAccessibleName(`Group: ${choice}`);
}

/** The fold heads of a grouped list, in order: each an h3 holding the key that opens its fold. */
const foldHeads = (scope: Locator): Locator => scope.locator('[data-fold-head]');
/** One actor's fold head, by the actor's slot label, or one department's by its name. */
const foldHead = (scope: Locator, name: string): Locator => scope.locator(`[data-fold-head="${name}"]`);
/** A fold: its head and, while it is open, its rows. */
const foldOf = (scope: Locator, name: string): Locator => scope.locator(`[data-fold="${name}"]`);
/** The key that opens or closes every fold. */
const openAllGroups = (scope: Locator): Locator => scope.getByRole('button', { name: /^(Open|Close) all groups$/ });

/** A token's name from the value getActorColorVar gives: "var(--vis)" -> "--vis". */
const tokenOf = (cssVar: string): string => cssVar.replace(/^var\((--[\w-]+)\)$/, '$1');

/** A count with its noun, as the toolbox writes it: "1 tool", "3,612 tools". */
const countedAs = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** A fold head's count line on the run's record: "14 tools from 14 forges · 12 passed · 2 did not pass". */
const foldCountOf = (c: { tools: number; forges: number; passed: number; didNotPass: number }): string => [
  `${countedAs(c.tools, 'tool', 'tools')} from ${countedAs(c.forges, 'forge', 'forges')}`,
  c.passed > 0 ? `${c.passed.toLocaleString('en-US')} passed` : '',
  c.didNotPass > 0 ? `${c.didNotPass.toLocaleString('en-US')} did not pass` : '',
].filter(Boolean).join(' · ');

/** The forges of a set of rows, counted as a fold head counts them. */
function countsOfRows(rows: Array<{ attempts: Array<{ approved: boolean }> }>) {
  const forges = rows.reduce((sum, row) => sum + row.attempts.length, 0);
  const passed = rows.reduce((sum, row) => sum + row.attempts.filter(a => a.approved).length, 0);
  return { tools: rows.length, forges, passed, didNotPass: forges - passed };
}

/** A row's meta line as the toolbox writes it, from the tool's record. */
function metaLineOf(entry: ReturnType<typeof registryOf>['list'][number]): string {
  const reforges = Math.max(0, entry.attempts.length - 1);
  return [
    `A${entry.actorIndex + 1} ${entry.actorName}`,
    entry.firstForgedDepartment,
    `turn ${entry.firstForgedTurn}`,
    entry.outcome === 'passed' ? `used ${countedAs(usesOf(entry), 'time', 'times')}` : '',
    reforges > 0 ? countedAs(reforges, 're-forge', 're-forges') : '',
  ].filter(Boolean).join(' · ');
}

/** Each fold's parts in the order they stand, from the list's lines: a department's line as "dept:{name}", a row as "{name}@{actor}". */
function foldParts(lines: ToolboxLine[]): Record<string, string[]> {
  const parts: Record<string, string[]> = {};
  for (const line of lines) {
    if (line.kind === 'head') parts[line.fold] ??= [];
    else (parts[line.fold] ??= []).push(line.kind === 'dept' ? `dept:${line.name}` : `${line.name}@${line.actor}`);
  }
  return parts;
}

/**
 * The rows in the order Group: Actor lists them: each actor's in launch
 * order, under a line for each department in the order the actor first
 * forged there.
 */
function actorOrder(registry: ReturnType<typeof registryOf>): ReturnType<typeof registryOf>['list'] {
  return registry.actors.flatMap((actor) => {
    const own = registry.list.filter(entry => entry.actorIndex === actor.index);
    const departments = [...new Set(own.map(entry => entry.firstForgedDepartment))];
    return departments.flatMap(d => own.filter(entry => entry.firstForgedDepartment === d));
  });
}

/** Where the focused key stands: its top and bottom, the fixed head's bottom, and the bottom of the toolbox's view. */
const focusedPlace = (toolbox: Locator) => toolbox.evaluate((dialog) => {
  const focused = (document.activeElement as HTMLElement).getBoundingClientRect();
  const head = dialog.querySelector('[data-toolbox-header]')!.getBoundingClientRect();
  const view = dialog.getBoundingClientRect().top + dialog.clientTop + dialog.clientHeight;
  return { top: focused.top, bottom: focused.bottom, headBottom: head.bottom, viewBottom: view };
});

/**
 * Tab from the focused head on through the heads of the actors from one slot
 * to another, in order: each takes focus whole in view below the fixed head.
 */
async function tabThroughHeads(page: Page, toolbox: Locator, from: number, to: number): Promise<void> {
  for (let n = from; n <= to; n += 1) {
    if (n > from) await page.keyboard.press('Tab');
    await expect(foldHead(toolbox, `A${n}`).getByRole('button'), `Tab reaches A${n}`).toBeFocused();
    const at = await focusedPlace(toolbox);
    expect(at.top, `A${n} sits below the fixed head`).toBeGreaterThanOrEqual(at.headBottom - 1);
    expect(at.bottom, `A${n} is whole in view`).toBeLessThanOrEqual(at.viewBottom + 1);
  }
}

/** On the 300-actor run the Tab test walks this many heads from the list's top, and this many to its end. */
const FIRST_HEADS = 40;
const LAST_HEADS = 10;

const DOZENS_LINE = '286 tools from 331 forges (45 re-forges) · 268 passed · 63 did not pass · 24 actors';
const MAXIMUM_LINE = '3,612 tools from 4,207 forges (595 re-forges) · 3,301 passed · 906 did not pass · 300 actors';
/** Past 50 lines the toolbox renders the lines in view and a few past them: never more than about this many. */
const MOST_LINES = 60;

/** Opens a cohort run's toolbox from the Sim footer, played in to its end. */
async function openCohortToolbox(page: Page, request: APIRequestContext, run: string, tools: number, size: Size, look: Look, timeout: number): Promise<Locator> {
  await openCohortSim(page, request, run, size, look, timeout);
  await toolboxKey(page).click();
  const toolbox = toolboxOf(page, tools);
  await expect(toolbox).toBeVisible({ timeout: 60_000 });
  return toolbox;
}

test.describe('the forged toolbox at 24 and 300 actors', () => {
  test('f10 q18: the pair\'s toolbox reads Group: None', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const toolbox = await openToolbox(page, 12);
        // Group is a menu button that reads the pair's grouping, None: one list, no fold.
        const key = groupKey(toolbox);
        await expect(key).toHaveAccessibleName('Group: None');
        await expect(key).toHaveAttribute('aria-haspopup', 'menu');
        await expect(key).toHaveAttribute('aria-expanded', 'false');
        await expect(rowsOf(toolbox)).toHaveCount(12);
        await expect(foldHeads(toolbox)).toHaveCount(0);
        // Open all groups is inactive with Group: None.
        await expect(openAllGroups(toolbox)).toHaveAccessibleName('Open all groups');
        await expect(openAllGroups(toolbox)).toHaveAttribute('aria-disabled', 'true');
        // The menu holds the three groupings with None checked, and Escape closes it on its key.
        await key.click();
        const menu = toolbox.getByRole('menu', { name: 'Group' });
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitemradio')).toHaveText(['Actor', 'Department', 'None']);
        await expect(menu.getByRole('menuitemradio', { name: 'None', exact: true })).toHaveAttribute('aria-checked', 'true');
        await expect(menu.getByRole('menuitemradio', { name: 'None', exact: true })).toBeFocused();
        await picture(page, `${size.width}-${look}-f10-group-menu`);
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(key).toBeFocused();
        await expect(toolbox).toBeVisible();
      });
    }
  });

  test('f10 q24: the 24-actor toolbox groups by actor with every fold closed', async ({ page, request }) => {
    test.setTimeout(180_000);
    const registry = registryOf(generateCohortRun(DOZENS));
    const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, WIDTHS[1], 'dark', 60_000);
    await expect(toolbox.locator('[data-toolbox-count]')).toHaveText(DOZENS_LINE);
    await expect(groupKey(toolbox)).toHaveAccessibleName('Group: Actor');

    // 24 fold heads in the run's order, each with its tile, name and archetype, count line and forge strip, all closed.
    await expect(foldHeads(toolbox)).toHaveCount(24);
    const heads = await foldHeads(toolbox).evaluateAll(els => els.map(el => ({
      level: el.tagName,
      tile: el.querySelector('[data-actor-tile]')?.textContent ?? '',
      name: el.querySelector('[data-fold-name]')?.textContent ?? '',
      count: el.querySelector('[data-fold-count]')?.textContent ?? '',
      strip: Number(el.querySelector('[data-forge-strip]')?.getAttribute('data-forge-strip') ?? -1),
      expanded: el.querySelector('button')?.getAttribute('aria-expanded') ?? null,
    })));
    expect(heads.map(h => h.level)).toEqual(registry.actors.map(() => 'H3'));
    expect(heads.map(h => h.tile)).toEqual(registry.actors.map(a => a.label));
    expect(heads.map(h => h.name)).toEqual(registry.actors.map(a => `${a.name} · ${a.archetype}`));
    expect(heads.map(h => h.count)).toEqual(registry.actors.map(a => foldCountOf(a.counts)));
    expect(heads.map(h => h.strip)).toEqual(registry.actors.map(a => a.strip.length));
    expect(heads.map(h => h.expanded)).toEqual(registry.actors.map(() => 'false'));
    // The heads' tools add up to the run's.
    expect(heads.reduce((sum, h) => sum + Number(h.count.match(/^([\d,]+) tools?/)?.[1].replace(/,/g, '') ?? 0), 0)).toBe(286);
    // A head is named by its actor, archetype and counts in words.
    await expect(foldHead(toolbox, 'A7').getByRole('button')).toHaveAccessibleName('A7 Ines Duarte, The Strategist, 14 tools, 2 did not pass');
    // Every fold closed: no row is drawn.
    await expect(rowsOf(toolbox)).toHaveCount(0);

    // A1's head opens its fold on A1's rows alone, and closes it again.
    const a1 = foldHead(toolbox, 'A1').getByRole('button');
    await a1.click();
    await expect(a1).toHaveAttribute('aria-expanded', 'true');
    const a1Tools = registry.list.filter(entry => entry.actorIndex === 0);
    // Read through the list, which past 50 lines renders the lines in view: A1's rows, and no other actor's.
    const a1Rows = (await readAllLines(toolbox)).filter(line => line.kind === 'row');
    expect(a1Rows).toHaveLength(a1Tools.length);
    expect(a1Rows.filter(row => row.fold !== 'A1' || row.actor !== 'A1')).toEqual([]);
    await picture(page, '1440-dark-f10-toolbox-24-actors-A1-open');
    await a1.click();
    await expect(a1).toHaveAttribute('aria-expanded', 'false');
    await expect(rowsOf(toolbox)).toHaveCount(0);
  });

  test('f10 q25: Open all groups opens each actor\'s rows under its departments, lines in the quiet tone', async ({ page, request }) => {
    test.setTimeout(180_000);
    const registry = registryOf(generateCohortRun(DOZENS));
    const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, WIDTHS[1], 'light', 60_000);
    const key = openAllGroups(toolbox);
    await expect(key).toHaveAccessibleName('Open all groups');
    await expect(key).not.toHaveAttribute('aria-disabled', 'true');
    await key.click();
    await expect(key).toHaveAccessibleName('Close all groups');
    // Past 50 lines the list renders the lines in view, so the read scrolls it through.
    const lines = await readAllLines(toolbox);
    const heads = lines.filter(line => line.kind === 'head');
    expect(heads.map(head => [head.name, head.expanded])).toEqual(registry.actors.map(actor => [actor.label, 'true']));
    expect(lines.filter(line => line.kind === 'row')).toHaveLength(286);

    // Each fold holds its actor's rows alone, under a line for each department, in the order the actor first forged there.
    const expected = Object.fromEntries(registry.actors.map((actor) => {
      const own = registry.list.filter(entry => entry.actorIndex === actor.index);
      const departments = [...new Set(own.map(entry => entry.firstForgedDepartment))];
      return [actor.label, departments.flatMap(d => [
        `dept:${d}`,
        ...own.filter(entry => entry.firstForgedDepartment === d).map(entry => `${entry.name}@${actor.label}`),
      ])];
    }));
    expect(foldParts(lines)).toEqual(expected);

    // The rows' lines are in the quiet tone; each side mark and each head's tile band in its actor's run colour.
    const quiet = await resolved(page, '--forge-quiet');
    for (const label of ['A1', 'A2', 'A3', 'A9']) {
      const index = Number(label.slice(1)) - 1;
      const colour = await resolved(page, tokenOf(getActorColorVar(index)));
      await revealLine(toolbox, `[data-fold-head="${label}"]`);
      const row = rowsOf(foldOf(toolbox, label)).first();
      expect(await groundOf(row.locator('[data-forge-line="row"] [data-station="request"] [data-cell]')), `${label}: the line`).toBe(quiet);
      expect(await groundOf(row.locator('[data-side-mark]')), `${label}: the side mark`).toBe(colour);
      expect(await groundOf(foldHead(toolbox, label).locator('[data-actor-tile] > span').first()), `${label}: the tile's band`).toBe(colour);
    }
    await revealLine(toolbox, '[data-fold-head="A1"]');
    await foldHead(toolbox, 'A1').scrollIntoViewIfNeeded();
    await picture(page, '1440-light-f10-toolbox-24-actors-all-open');

    // Pressed again, every fold closes.
    await key.click();
    await expect(key).toHaveAccessibleName('Open all groups');
    await expect(foldHeads(toolbox).locator('button[aria-expanded="true"]')).toHaveCount(0);
    await expect(rowsOf(toolbox)).toHaveCount(0);
  });

  test('f10 q29: Group: Department folds by department', async ({ page, request }) => {
    test.setTimeout(180_000);
    const registry = registryOf(generateCohortRun(DOZENS));
    const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, { width: 768, height: 1024 }, 'dark', 60_000);
    await chooseGroup(toolbox, 'Department');
    const departments = [...new Set(registry.list.map(entry => entry.firstForgedDepartment))];
    expect(departments).toHaveLength(5);
    // One fold a department, each headed by its name and its count line, closed past 8 actors.
    await expect(foldHeads(toolbox)).toHaveCount(5);
    const heads = await foldHeads(toolbox).evaluateAll(els => els.map(el => ({
      name: el.querySelector('[data-fold-name]')?.textContent ?? '',
      count: el.querySelector('[data-fold-count]')?.textContent ?? '',
      expanded: el.querySelector('button')?.getAttribute('aria-expanded') ?? null,
    })));
    expect(heads.map(h => h.name)).toEqual(departments);
    expect(heads.map(h => h.count)).toEqual(departments.map(d => foldCountOf(countsOfRows(registry.list.filter(entry => entry.firstForgedDepartment === d)))));
    expect(heads.map(h => h.expanded)).toEqual(departments.map(() => 'false'));

    // Opened, each fold holds that department's rows in the run's order, each meta line led by its actor's label and name.
    await openAllGroups(toolbox).click();
    await expect(openAllGroups(toolbox)).toHaveAccessibleName('Close all groups');
    // Past 50 lines the list renders the lines in view, so the read scrolls it through.
    const rows = (await readAllLines(toolbox)).filter(line => line.kind === 'row');
    expect(rows).toHaveLength(286);
    for (const d of departments) {
      const own = registry.list.filter(entry => entry.firstForgedDepartment === d);
      const inFold = rows.filter(row => row.fold === d);
      expect(inFold.map(row => `${row.name}@${row.actor}`), d).toEqual(own.map(entry => `${entry.name}@A${entry.actorIndex + 1}`));
      expect(inFold.map(row => row.meta), d).toEqual(own.map(metaLineOf));
    }
    await revealLine(toolbox, `[data-fold-head="${departments[0]}"]`);
    await foldHead(toolbox, departments[0]).scrollIntoViewIfNeeded();
    await picture(page, '768-dark-f10-toolbox-24-actors-by-department');
  });

  test('f10 q30: Group: None lists every row in run order', async ({ page, request }) => {
    test.setTimeout(180_000);
    const registry = registryOf(generateCohortRun(DOZENS));
    const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, WIDTHS[0], 'light', 60_000);
    await chooseGroup(toolbox, 'None');
    await expect(foldHeads(toolbox)).toHaveCount(0);
    await expect(openAllGroups(toolbox)).toHaveAttribute('aria-disabled', 'true');
    // One list of every row in the run's order, each led by its actor's label and name behind its side mark.
    // Past 50 lines the list renders the rows in view, so the read scrolls it through.
    const rows = (await readAllLines(toolbox)).filter(line => line.kind === 'row');
    expect(rows.map(row => `${row.name}@${row.actor}`)).toEqual(registry.list.map(entry => `${entry.name}@A${entry.actorIndex + 1}`));
    expect(rows.map(row => row.meta)).toEqual(registry.list.map(metaLineOf));
    expect(rows.every(row => row.sideMarks === 1), 'each row has its side mark').toBe(true);
    // The grouping is kept in the page's link.
    await expect.poll(() => new URL(page.url()).searchParams.get('group')).toBe('none');
    await picture(page, '390-light-f10-toolbox-24-actors-none');
  });

  test('f10 q34: an actor whose reports cannot be read says so, and the other folds work', async ({ page, request }) => {
    test.setTimeout(180_000);
    const registry = registryOf(generateCohortRun(DOZENS_A7_UNREADABLE));
    expect(registry.actors[6].unreadable).toBe(true);
    const toolbox = await openCohortToolbox(page, request, RUNS.dozensA7Unreadable, registry.list.length, { width: 1100, height: 900 }, 'light', 60_000);
    await expect(foldHeads(toolbox)).toHaveCount(24);
    // A7's head names it by its tile and name, says its tools could not be read, and opens nothing.
    const a7 = foldHead(toolbox, 'A7');
    await expect(a7.locator('[data-actor-tile]')).toHaveText('A7');
    await expect(a7.locator('[data-fold-name]')).toHaveText('Ines Duarte · The Strategist');
    await expect(a7.locator('[data-fold-error]')).toHaveText('A7\'s tools could not be read.');
    await expect(a7.locator('[aria-expanded]')).toHaveCount(0);
    // The Event Log is the way forward.
    const way = foldOf(toolbox, 'A7').getByRole('button', { name: 'Show in Event Log', exact: true });
    await expect(way).toBeVisible();
    await picture(page, '1100-light-f10-toolbox-A7-unreadable');

    // The other folds work: A8's opens on A8's rows.
    const a8 = foldHead(toolbox, 'A8').getByRole('button');
    await a8.click();
    await expect(a8).toHaveAttribute('aria-expanded', 'true');
    // Read through the list, which past 50 lines renders the lines in view: A8's rows, and no other actor's.
    const a8Rows = (await readAllLines(toolbox)).filter(line => line.kind === 'row');
    expect(a8Rows).toHaveLength(registry.list.filter(entry => entry.actorIndex === 7).length);
    expect(a8Rows.filter(row => row.fold !== 'A8')).toEqual([]);

    // Show in Event Log closes the toolbox and opens the Event Log on A7's events.
    await way.click();
    await expect(toolbox).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.get('logLeader')).toBe('Ines Duarte');
    expect(new URL(page.url()).searchParams.get('tab')).toBe('settings');
    expect(new URL(page.url()).searchParams.get('sub')).toBe('log');
  });

  test('f10 q35: the row of keys stays one row at the sweep widths at 24 actors', async ({ page, request }) => {
    test.setTimeout(240_000);
    for (const look of LOOKS) {
      const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, WIDTHS[0], look, 60_000);
      for (const width of SWEEP_WIDTHS) {
        await test.step(`${width} in the ${look} look`, async () => {
          await page.setViewportSize({ width, height: 844 });
          await expect(groupKey(toolbox)).toBeVisible();
          const read = await toolbox.evaluate((dialog) => {
            const box = (el: Element) => {
              const r = el.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
            };
            const shown = (el: Element) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
            const group = dialog.querySelector('button[aria-haspopup="menu"]');
            const menu = dialog.querySelector('[data-toolbox-menu]');
            const field = dialog.querySelector('input[type="search"]');
            return {
              window: window.innerWidth,
              sheet: box(dialog),
              sheetScroll: dialog.scrollWidth - dialog.clientWidth,
              group: group ? box(group) : null,
              segments: Array.from(dialog.querySelectorAll('[data-show]')).filter(shown).map(box),
              menu: menu && shown(menu) ? box(menu) : null,
              field: field && shown(field) ? box(field) : null,
            };
          });
          expect(read.sheetScroll, 'the toolbox does not scroll sideways').toBeLessThanOrEqual(0);
          expect(read.sheet.right).toBeLessThanOrEqual(read.window + 0.5);
          // Group: one key, 44 px tall on a phone, inside the toolbox, on a row above the filter and the search.
          expect(read.group, 'Group shows').not.toBeNull();
          expect(Math.round(read.group!.height)).toBeGreaterThanOrEqual(44);
          expect(read.group!.right).toBeLessThanOrEqual(read.sheet.right + 0.5);
          expect(read.field, 'Find a tool shows').not.toBeNull();
          expect(read.group!.bottom, 'Group stands above the filter and the search').toBeLessThanOrEqual(read.field!.top + 0.5);
          // The filter and the search: one row, the menu below 768 px, the segments at 768 px.
          const filter = width < 768 ? [read.menu] : read.segments;
          if (width < 768) {
            expect(read.segments).toHaveLength(0);
            expect(read.menu, 'the filter is its menu').not.toBeNull();
          } else {
            expect(read.menu).toBeNull();
            expect(read.segments).toHaveLength(3);
          }
          const parts = [...filter, read.field].filter((part): part is NonNullable<typeof part> => part !== null);
          expect(Math.max(...parts.map(part => part.top)), 'the filter and the search share one row')
            .toBeLessThan(Math.min(...parts.map(part => part.bottom)));
          for (const part of parts) expect(part.right).toBeLessThanOrEqual(read.sheet.right + 0.5);
          if (width === 320) await picture(page, `320-${look}-f10-toolbox-24-actors-keys`);
        });
      }
    }
  });

  test('f10 q36: Export JSON on the 300-actor run says it is exporting, then downloads every actor\'s rows', async ({ page, request }) => {
    test.setTimeout(300_000);
    const toolbox = await openCohortToolbox(page, request, RUNS.maximum, MAXIMUM.tools, WIDTHS[1], 'dark', 150_000);
    // Every word the export's status says, as it says it.
    await toolbox.evaluate((dialog) => {
      const seen: string[] = [];
      (window as unknown as { exportSaid: string[] }).exportSaid = seen;
      const note = () => {
        for (const el of Array.from(dialog.querySelectorAll('[data-export-status]'))) {
          const words = el.textContent ?? '';
          if (words !== '' && !seen.includes(words)) seen.push(words);
        }
      };
      new MutationObserver(note).observe(dialog, { subtree: true, childList: true, characterData: true });
    });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      toolbox.getByRole('button', { name: 'Export JSON', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('paracosm-toolbox.json');
    const rows = JSON.parse(readFileSync(await download.path(), 'utf8')) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3612);
    expect(new Set(rows.map(row => row.actor)).size).toBe(300);
    const said = await page.evaluate(() => (window as unknown as { exportSaid?: string[] }).exportSaid ?? []);
    expect(said).toContain('Exporting 3,612 tools…');
    // Once the file is saved the status says nothing more.
    await expect(toolbox.locator('[data-export-status]').filter({ hasText: /\S/ })).toHaveCount(0);
  });

  test('f10 q38: A299\'s fold head names the registry\'s limit', async ({ page, request }) => {
    test.setTimeout(300_000);
    const toolbox = await openCohortToolbox(page, request, RUNS.maximum, MAXIMUM.tools, { width: 768, height: 1024 }, 'light', 150_000);
    // Past 50 lines the list renders the heads in view, so the read scrolls it through: 300 heads, and A299's alone names the limit.
    const heads = (await readAllLines(toolbox)).filter(line => line.kind === 'head');
    expect(heads).toHaveLength(300);
    expect(heads.filter(head => head.note !== '').map(head => [head.name, head.note]))
      .toEqual([['A299', '50 tools: the most one actor\'s registry holds']]);
    // A299's head, scrolled into view.
    await revealLine(toolbox, '[data-fold-head="A299"]');
    const a299 = foldHead(toolbox, 'A299');
    await a299.scrollIntoViewIfNeeded();
    await expect(a299.locator('[data-fold-count]')).toHaveText(/^50 tools from /);
    await expect(a299.locator('[data-fold-note]')).toHaveText('50 tools: the most one actor\'s registry holds');
    await picture(page, '768-light-f10-toolbox-300-actors-A299');
  });

  test('f10 q31 in this pull request: a name 40 actors forged gives 40 rows, each with its own uses', async ({ page, request }) => {
    test.setTimeout(300_000);
    const registry = registryOf(generateCohortRun(MAXIMUM));
    const holders = registry.list.filter(entry => entry.name === HABITAT);
    expect(holders).toHaveLength(40);
    const toolbox = await openCohortToolbox(page, request, RUNS.maximum, MAXIMUM.tools, WIDTHS[1], 'light', 150_000);
    await toolbox.getByRole('searchbox', { name: 'Find a tool' }).fill(HABITAT);
    // The folds that hold the name, one an actor, and every fold opened shows its row.
    await expect(foldHeads(toolbox)).toHaveCount(40);
    await openAllGroups(toolbox).click();
    await expect(openAllGroups(toolbox)).toHaveAccessibleName('Close all groups');
    // 40 heads, 40 department lines and 40 rows: past 50 lines the list renders the lines in view, so the read scrolls it through.
    const rows = (await readAllLines(toolbox)).filter(line => line.kind === 'row');
    expect(rows).toHaveLength(40);
    expect(rows.map(row => row.actor)).toEqual(holders.map(entry => `A${entry.actorIndex + 1}`));
    // Each row its own actor's tool, with that actor's own uses.
    expect(rows.map(row => row.meta)).toEqual(holders.map(metaLineOf));
    expect(rows.map(row => row.same)).toEqual(holders.map(() => 'Same name in 39 other actors'));
    await picture(page, '1440-light-f10-toolbox-300-actors-same-name');
  });
});

// ── Past 50 lines the toolbox renders only the lines in view ─────────────

test.describe('the toolbox past 50 lines', () => {
  test('f10 q26: scrolling from A1 to A300 renders the heads as they come into view, never more than about 60 lines', async ({ page, request }) => {
    test.setTimeout(300_000);
    const toolbox = await openCohortToolbox(page, request, RUNS.maximum, MAXIMUM.tools, WIDTHS[1], 'dark', 150_000);
    await expect(toolbox.locator('[data-toolbox-count]')).toHaveText(MAXIMUM_LINE);
    // The first screen: the heads from A1, and no more than about 60 lines in the page.
    await expect(foldHead(toolbox, 'A1')).toBeVisible();
    expect(await toolbox.locator(LINE_PARTS).count(), 'lines rendered at the top').toBeLessThanOrEqual(MOST_LINES);
    const seen = new Set<string>(await foldHeads(toolbox).evaluateAll(els => els.map(el => el.getAttribute('data-fold-head') ?? '')));
    // A screen at a time to the end: at each step the lines in view are rendered, with no gap, and never more than about 60.
    let last = '';
    for (let step = 1; step <= 400; step += 1) {
      const now = await scrollListBy(toolbox, 0.8);
      expect(now.covered, `step ${step}: the lines in view are rendered`).toBe(true);
      expect(now.rendered, `step ${step}: lines rendered`).toBeLessThanOrEqual(MOST_LINES);
      for (const head of now.heads) seen.add(head);
      last = now.heads[now.heads.length - 1] ?? last;
      if (!now.moved) break;
    }
    // The scroll reaches A300, and every head rendered on the way.
    expect(last, 'the last head').toBe('A300');
    await expect(foldHead(toolbox, 'A300')).toBeVisible();
    expect(seen.size).toBe(300);
    expect([...Array(300)].map((_, i) => `A${i + 1}`).filter(label => !seen.has(label)), 'heads never rendered').toEqual([]);
    await picture(page, '1440-dark-f10-toolbox-300-actors-end');
  });

  test('f10 q27: Tab moves through all 24 heads in order with no skip, each one whole below the fixed head', async ({ page, request }) => {
    test.setTimeout(240_000);
    for (const look of LOOKS) {
      await test.step(`1440 in the ${look} look`, async () => {
        const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, WIDTHS[1], look, 60_000);
        const first = foldHead(toolbox, 'A1').getByRole('button');
        await first.focus();
        await expect(first).toBeFocused();
        await tabThroughHeads(page, toolbox, 1, 24);
        await picture(page, `1440-${look}-f10-toolbox-24-actors-tab-A24`);
      });
    }
  });

  test('f10 q27 at 300 actors: Tab moves through the first heads and the last in order with no skip, each one whole below the fixed head', async ({ page, request }) => {
    test.setTimeout(420_000);
    for (const look of LOOKS) {
      await test.step(`1440 in the ${look} look`, async () => {
        const toolbox = await openCohortToolbox(page, request, RUNS.maximum, MAXIMUM.tools, WIDTHS[1], look, 150_000);
        const first = foldHead(toolbox, 'A1').getByRole('button');
        await first.focus();
        await expect(first).toBeFocused();
        expect(await toolbox.locator(LINE_PARTS).count(), 'lines rendered with focus on A1').toBeLessThanOrEqual(MOST_LINES);
        // The first heads: Tab goes on past the lines rendered at the top, to heads the list had not rendered.
        await expect(foldHead(toolbox, `A${FIRST_HEADS}`), `A${FIRST_HEADS} is not rendered at the top`).toHaveCount(0);
        await tabThroughHeads(page, toolbox, 1, FIRST_HEADS);
        expect(await toolbox.locator(LINE_PARTS).count(), `lines rendered with focus on A${FIRST_HEADS}`).toBeLessThanOrEqual(MOST_LINES);

        // The last heads: focus leaves the list, the list scrolls to the tenth head from its end, and Tab goes on from it to A300.
        await toolbox.locator('[data-toolbox-title]').focus();
        const from = 300 - LAST_HEADS + 1;
        await revealLine(toolbox, `[data-fold-head="A${from}"]`);
        const late = foldHead(toolbox, `A${from}`).getByRole('button');
        await late.focus();
        await expect(late).toBeFocused();
        await tabThroughHeads(page, toolbox, from, 300);
        expect(await toolbox.locator(LINE_PARTS).count(), 'lines rendered with focus on A300').toBeLessThanOrEqual(MOST_LINES);
        await picture(page, `1440-${look}-f10-toolbox-300-actors-tab-A300`);
      });
    }
  });

  test('f10 q28: a screen reader counts 300 groups and every row\'s place in the whole list', async ({ page, request }) => {
    test.setTimeout(420_000);
    const registry = registryOf(generateCohortRun(MAXIMUM));
    const toolbox = await openCohortToolbox(page, request, RUNS.maximum, MAXIMUM.tools, WIDTHS[1], 'dark', 150_000);
    // The folds are a list of 300 groups: each fold a list item that says its place among the 300.
    await expect(toolbox.locator('[data-toolbox-rows]')).toHaveAttribute('role', 'list');
    await expect(foldOf(toolbox, 'A1')).toHaveAttribute('role', 'listitem');
    await expect(foldOf(toolbox, 'A1')).toHaveAttribute('aria-setsize', '300');
    await expect(foldOf(toolbox, 'A1')).toHaveAttribute('aria-posinset', '1');
    const heads = (await readAllLines(toolbox)).filter(line => line.kind === 'head');
    expect(heads.map(head => [head.name, head.pos, head.size])).toEqual(registry.actors.map((actor, i) => [actor.label, i + 1, 300]));
    // Each head says its actor and its counts in words.
    await expect(foldHead(toolbox, 'A1').getByRole('button')).toHaveAccessibleName(/^A1 Aria Chen, The Visionary, \d+ tools?(, \d+ did not pass)?$/);

    // With Open all groups, each row says the whole list's size, 3,612, and its place in it.
    await openAllGroups(toolbox).click();
    await expect(openAllGroups(toolbox)).toHaveAccessibleName('Close all groups');
    const order = actorOrder(registry);
    const rows = (await readAllLines(toolbox)).filter(line => line.kind === 'row');
    expect(rows).toHaveLength(3612);
    expect(rows.filter(row => row.size !== 3612).length, 'rows with another size').toBe(0);
    expect(rows.map(row => `${row.pos} ${row.name}@${row.actor}`))
      .toEqual(order.map((entry, i) => `${i + 1} ${entry.name}@A${entry.actorIndex + 1}`));
    await picture(page, '1440-dark-f10-toolbox-300-actors-all-open');
  });

  test('a fold closed with focus inside moves focus to its head', async ({ page, request }) => {
    test.setTimeout(240_000);
    const registry = registryOf(generateCohortRun(DOZENS));
    const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, WIDTHS[1], 'light', 60_000);
    // A2's fold open, focus on its second row; the fold closes as a screen reader's press on its head closes it, with focus left on the row.
    const a2 = foldHead(toolbox, 'A2').getByRole('button');
    await a2.click();
    await expect(a2).toHaveAttribute('aria-expanded', 'true');
    const row = rowKey(rowsOf(foldOf(toolbox, 'A2')).nth(1));
    await row.focus();
    await expect(row).toBeFocused();
    await a2.evaluate((el: HTMLElement) => el.click());
    await expect(a2).toHaveAttribute('aria-expanded', 'false');
    await expect(a2, 'focus moves to the head').toBeFocused();

    // Every fold open, past 50 lines: focus on A12's last row, far down the list; Close all groups gives focus to A12's head, in view.
    await openAllGroups(toolbox).click();
    await expect(openAllGroups(toolbox)).toHaveAccessibleName('Close all groups');
    const order = actorOrder(registry);
    const lastOfA12 = order.map((entry, i) => ({ entry, pos: i + 1 })).filter(({ entry }) => entry.actorIndex === 11).pop();
    expect(lastOfA12, 'A12 has rows').toBeDefined();
    await revealLine(toolbox, `[data-tool-row][aria-posinset="${lastOfA12!.pos}"]`);
    const deep = rowKey(toolbox.locator(`[data-tool-row][aria-posinset="${lastOfA12!.pos}"]`));
    await deep.focus();
    await expect(deep).toBeFocused();
    await openAllGroups(toolbox).evaluate((el: HTMLElement) => el.click());
    await expect(openAllGroups(toolbox)).toHaveAccessibleName('Open all groups');
    const a12 = foldHead(toolbox, 'A12').getByRole('button');
    await expect(a12, 'focus moves to the head').toBeFocused();
    const at = await focusedPlace(toolbox);
    expect(at.top, 'A12 sits below the fixed head').toBeGreaterThanOrEqual(at.headBottom - 1);
    expect(at.bottom, 'A12 is whole in view').toBeLessThanOrEqual(at.viewBottom + 1);
    await picture(page, '1440-light-f10-toolbox-24-actors-focus-to-head');
  });
});

// ── One actor picker for the toolbox ─────────────────────────────────────

/** The toolbox's Actors key: a button that names how many actors the toolbox shows and opens the picker. */
const actorsKey = (scope: Locator): Locator => scope.getByRole('button', { name: /^Actors: / });

/** The actor picker: a dialog named "Choose actors". */
const pickerOf = (page: Page): Locator => page.getByRole('dialog', { name: 'Choose actors' });

/** Opens the actor picker from the toolbox's Actors key; focus goes to Find an actor. */
async function openPicker(page: Page, toolbox: Locator): Promise<Locator> {
  const key = actorsKey(toolbox);
  await expect(key).toHaveAttribute('aria-haspopup', 'dialog');
  await key.click();
  const picker = pickerOf(page);
  await expect(picker).toBeVisible();
  await expect(key).toHaveAttribute('aria-expanded', 'true');
  await expect(picker.getByRole('searchbox', { name: 'Find an actor' })).toBeFocused();
  return picker;
}

/** The picker's list of actors: a listbox whose options are the actors, each one press from chosen. */
const actorList = (picker: Locator): Locator => picker.getByRole('listbox');
/** The options the list renders, in order. */
const optionsOf = (picker: Locator): Locator => actorList(picker).getByRole('option');
/** One actor's option, by its slot label. */
const optionOf = (picker: Locator, label: string): Locator => picker.locator(`[role="option"][data-actor="${label}"]`);
/** The labels of the options the list renders, in order. */
const optionLabels = (picker: Locator): Promise<Array<string | null>> =>
  optionsOf(picker).evaluateAll(els => els.map(el => el.getAttribute('data-actor')));

type PickedActor = ReturnType<typeof registryOf>['actors'][number];

/** An actor's counts as the picker writes them: "14 tools · 2 did not pass", the second part left out when every forge passed. */
const pickerCountsOf = (actor: PickedActor): string => (actor.counts.tools === 0
  ? 'No tools'
  : [countedAs(actor.counts.tools, 'tool', 'tools'), actor.counts.didNotPass > 0 ? `${actor.counts.didNotPass.toLocaleString('en-US')} did not pass` : '']
    .filter(Boolean).join(' · '));

/** An option's name: "A7 Ines Duarte, The Strategist, 14 tools, 2 did not pass". */
const optionNameOf = (actor: PickedActor): string => [
  `${actor.label} ${actor.name}`,
  actor.archetype,
  actor.counts.tools === 0 ? 'No tools' : countedAs(actor.counts.tools, 'tool', 'tools'),
  actor.counts.didNotPass > 0 ? `${actor.counts.didNotPass.toLocaleString('en-US')} did not pass` : '',
].filter(Boolean).join(', ');

/** The toolbox's count line while some actors are chosen: "Showing 3 of 24 actors · 41 tools from 47 forges (6 re-forges) · …". */
function chosenLineOf(picked: PickedActor[], of: number): string {
  const sum = { tools: 0, forges: 0, reforges: 0, passed: 0, didNotPass: 0 };
  for (const actor of picked) {
    sum.tools += actor.counts.tools;
    sum.forges += actor.counts.forges;
    sum.reforges += actor.counts.reforges;
    sum.passed += actor.counts.passed;
    sum.didNotPass += actor.counts.didNotPass;
  }
  const reforged = sum.reforges > 0 ? ` (${countedAs(sum.reforges, 're-forge', 're-forges')})` : '';
  return [
    `Showing ${picked.length} of ${of} actors`,
    `${countedAs(sum.tools, 'tool', 'tools')} from ${countedAs(sum.forges, 'forge', 'forges')}${reforged}`,
    sum.passed > 0 ? `${sum.passed.toLocaleString('en-US')} passed` : '',
    sum.didNotPass > 0 ? `${sum.didNotPass.toLocaleString('en-US')} did not pass` : '',
  ].filter(Boolean).join(' · ');
}

/**
 * Scrolls the picker's list by most of its view and waits until the options
 * it renders cover the view. Says whether it moved, and the labels and the
 * number of the options rendered.
 */
const scrollOptions = (list: Locator) => list.evaluate(async (el) => {
  const frame = () => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  const covered = (): boolean => {
    const options = el.querySelectorAll<HTMLElement>('[role="option"]');
    if (options.length === 0) return false;
    const box = el.getBoundingClientRect();
    const top = box.top + el.clientTop;
    const bottom = top + el.clientHeight;
    const first = options[0];
    const last = options[options.length - 1];
    const topOk = first.getAttribute('aria-posinset') === '1' || first.getBoundingClientRect().top <= top + 1;
    const bottomOk = last.getAttribute('aria-posinset') === last.getAttribute('aria-setsize') || last.getBoundingClientRect().bottom >= bottom - 1;
    return topOk && bottomOk;
  };
  const before = el.scrollTop;
  el.scrollTop = before + Math.max(40, el.clientHeight * 0.8);
  const moved = el.scrollTop > before + 0.5;
  let ok = false;
  for (let i = 0; i < 240 && !ok; i += 1) {
    await frame();
    if (covered()) {
      await frame();
      ok = covered();
    }
  }
  const labels = Array.from(el.querySelectorAll('[role="option"]')).map(o => o.getAttribute('data-actor') ?? '');
  return { moved, covered: ok, rendered: labels.length, labels };
});

test.describe('one actor picker for the toolbox', () => {
  test('f19 q1: the pair\'s picker lists A1 Aria Chen and A2 Dietrich Voss with 5 and 7 tools', async ({ page, request }) => {
    test.setTimeout(180_000);
    const registry = registryOf(pairRunFrames());
    expect(registry.actors.map(a => a.counts.tools)).toEqual([5, 7]);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        await openPairSim(page, request, size, look);
        const toolbox = await openToolbox(page, 12);
        // The Actors key reads the pair's every actor.
        const key = actorsKey(toolbox);
        await expect(key).toHaveAccessibleName('Actors: All 2');
        await expect(key).toHaveAttribute('aria-expanded', 'false');
        const picker = await openPicker(page, toolbox);
        await expect(actorList(picker)).toHaveAttribute('aria-multiselectable', 'true');
        await expect(optionsOf(picker)).toHaveCount(2);
        // Each option: its tile, its name and archetype, its counts and its forge strip, named by them in words, none chosen.
        const parts = await optionsOf(picker).evaluateAll(els => els.map(el => ({
          tile: el.querySelector('[data-actor-tile]')?.textContent ?? '',
          name: el.querySelector('[data-picker-name]')?.textContent ?? '',
          archetype: el.querySelector('[data-picker-archetype]')?.textContent ?? '',
          counts: el.querySelector('[data-picker-counts]')?.textContent ?? '',
          strip: Number(el.querySelector('[data-forge-strip]')?.getAttribute('data-forge-strip') ?? -1),
          selected: el.getAttribute('aria-selected'),
          pos: `${el.getAttribute('aria-posinset')} of ${el.getAttribute('aria-setsize')}`,
        })));
        expect(parts).toEqual(registry.actors.map((actor, i) => ({
          tile: actor.label,
          name: actor.name,
          archetype: actor.archetype,
          counts: pickerCountsOf(actor),
          strip: actor.strip.length,
          selected: 'false',
          pos: `${i + 1} of 2`,
        })));
        expect(parts.map(p => p.name)).toEqual(['Aria Chen', 'Dietrich Voss']);
        await expect(optionOf(picker, 'A1')).toHaveAccessibleName(optionNameOf(registry.actors[0]));
        await expect(optionOf(picker, 'A2')).toHaveAccessibleName(optionNameOf(registry.actors[1]));
        // The tile's band and the strip are drawn only.
        await expect(optionOf(picker, 'A1').locator('[data-forge-strip]')).toHaveAttribute('aria-hidden', 'true');
        await picture(page, `${size.width}-${look}-f19-picker-pair`);
      });
    }
  });

  test('f19 q2 to q4: search by name or archetype, by label, and a search with no match', async ({ page, request }) => {
    test.setTimeout(180_000);
    const registry = registryOf(generateCohortRun(DOZENS));
    const strat = registry.actors.filter(a => `${a.name} ${a.archetype}`.toLowerCase().includes('strat')).map(a => a.label);
    expect(strat).toEqual(['A7', 'A11', 'A15', 'A19']);
    const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, WIDTHS[1], 'light', 60_000);
    await expect(actorsKey(toolbox)).toHaveAccessibleName('Actors: All 24');
    const picker = await openPicker(page, toolbox);
    await expect(optionsOf(picker)).toHaveCount(24);
    const find = picker.getByRole('searchbox', { name: 'Find an actor' });
    await expect(find).toHaveAttribute('placeholder', 'Name, archetype or A-number…');

    // q2: "strat" finds the actors whose name or archetype holds it.
    await find.fill('strat');
    await expect.poll(() => optionLabels(picker)).toEqual(strat);
    await picture(page, '1440-light-f19-picker-strat');
    // Select shown checks every actor the search shows, and is inactive once each one shown is checked.
    const selectShown = picker.getByRole('button', { name: 'Select shown', exact: true });
    await selectShown.click();
    await expect(actorsKey(toolbox)).toHaveAccessibleName('Actors: 4 of 24');
    for (const label of strat) await expect(optionOf(picker, label)).toHaveAttribute('aria-selected', 'true');
    await expect(selectShown).toHaveAttribute('aria-disabled', 'true');

    // q3: "A17" finds A17 alone, and "A1" finds A1 alone.
    await page.setViewportSize({ width: 768, height: 1024 });
    await find.fill('A17');
    await expect.poll(() => optionLabels(picker)).toEqual(['A17']);
    await find.fill('A1');
    await expect.poll(() => optionLabels(picker)).toEqual(['A1']);
    await picture(page, '768-light-f19-picker-A1');

    // q4: a word no actor holds says so, with Clear as the way forward.
    await page.setViewportSize(WIDTHS[0]);
    await find.fill('zzz');
    await expect(optionsOf(picker)).toHaveCount(0);
    const empty = picker.locator('[data-picker-empty]');
    await expect(empty).toContainText('No actor matches “zzz”.');
    // With no actor to list, Select shown, Clear and Done keep their place at the sheet's foot.
    const footGap = await picker.evaluate((sheet) => {
      const foot = sheet.querySelector('[data-picker-foot]')!.getBoundingClientRect();
      return sheet.getBoundingClientRect().bottom - foot.bottom;
    });
    expect(footGap, 'the foot stands at the sheet\'s foot').toBeGreaterThanOrEqual(0);
    expect(footGap, 'the foot stands at the sheet\'s foot').toBeLessThanOrEqual(24);
    await picture(page, '390-light-f19-picker-no-match');
    await empty.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(find).toHaveValue('');
    await expect(find).toBeFocused();
    await expect(optionsOf(picker)).not.toHaveCount(0);
    // The field's own Clear shows while it holds text.
    await find.fill('Ines');
    await picker.getByRole('button', { name: 'Clear the actor search', exact: true }).click();
    await expect(find).toHaveValue('');
  });

  test('f19 q5 and f10 q32: checking A1, A3 and A7 narrows the toolbox at once', async ({ page, request }) => {
    test.setTimeout(240_000);
    const registry = registryOf(generateCohortRun(DOZENS));
    const picked = [0, 2, 6].map(i => registry.actors[i]);
    for (const size of [WIDTHS[1], { width: 1100, height: 900 }]) {
      await test.step(`${size.width} in the dark look`, async () => {
        const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, size, 'dark', 60_000);
        const picker = await openPicker(page, toolbox);
        for (const [n, actor] of picked.entries()) {
          await optionOf(picker, actor.label).click();
          await expect(optionOf(picker, actor.label)).toHaveAttribute('aria-selected', 'true');
          // Each choice applies at once: the key, the count line and the polite status follow it.
          await expect(actorsKey(toolbox)).toHaveAccessibleName(`Actors: ${n + 1} of 24`);
          await expect(toolbox.locator('[data-toolbox-count]')).toHaveText(chosenLineOf(picked.slice(0, n + 1), 24));
          await expect(picker.getByRole('status')).toHaveText(`Showing ${n + 1} of 24 actors`);
        }
        await picture(page, `${size.width}-dark-f19-picker-3-of-24`);
        // Escape closes the picker; the toolbox shows those three actors' folds alone.
        await page.keyboard.press('Escape');
        await expect(picker).toBeHidden();
        await expect(toolbox).toBeVisible();
        await expect(toolbox.locator('[data-toolbox-count]')).toHaveText(chosenLineOf(picked, 24));
        await expect(foldHeads(toolbox)).toHaveCount(3);
        expect(await foldHeads(toolbox).evaluateAll(els => els.map(el => el.getAttribute('data-fold-head')))).toEqual(['A1', 'A3', 'A7']);
        // The choice is kept in the page's link.
        await expect.poll(() => new URL(page.url()).searchParams.get('actors')).toBe('1,3,7');
        // Export JSON saves the chosen actors' rows alone.
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          toolbox.getByRole('button', { name: 'Export JSON', exact: true }).click(),
        ]);
        const rows = JSON.parse(readFileSync(await download.path(), 'utf8')) as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(picked.reduce((sum, a) => sum + a.counts.tools, 0));
        expect([...new Set(rows.map(row => row.actor))]).toEqual(['A1', 'A3', 'A7']);
        await picture(page, `${size.width}-dark-f10-toolbox-3-of-24`);
        // Clear unchecks every actor, so every actor shows again.
        const again = await openPicker(page, toolbox);
        await again.locator('[data-picker-foot]').getByRole('button', { name: 'Clear', exact: true }).click();
        await expect(actorsKey(toolbox)).toHaveAccessibleName('Actors: All 24');
        await expect(toolbox.locator('[data-toolbox-count]')).toHaveText(DOZENS_LINE);
        await expect.poll(() => new URL(page.url()).searchParams.get('actors')).toBeNull();
        await page.keyboard.press('Escape');
        await expect(foldHeads(toolbox)).toHaveCount(24);
      });
    }
  });

  test('with actors chosen, an empty Did not pass filter says nothing of the whole run and offers All', async ({ page, request }) => {
    test.setTimeout(180_000);
    const registry = registryOf(generateCohortRun(DOZENS));
    expect(registry.list.some(e => e.outcome === 'did_not_pass'), 'the run holds tools that did not pass').toBe(true);
    // An actor whose every tool passed.
    const clean = registry.actors.findIndex((_, i) => {
      const own = registry.list.filter(e => e.actorIndex === i);
      return own.length > 0 && own.every(e => e.outcome === 'passed');
    });
    if (clean < 0) throw new Error('every actor of the 24-actor run holds a tool that did not pass');
    const id = await sessionIdByName(request, COHORT_SERVER, RUNS.dozens);
    await page.setViewportSize(WIDTHS[1]);
    await useLook(page, 'dark');
    await page.goto(withParams(replayUrl(COHORT_SERVER, id, 'sim'), { toolbox: '1', show: 'did_not_pass', actors: String(clean + 1) }));
    await lookShown(page, 'dark');
    await replayComplete(page, 90_000);
    const toolbox = toolboxOf(page);
    await expect(toolbox).toBeVisible();
    await expect(toolbox.locator('[data-toolbox-count]')).toContainText('Showing 1 of 24 actors');
    await expect(rowsOf(toolbox)).toHaveCount(0);
    // Other actors' tools did not pass, so the run-wide sentence is not said.
    await expect(toolbox.getByText('Every tool in this run passed.', { exact: true })).toHaveCount(0);
    // All is the way forward.
    await toolbox.getByRole('button', { name: 'All', exact: true }).click();
    await expect(toolbox.locator('[data-toolbox-empty]')).toHaveCount(0);
  });

  test('f19 q6: sorting by most forges that did not pass', async ({ page, request }) => {
    test.setTimeout(180_000);
    const registry = registryOf(generateCohortRun(DOZENS));
    const byDidNotPass = [...registry.actors].sort((a, b) => b.counts.didNotPass - a.counts.didNotPass || a.index - b.index);
    const byTools = [...registry.actors].sort((a, b) => b.counts.tools - a.counts.tools || a.index - b.index);
    const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, { width: 1100, height: 900 }, 'light', 60_000);
    const picker = await openPicker(page, toolbox);
    const sort = picker.getByRole('combobox', { name: 'Sort' });
    await expect(sort.locator('option')).toHaveText(['Run order', 'Most tools', 'Most forges that did not pass']);
    await expect(optionsOf(picker).first()).toHaveAttribute('data-actor', 'A1');
    await sort.selectOption({ label: 'Most forges that did not pass' });
    await expect.poll(() => optionLabels(picker)).toEqual(byDidNotPass.map(a => a.label));
    // The first row holds the highest count.
    const top = Math.max(...registry.actors.map(a => a.counts.didNotPass));
    expect(byDidNotPass[0].counts.didNotPass).toBe(top);
    await expect(optionsOf(picker).first().locator('[data-picker-counts]')).toHaveText(pickerCountsOf(byDidNotPass[0]));
    // A sort's place in the list is what a screen reader counts.
    await expect(optionsOf(picker).first()).toHaveAttribute('aria-posinset', '1');
    await picture(page, '1100-light-f19-picker-sort-did-not-pass');
    await sort.selectOption({ label: 'Most tools' });
    await expect.poll(() => optionLabels(picker)).toEqual(byTools.map(a => a.label));
    await sort.selectOption({ label: 'Run order' });
    await expect.poll(() => optionLabels(picker)).toEqual(registry.actors.map(a => a.label));
  });

  test('f19 q7: the 300-actor picker renders its rows as they scroll and announces 300 options', async ({ page, request }) => {
    test.setTimeout(300_000);
    const toolbox = await openCohortToolbox(page, request, RUNS.maximum, MAXIMUM.tools, WIDTHS[1], 'dark', 150_000);
    await expect(actorsKey(toolbox)).toHaveAccessibleName('Actors: All 300');
    const picker = await openPicker(page, toolbox);
    const list = actorList(picker);
    await expect(list).toHaveAttribute('aria-multiselectable', 'true');
    await expect(optionOf(picker, 'A1')).toHaveAttribute('aria-setsize', '300');
    await expect(optionOf(picker, 'A1')).toHaveAttribute('aria-posinset', '1');
    expect(await optionsOf(picker).count(), 'options rendered at the top').toBeLessThanOrEqual(MOST_LINES);
    // A view at a time to the end: never more than about 60 options rendered, and every actor rendered on the way.
    const seen = new Set<string>(await optionLabels(picker) as string[]);
    for (let step = 1; step <= 200; step += 1) {
      const now = await scrollOptions(list);
      expect(now.covered, `step ${step}: the options in view are rendered`).toBe(true);
      expect(now.rendered, `step ${step}: options rendered`).toBeLessThanOrEqual(MOST_LINES);
      for (const label of now.labels) seen.add(label);
      if (!now.moved) break;
    }
    await expect(optionOf(picker, 'A300')).toBeVisible();
    await expect(optionOf(picker, 'A300')).toHaveAttribute('aria-posinset', '300');
    expect(seen.size).toBe(300);
    await picture(page, '1440-dark-f19-picker-300-end');
    // The search finds any actor at once.
    await picker.getByRole('searchbox', { name: 'Find an actor' }).fill('A250');
    await expect.poll(() => optionLabels(picker)).toEqual(['A250']);
  });

  test('at 300 actors, a focused option stays focused and rendered when the list scrolls far from it', async ({ page, request }) => {
    test.setTimeout(300_000);
    const toolbox = await openCohortToolbox(page, request, RUNS.maximum, MAXIMUM.tools, WIDTHS[1], 'dark', 150_000);
    const picker = await openPicker(page, toolbox);
    const list = actorList(picker);
    const first = optionOf(picker, 'A1');
    await first.focus();
    await expect(first).toBeFocused();
    // The list scrolls to its end, as a wheel moves it, while focus stays on A1.
    // Rows measured on the way change the list's height, so it scrolls again
    // until A300 stands whole in the list's view.
    await expect.poll(() => list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      const last = el.querySelector('[data-actor="A300"]');
      if (!last) return false;
      const row = last.getBoundingClientRect();
      const view = el.getBoundingClientRect();
      return row.top >= view.top - 1 && row.bottom <= view.bottom + 1;
    }), { message: 'the list scrolls to A300' }).toBe(true);
    await expect(optionOf(picker, 'A300')).toBeInViewport();
    await expect(first, 'A1 keeps focus').toBeFocused();
    expect(await optionsOf(picker).count(), 'the options between A1 and the view are not rendered').toBeLessThanOrEqual(MOST_LINES + 1);
    // Down from A1 moves focus to A2 and brings it into view.
    await page.keyboard.press('ArrowDown');
    await expect(optionOf(picker, 'A2')).toBeFocused();
    await expect(optionOf(picker, 'A2')).toBeInViewport();
  });

  test('f19 q9: Escape closes the picker and returns focus to the Actors key', async ({ page, request }) => {
    test.setTimeout(120_000);
    const registry = registryOf(pairRunFrames());
    await openPairSim(page, request, WIDTHS[1], 'dark');
    const toolbox = await openToolbox(page, 12);
    const picker = await openPicker(page, toolbox);
    // The focus order: Find an actor, Sort, then the list; Up and Down move through the list and Space checks an actor.
    await page.keyboard.press('Tab');
    await expect(picker.getByRole('combobox', { name: 'Sort' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(optionOf(picker, 'A1')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(optionOf(picker, 'A2')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(optionOf(picker, 'A2')).toHaveAttribute('aria-selected', 'true');
    await expect(optionOf(picker, 'A1')).toHaveAttribute('aria-selected', 'false');
    await expect(actorsKey(toolbox)).toHaveAccessibleName('Actors: 1 of 2');
    await page.keyboard.press('ArrowUp');
    await expect(optionOf(picker, 'A1')).toBeFocused();
    // Escape closes the picker alone, with focus back on the Actors key.
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(toolbox).toBeVisible();
    await expect(actorsKey(toolbox)).toBeFocused();
    await expect(actorsKey(toolbox)).toHaveAttribute('aria-expanded', 'false');
    // The toolbox shows A2's rows alone.
    await expect(toolbox.locator('[data-toolbox-count]')).toHaveText(chosenLineOf([registry.actors[1]], 2));
    await expect(rowsOf(toolbox)).toHaveCount(7);
    expect(new Set(await rowsOf(toolbox).evaluateAll(els => els.map(el => el.getAttribute('data-actor'))))).toEqual(new Set(['A2']));
    await picture(page, '1440-dark-f19-picker-closed-A2');
  });

  test('f19 q13: offline the picker works', async ({ page, context, request }) => {
    test.setTimeout(120_000);
    await openPairSim(page, request, WIDTHS[0], 'dark');
    await context.setOffline(true);
    try {
      const toolbox = await openToolbox(page, 12);
      const picker = await openPicker(page, toolbox);
      await picker.getByRole('searchbox', { name: 'Find an actor' }).fill('Dietrich');
      await expect.poll(() => optionLabels(picker)).toEqual(['A2']);
      await optionOf(picker, 'A2').click();
      await expect(actorsKey(toolbox)).toHaveAccessibleName('Actors: 1 of 2');
      await picture(page, '390-dark-f19-picker-offline');
      // Done closes the phone's sheet, with focus back on the Actors key.
      await picker.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(picker).toBeHidden();
      await expect(actorsKey(toolbox)).toBeFocused();
      await expect(rowsOf(toolbox)).toHaveCount(7);
    } finally {
      await context.setOffline(false);
    }
  });

  test('f19 q14: the picker\'s top row and foot stay one row at the sweep widths', async ({ page, request }) => {
    test.setTimeout(240_000);
    for (const look of LOOKS) {
      const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, WIDTHS[0], look, 60_000);
      // The Actors key stands beside Group, above the filter and the search.
      const picker = await openPicker(page, toolbox);
      for (const width of SWEEP_WIDTHS) {
        await test.step(`${width} in the ${look} look`, async () => {
          await page.setViewportSize({ width, height: 844 });
          await expect(picker).toBeVisible();
          const read = await picker.evaluate((sheet) => {
            const box = (el: Element | null) => {
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
            };
            const foot = sheet.querySelector('[data-picker-foot]');
            return {
              window: window.innerWidth,
              pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              sheet: box(sheet)!,
              sheetScroll: sheet.scrollWidth - sheet.clientWidth,
              field: box(sheet.querySelector('input[type="search"]')),
              sort: box(sheet.querySelector('select')),
              foot: foot ? Array.from(foot.querySelectorAll('button')).map(b => ({ name: b.textContent ?? '', ...box(b)! })) : [],
            };
          });
          expect(read.sheetScroll, 'the picker does not scroll sideways').toBeLessThanOrEqual(0);
          expect(read.pageScroll, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
          expect(read.sheet.left).toBeGreaterThanOrEqual(-0.5);
          expect(read.sheet.right).toBeLessThanOrEqual(read.window + 0.5);
          // The top row: Find an actor and Sort side by side, each 44 px tall on a phone.
          expect(read.field, 'Find an actor shows').not.toBeNull();
          expect(read.sort, 'Sort shows').not.toBeNull();
          expect(Math.max(read.field!.top, read.sort!.top), 'Find an actor and Sort share one row').toBeLessThan(Math.min(read.field!.bottom, read.sort!.bottom));
          for (const part of [read.field!, read.sort!]) {
            expect(Math.round(part.height)).toBeGreaterThanOrEqual(42);
            expect(part.right).toBeLessThanOrEqual(read.sheet.right + 0.5);
          }
          // The foot: Select shown, Clear and Done on one row, each 44 px tall.
          expect(read.foot.map(key => key.name)).toEqual(['Select shown', 'Clear', 'Done']);
          expect(Math.max(...read.foot.map(key => key.top)), 'the foot is one row').toBeLessThan(Math.min(...read.foot.map(key => key.bottom)));
          for (const key of read.foot) {
            expect(Math.round(key.height), `${key.name} is 44 px tall`).toBeGreaterThanOrEqual(44);
            expect(key.right).toBeLessThanOrEqual(read.sheet.right + 0.5);
            expect(key.left).toBeGreaterThanOrEqual(read.sheet.left - 0.5);
          }
          if (width === 320 || width === 768) await picture(page, `${width}-${look}-f19-picker-sheet`);
        });
      }
      await page.keyboard.press('Escape');
      await expect(picker).toBeHidden();
      // With the picker closed, the Actors key and Group share a row above the filter and the search at each width.
      for (const width of SWEEP_WIDTHS) {
        await page.setViewportSize({ width, height: 844 });
        const keys = await toolbox.evaluate((dialog) => {
          const box = (el: Element | null) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, right: r.right, height: r.height };
          };
          return {
            sheet: box(dialog)!,
            group: box(dialog.querySelector('button[aria-haspopup="menu"]')),
            actors: box(dialog.querySelector('button[aria-haspopup="dialog"]')),
            field: box(dialog.querySelector('input[type="search"]')),
          };
        });
        expect(keys.actors, `${width}: the Actors key shows`).not.toBeNull();
        expect(Math.round(keys.actors!.height), `${width}: the Actors key is 44 px tall`).toBeGreaterThanOrEqual(44);
        expect(Math.max(keys.group!.top, keys.actors!.top), `${width}: Group and Actors share one row`).toBeLessThan(Math.min(keys.group!.bottom, keys.actors!.bottom));
        expect(keys.actors!.bottom, `${width}: Actors stands above the search`).toBeLessThanOrEqual(keys.field!.top + 0.5);
        expect(keys.actors!.right).toBeLessThanOrEqual(keys.sheet.right + 0.5);
      }
    }
  });

  test('f19 layouts: the picker is a sheet on the window below 900 px, wherever the toolbox is scrolled, and a popover under its key from 900 px', async ({ page, request }) => {
    test.setTimeout(240_000);
    /** The picker's box beside the window's, Find an actor's and the foot's, read once the picker has stopped moving. */
    const placeOf = async (picker: Locator) => {
      let was = '';
      await expect.poll(async () => {
        const now = JSON.stringify(await picker.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return [r.top, r.bottom, r.left, r.right];
        }));
        const still = now === was;
        was = now;
        return still;
      }, { message: 'the picker has stopped moving' }).toBe(true);
      return picker.evaluate((el) => {
        const box = (node: Element) => {
          const r = node.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
        };
        return {
          window: { width: window.innerWidth, height: window.innerHeight },
          sheet: box(el),
          field: box(el.querySelector('input[type="search"]')!),
          foot: box(el.querySelector('[data-picker-foot]')!),
        };
      });
    };
    /** How far the toolbox, which scrolls inside its own dialog, is scrolled. */
    const scrollOf = (toolbox: Locator): Promise<number> => toolbox.evaluate(el => el.scrollTop);
    /**
     * Presses the Actors key in the page itself and waits for the picker. A
     * driver's click may first scroll the key into place, and these steps read
     * the toolbox's scroll, so they must see the page's own scrolling alone.
     */
    const pressActors = async (toolbox: Locator): Promise<Locator> => {
      await actorsKey(toolbox).evaluate(el => (el as HTMLElement).click());
      const picker = pickerOf(page);
      await expect(picker).toBeVisible();
      await expect(picker.getByRole('searchbox', { name: 'Find an actor' })).toBeFocused();
      return picker;
    };
    type Place = Awaited<ReturnType<typeof placeOf>>;
    /** A full-screen sheet: it covers the window, with its top row and its foot on it. */
    const coversTheWindow = (at: Place): void => {
      expect(Math.abs(at.sheet.top), 'the sheet starts at the window\'s top').toBeLessThanOrEqual(0.5);
      expect(Math.abs(at.sheet.bottom - at.window.height), 'the sheet ends at the window\'s foot').toBeLessThanOrEqual(0.5);
      expect(Math.abs(at.sheet.left), 'the sheet starts at the window\'s left edge').toBeLessThanOrEqual(0.5);
      expect(Math.abs(at.sheet.right - at.window.width), 'the sheet ends at the window\'s right edge').toBeLessThanOrEqual(0.5);
      expect(at.field.top, 'Find an actor is on the window').toBeGreaterThanOrEqual(0);
      expect(at.foot.bottom, 'the foot is on the window').toBeLessThanOrEqual(at.window.height + 0.5);
    };

    await test.step('390: a full-screen sheet', async () => {
      await openPairSim(page, request, WIDTHS[0], 'dark');
      const toolbox = await openToolbox(page, 12);
      const before = await scrollOf(toolbox);
      let picker = await pressActors(toolbox);
      coversTheWindow(await placeOf(picker));
      expect(await scrollOf(toolbox), 'opening the picker does not scroll the toolbox under it').toBe(before);
      await picture(page, '390-dark-f19-picker-sheet-on-window');
      await picker.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(picker).toBeHidden();
      // With the toolbox scrolled, the sheet covers the window all the same, and the toolbox stays where it was.
      await toolbox.evaluate((el) => { el.scrollTop = 32; });
      expect(await scrollOf(toolbox)).toBe(32);
      picker = await pressActors(toolbox);
      const at = await placeOf(picker);
      expect(await scrollOf(toolbox), 'the toolbox stays scrolled under the sheet').toBe(32);
      coversTheWindow(at);
      await picture(page, '390-dark-f19-picker-sheet-over-scrolled-toolbox');
    });

    await test.step('768: a sheet from the bottom, 70 per cent of the window tall', async () => {
      const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, { width: 768, height: 1024 }, 'light', 60_000);
      const before = await scrollOf(toolbox);
      const picker = await pressActors(toolbox);
      const at = await placeOf(picker);
      expect(Math.abs(at.sheet.bottom - at.window.height), 'the sheet ends at the window\'s foot').toBeLessThanOrEqual(0.5);
      expect(Math.abs(at.sheet.height - at.window.height * 0.7), 'the sheet is 70 per cent of the window tall').toBeLessThanOrEqual(1);
      expect(Math.abs(at.sheet.left), 'the sheet starts at the window\'s left edge').toBeLessThanOrEqual(0.5);
      expect(Math.abs(at.sheet.right - at.window.width), 'the sheet ends at the window\'s right edge').toBeLessThanOrEqual(0.5);
      expect(at.field.top, 'Find an actor is in the sheet').toBeGreaterThanOrEqual(at.sheet.top);
      expect(at.foot.bottom, 'the foot is on the window').toBeLessThanOrEqual(at.window.height + 0.5);
      expect(await scrollOf(toolbox), 'opening the picker does not scroll the toolbox under it').toBe(before);
      await picture(page, '768-light-f19-picker-sheet-on-window');
    });

    const popovers: Array<{ size: Size; wide: number }> = [
      { size: WIDTHS[1], wide: 560 },
      { size: { width: 1100, height: 900 }, wide: 480 },
    ];
    for (const { size, wide } of popovers) {
      await test.step(`${size.width}: a popover ${wide} px wide under the Actors key`, async () => {
        await openPairSim(page, request, size, 'dark');
        const toolbox = await openToolbox(page, 12);
        const picker = await openPicker(page, toolbox);
        const at = await placeOf(picker);
        const key = await actorsKey(toolbox).evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, bottom: r.bottom };
        });
        expect(Math.abs(at.sheet.width - wide), `the popover is ${wide} px wide`).toBeLessThanOrEqual(0.5);
        expect(at.sheet.top, 'the popover starts under its key').toBeGreaterThanOrEqual(key.bottom);
        expect(at.sheet.top, 'the popover stands close under its key').toBeLessThanOrEqual(key.bottom + 8);
        expect(Math.abs(at.sheet.left - key.left), 'the popover starts at its key\'s left edge').toBeLessThanOrEqual(1);
        expect(at.sheet.height, 'the popover is no taller than 560 px').toBeLessThanOrEqual(560.5);
        expect(at.sheet.bottom, 'the popover ends on the window').toBeLessThanOrEqual(at.window.height + 0.5);
        expect(at.sheet.right, 'the popover ends on the window').toBeLessThanOrEqual(at.window.width + 0.5);
      });
    }
  });
});

// ── The Viz tab ───────────────────────────────────────────────────────────

/** What a forge mark of the Viz tab's event strip says: its turn, its tool and its side. */
const FORGE_MARK = /^T(\d+): (?:forged|rejected) (\S+) \(([AB])\)/;

/** The Viz tab's event strip, above its living grids. */
const eventStrip = (page: Page): Locator => page.locator('[aria-label="Event filter"]');

interface ForgeMark { label: string; turn: number; tool: string; side: 'a' | 'b' }

/** The event strip's forge marks, each with the turn, the tool and the side its label names. */
async function forgeMarks(page: Page): Promise<ForgeMark[]> {
  const labels = await eventStrip(page).locator('button[aria-label]')
    .evaluateAll(els => els.map(el => el.getAttribute('aria-label') ?? ''));
  return labels.flatMap((label) => {
    const m = FORGE_MARK.exec(label);
    return m ? [{ label, turn: Number(m[1]), tool: m[2], side: m[3] === 'A' ? 'a' as const : 'b' as const }] : [];
  });
}

/** A forge mark of the event strip, by its label. */
const markOf = (page: Page, label: string): Locator =>
  eventStrip(page).getByRole('button', { name: label, exact: true }).first();

/** The grid on the left of a pair, or of the Focus pair of a larger run. */
const leftGrid = (page: Page): Locator => page.getByTestId('living-colony-grid-a');

/** Opens a stored run on the Viz tab at one size in one look, in LIVING mode, played in to its end. */
async function openViz(page: Page, request: APIRequestContext, run: 'pair' | string, size: Size, look: Look, timeout: number): Promise<void> {
  const id = run === 'pair' ? await pairSessionId(request) : await sessionIdByName(request, COHORT_SERVER, run);
  await page.setViewportSize(size);
  await useLook(page, look);
  // The Viz tab keeps its mode on the device: each open starts from its default.
  await page.addInitScript(() => { window.localStorage.removeItem('paracosm:gridMode'); });
  await page.goto(replayUrl(run === 'pair' ? PAIR_SERVER : COHORT_SERVER, id, 'viz'));
  await lookShown(page, look);
  await replayComplete(page, timeout);
}

/** Chooses FORGE on the Viz tab's row of mode pills. */
async function chooseForgeMode(page: Page): Promise<void> {
  const pill = page.locator('[data-grid-mode="forge"]');
  await pill.click();
  await expect(pill).toHaveAttribute('aria-selected', 'true');
}

/** The key FORGE mode shows beside the mode pills: "Forged toolbox · 286". */
const vizToolboxKey = (page: Page, tools: number): Locator =>
  page.getByRole('button', { name: `Forged toolbox · ${tools.toLocaleString('en-US')}`, exact: true });

/** The dashboard's dim over the run view, which the Viz tab's is lighter than. */
const RUN_VIEW_DIM = 0.78;

/**
 * A living grid with a dialog open over the Viz tab: in the window, part of
 * its box beside the dialog's, and the dim over that part, light enough to
 * leave the grid in view.
 */
async function expectGridDimmedBeside(grid: Locator, dialog: Locator): Promise<void> {
  await expect(grid, 'the living grid is rendered and in the window').toBeInViewport();
  const seen = await dialog.evaluate((d, g) => {
    if (!(g instanceof Element)) return null;
    const dialogBox = d.getBoundingClientRect();
    const gridBox = g.getBoundingClientRect();
    const top = Math.max(gridBox.top, 0);
    const bottom = Math.min(gridBox.bottom, window.innerHeight);
    // The grid's part on the window left of the dialog, else right of it.
    const left = { from: Math.max(gridBox.left, 0), to: Math.min(gridBox.right, dialogBox.left) };
    const right = { from: Math.max(gridBox.left, dialogBox.right), to: Math.min(gridBox.right, window.innerWidth) };
    const side = left.to - left.from >= 1 ? left : right.to - right.from >= 1 ? right : null;
    if (!side || bottom - top < 1) return { beside: false, dimmed: false, alpha: -1 };
    const backdrop = d.parentElement;
    const atSide = document.elementFromPoint((side.from + side.to) / 2, (top + bottom) / 2);
    const ground = backdrop ? getComputedStyle(backdrop).backgroundColor : '';
    const rgba = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(ground);
    return { beside: true, dimmed: atSide === backdrop, alpha: rgba ? Number(rgba[1]) : ground.startsWith('rgb(') ? 1 : 0 };
  }, await grid.elementHandle());
  expect(seen?.beside, 'part of the grid stands in the window beside the dialog').toBe(true);
  expect(seen?.dimmed, 'the dim lies over the grid at the dialog\'s side').toBe(true);
  expect(seen?.alpha, 'the dim lets the grid through').toBeGreaterThan(0);
  expect(seen?.alpha, 'over the Viz tab the dim is lighter than over the run view').toBeLessThan(RUN_VIEW_DIM);
}

test.describe('the Viz tab opens the forge view over the living grid', () => {
  test('f1 q31: a forge mark on the Viz tab\'s event strip opens that attempt over the dimmed living grid', async ({ page, request }) => {
    test.setTimeout(300_000);
    const registry = registryOf(generateCohortRun(DOZENS));
    for (const look of LOOKS) {
      await test.step(`the 24-actor run under Focus pair, 1440 in the ${look} look`, async () => {
        await openViz(page, request, RUNS.dozens, WIDTHS[1], look, 90_000);
        await page.getByRole('tab', { name: 'Focus pair', exact: true }).click();
        // A mark of a forge that is its tool's only one on that turn: a re-forged tool's where the strip shows one.
        const marks = (await forgeMarks(page)).flatMap((mark) => {
          const entry = registry.getEntryFor(mark.side === 'a' ? 0 : 1, mark.tool);
          const onTurn = entry?.attempts.filter(a => a.turn === mark.turn) ?? [];
          return entry && onTurn.length === 1 ? [{ mark, entry, attempt: onTurn[0].attempt }] : [];
        });
        const chosen = marks.find(m => m.entry.attempts.length > 1) ?? marks[0];
        if (!chosen) throw new Error('the event strip holds no forge mark of A1 or A2');
        const { mark, entry, attempt } = chosen;
        const key = markOf(page, mark.label);
        await key.click();

        // The trace of that actor's tool, at the mark's own attempt.
        const trace = traceOf(page, mark.tool);
        await expect(trace).toBeVisible();
        await expect(trace.locator('[data-forge-header] [data-actor-tile]')).toHaveText(mark.side === 'a' ? 'A1' : 'A2');
        if (entry.attempts.length > 1) {
          await expect(trace.getByRole('group', { name: `Attempt ${attempt} of ${entry.attempts.length}`, exact: true })).toBeVisible();
        }
        // Under Focus pair the grids are the pair's: the left one is A1's, beside the dialog under the dim.
        await expect(leftGrid(page)).toHaveAccessibleName(/^Aria Chen \S+ viz$/);
        await expectGridDimmedBeside(leftGrid(page), trace);
        await picture(page, `1440-${look}-f1-viz-mark-trace`);

        await closeTrace(trace);
        await expect(key, 'Close returns focus to the mark').toBeFocused();
      });
    }

    await test.step('the pair run: each mark of a tool forged twice opens its own attempt', async () => {
      await openViz(page, request, 'pair', WIDTHS[1], 'dark', 60_000);
      const marks = (await forgeMarks(page)).filter(m => m.tool === RATION && m.side === 'a');
      expect(marks.map(m => m.turn), 'Aria Chen forged it on turn 1, then again on turn 2').toEqual([1, 2]);
      for (const [i, mark] of marks.entries()) {
        const key = markOf(page, mark.label);
        await key.click();
        const trace = traceOf(page, RATION);
        await expect(trace.getByRole('group', { name: `Attempt ${i + 1} of 2`, exact: true })).toBeVisible();
        await expectGridDimmedBeside(leftGrid(page), trace);
        await closeTrace(trace);
        await expect(key, 'Close returns focus to the mark').toBeFocused();
      }
    });
  });

  test('f10 q37: "Forged toolbox · 286" in FORGE mode opens the toolbox over the living grid', async ({ page, request }) => {
    test.setTimeout(300_000);
    for (const look of LOOKS) {
      await test.step(`the 24-actor run, 1440 in the ${look} look`, async () => {
        await openViz(page, request, RUNS.dozens, WIDTHS[1], look, 90_000);
        // The key stands in FORGE mode alone.
        await expect(page.getByRole('button', { name: /^Forged toolbox · / })).toHaveCount(0);
        await chooseForgeMode(page);
        const key = vizToolboxKey(page, DOZENS.tools);
        await expect(key).toBeVisible();
        await key.click();

        const toolbox = toolboxOf(page, DOZENS.tools);
        await expect(toolbox).toBeVisible();
        // The cohort's grids stand side by side under the toolbox, the first beside it under the dim.
        await expect(cohortGrids(page)).toHaveCount(24);
        await expectGridDimmedBeside(page.getByLabel('Living swarm grid for actor 1: Aria Chen'), toolbox);
        await picture(page, `1440-${look}-f10-viz-forge-toolbox`);

        await toolbox.getByRole('button', { name: 'Close the toolbox', exact: true }).click();
        await expect(toolbox).toBeHidden();
        await expect(key, 'Close returns focus to the key').toBeFocused();
      });
    }
  });

  test('f10 q5: a run with no forge opens an empty toolbox from FORGE mode', async ({ page, request }) => {
    await openViz(page, request, RUNS.noForgePair, { width: 1100, height: 900 }, 'dark', 60_000);
    await chooseForgeMode(page);
    const key = vizToolboxKey(page, 0);
    await expect(key).toBeVisible();
    await key.click();

    const toolbox = toolboxOf(page, 0);
    await expect(toolbox).toBeVisible();
    await expect(toolbox.getByText('No department forged a tool in this run.', { exact: true })).toBeVisible();
    const strip = toolbox.locator('[data-forge-strip="0"]');
    await expect(strip).toBeAttached();
    await expect(strip.locator('[data-cell]')).toHaveCount(0);
    await expectGridDimmedBeside(leftGrid(page), toolbox);
    await picture(page, '1100-dark-f10-viz-forge-toolbox-empty');
  });

  test('over the Viz tab, Space presses the forge view\'s keys', async ({ page, request }) => {
    test.setTimeout(180_000);
    await openViz(page, request, 'pair', WIDTHS[1], 'dark', 60_000);
    // FORGE mode's key opens the toolbox on Space, as any button does.
    await chooseForgeMode(page);
    const key = vizToolboxKey(page, 12);
    await key.focus();
    await page.keyboard.press('Space');
    const toolbox = toolboxOf(page, 12);
    await expect(toolbox, 'Space on the key opens the toolbox').toBeVisible();
    await toolbox.getByRole('button', { name: 'Close the toolbox', exact: true }).click();
    await expect(toolbox).toBeHidden();

    // A forge mark's trace: Space on a station's key opens that station.
    const mark = (await forgeMarks(page)).find(m => m.tool === RATION && m.side === 'a' && m.turn === 2);
    if (!mark) throw new Error('the event strip holds no mark of Aria Chen\'s second forge of water_ration_index');
    await markOf(page, mark.label).click();
    const trace = traceOf(page, RATION);
    await expect(trace).toBeVisible();
    const request1 = stationKey(trace, 'request');
    await expect(request1).toHaveAttribute('aria-expanded', 'false');
    await request1.focus();
    await page.keyboard.press('Space');
    await expect(request1, 'Space on the station\'s key opens it').toHaveAttribute('aria-expanded', 'true');
    await expect(request1).toBeFocused();
  });

  test('the living grids are all there with the dialogs open and after they close', async ({ page, request }) => {
    test.setTimeout(480_000);
    const runs = [
      { title: 'the pair run', run: 'pair', count: 2, tools: 12, timeout: 60_000,
        grids: () => page.getByRole('region', { name: /^(Aria Chen|Dietrich Voss) \S+ viz$/ }) },
      { title: 'the 24-actor run', run: RUNS.dozens, count: 24, tools: DOZENS.tools, timeout: 90_000, grids: () => cohortGrids(page) },
      { title: 'the 300-actor run', run: RUNS.maximum, count: 300, tools: MAXIMUM.tools, timeout: 150_000, grids: () => cohortGrids(page) },
    ];
    for (const { title, run, count, tools, timeout, grids } of runs) {
      await test.step(title, async () => {
        await openViz(page, request, run, WIDTHS[1], 'dark', timeout);
        // Each grid draws its population at a turn, with a dialog open and after it closes.
        const allThere = async () => {
          await expect(grids()).toHaveCount(count, { timeout });
          await expect(grids().first()).toBeInViewport();
          await expect(grids().first().getByRole('img', { name: /, turn \d+\. \d+ alive/ })).toBeVisible();
        };
        await allThere();

        const [mark] = await forgeMarks(page);
        if (!mark) throw new Error('the event strip holds no forge mark');
        await markOf(page, mark.label).click();
        const trace = traceOf(page, mark.tool);
        await expect(trace).toBeVisible();
        await allThere();
        await closeTrace(trace);
        await allThere();

        await chooseForgeMode(page);
        await vizToolboxKey(page, tools).click();
        const toolbox = toolboxOf(page, tools);
        await expect(toolbox).toBeVisible({ timeout: 30_000 });
        await allThere();
        await toolbox.getByRole('button', { name: 'Close the toolbox', exact: true }).click();
        await expect(toolbox).toBeHidden();
        await allThere();
      });
    }
  });
});

// ── Readability, one row and target sizes ─────────────────────────────────

/** The widths the readability figures are read at: the narrowest phone, a phone, a tablet and two desktops. */
const READ_WIDTHS = [320, 390, 768, 1100, 1440] as const;

/** A window of one width: a phone's height below 900 px, a desktop's from it. */
const sized = (width: number): Size => ({ width, height: width < FIGURES.desktopFrom ? 844 : 900 });

/** The header rows and rows of keys of the trace, the toolbox and the actor picker. */
const TRACE_HEADER = '[data-forge-header]';
const ATTEMPT_ROW = '[data-forge-head] > [role="group"]';
const RECORD_KEYS = '[data-record-panel] div:has(> button)';
const TOOLBOX_ROWS = ['[data-toolbox-header]', '[data-toolbox-lead]', '[data-toolbox-keys]'];
const PICKER_ROWS = ['div:has(> label > select)', '[data-picker-foot]'];

/**
 * Reads one surface's figures at one width: every word at its contrast and
 * size, every glyph and edge at 4.5:1, and every control at its size (44 px
 * tall below 900 px; from 900 px each key 32 px tall with 8 px to the next).
 * Each figure is a soft check, so one run names every figure a surface
 * misses.
 */
async function expectFigures(page: Page, root: Locator, where: string, width: number): Promise<void> {
  // The pointer rests off every control, so no key is read in its hover ground.
  await page.mouse.move(1, 1);
  await settle(root);
  const words = await measureText(page, root);
  expect.soft(words.length, `${where}: the surface has words to read`).toBeGreaterThan(0);
  expect.soft(failures(words).map(saidOf), `${where}: every word meets its contrast and size`).toEqual([]);
  const glyphs = await measureGlyphs(page, root);
  expect.soft(glyphs.length, `${where}: the surface has glyphs and edges to read`).toBeGreaterThan(0);
  expect.soft(
    glyphs.filter(g => g.ratio < FIGURES.glyphRatio).map(g => `${g.ratio}:1 ${g.selector}`),
    `${where}: every glyph and edge reads 4.5:1`,
  ).toEqual([]);
  expect.soft(targetFailures(await measureTargets(page, root), width), `${where}: every control's size`).toEqual([]);
}

/** Reads one surface's figures at each of the five widths, the window taking each width with the surface open. */
async function sweepFigures(page: Page, root: Locator, look: Look, where: string, slug: string): Promise<void> {
  for (const width of READ_WIDTHS) {
    await test.step(`${where} at ${width} in the ${look} look`, async () => {
      await page.setViewportSize(sized(width));
      await expect(root).toBeVisible();
      await expectFigures(page, root, `${look}, ${where}, ${width}`, width);
      if (width === 320 || width === 1440) await picture(page, `${width}-${look}-a14-${slug}`);
    });
  }
}

/**
 * At each sweep width: each named row is one row inside the surface and no
 * wider than itself, and neither the surface nor the page scrolls sideways.
 */
async function sweepRows(page: Page, root: Locator, look: Look, where: string, rows: string[]): Promise<void> {
  for (const width of SWEEP_WIDTHS) {
    await test.step(`${where} at ${width} in the ${look} look`, async () => {
      await page.setViewportSize({ width, height: 844 });
      await expect(root).toBeVisible();
      await settle(root);
      for (const row of await keyRows(root, rows)) {
        expect.soft(row.found, `${width}, ${where}: ${row.row} is drawn`).toBe(true);
        if (!row.found) continue;
        expect.soft(row.oneRow, `${width}, ${where}: ${row.row} is one row`).toBe(true);
        expect.soft(row.inside, `${width}, ${where}: ${row.row} stands inside the surface`).toBe(true);
        expect.soft(row.scroll, `${width}, ${where}: ${row.row} is no wider than itself`).toBeLessThanOrEqual(0);
      }
      const scroll = await root.evaluate(el => ({
        surface: el.scrollWidth - el.clientWidth,
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      expect.soft(scroll.surface, `${width}, ${where}: the surface does not scroll sideways`).toBeLessThanOrEqual(0);
      expect.soft(scroll.page, `${width}, ${where}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
    });
  }
}

/** A part whose words wrap inside its holder: no wider than itself, and inside the holder at its right. */
async function expectWrapsInside(part: Locator, holder: Locator, what: string): Promise<void> {
  const read = await part.evaluate((el, h) => ({
    scroll: el.scrollWidth - el.clientWidth,
    right: el.getBoundingClientRect().right,
    holder: (h as Element).getBoundingClientRect().right,
  }), await holder.elementHandle());
  expect.soft(read.scroll, `${what} wraps inside its own box`).toBeLessThanOrEqual(0);
  expect.soft(read.right, `${what} ends inside its holder`).toBeLessThanOrEqual(read.holder + 0.5);
}

test.describe('readability and one row', () => {
  // A figure read from the built page reads the same on every try; one retry is kept for a slow runner.
  test.describe.configure({ retries: 1 });

  test('the trace meets its readability figures and target sizes at 320, 390, 768, 1100 and 1440 in both looks', async ({ page, request }) => {
    test.setTimeout(360_000);
    for (const look of LOOKS) {
      await openPairSim(page, request, WIDTHS[0], look);
      await forgetOpenStations(page);

      // A passed tool with Open all.
      await pressInspect(inspectKey(page, LANDING));
      const landing = traceOf(page, LANDING, 1);
      await expect(landing).toBeVisible();
      await landing.getByRole('button', { name: 'Open all stations', exact: true }).click();
      await expectOpen(landing, { request: true, judge: true, added: true });
      await sweepFigures(page, landing, look, `${LANDING} with every station open`, 'trace-open-all');

      // The same tool with Record open.
      await page.setViewportSize(WIDTHS[0]);
      await openRecord(landing);
      await sweepFigures(page, landing, look, `${LANDING} with Record open`, 'trace-record');
      await closeTrace(landing);

      // A tool that did not pass, with the reason its forge recorded.
      await page.setViewportSize(WIDTHS[0]);
      await pressInspect(inspectKey(page, RADIATION));
      const radiation = traceOf(page, RADIATION);
      await expect(radiation.getByText(RADIATION_REASON)).toBeVisible();
      await sweepFigures(page, radiation, look, `${RADIATION}, which did not pass`, 'trace-did-not-pass');
      await closeTrace(radiation);

      // The re-forged tool at its attempt 1.
      await page.setViewportSize(WIDTHS[0]);
      await pressInspect(inspectKey(page, RATION).first());
      const ration = traceOf(page, RATION);
      await attemptKeys(ration).previous.click();
      await expect(attemptKeys(ration).line).toHaveText('Attempt 1 of 2');
      await sweepFigures(page, ration, look, `${RATION} at attempt 1`, 'trace-attempt-1');
      await closeTrace(ration);
    }
  });

  test('the pair\'s and the 24-actor run\'s toolbox and the actor picker meet their readability figures and target sizes at every width in both looks', async ({ page, request }) => {
    test.setTimeout(480_000);
    for (const look of LOOKS) {
      await openPairSim(page, request, WIDTHS[0], look);
      const pair = await openToolbox(page, 12);
      await sweepFigures(page, pair, look, 'the pair\'s toolbox', 'toolbox-pair');

      // The 24-actor run, grouped by actor, with A1's fold open.
      const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, WIDTHS[0], look, 60_000);
      await expect(groupKey(toolbox)).toHaveAccessibleName('Group: Actor');
      const a1 = foldHead(toolbox, 'A1').getByRole('button');
      await a1.click();
      await expect(a1).toHaveAttribute('aria-expanded', 'true');
      await sweepFigures(page, toolbox, look, 'the 24-actor toolbox with A1\'s fold open', 'toolbox-24-a1-open');

      // The actor picker open over it.
      await page.setViewportSize(WIDTHS[0]);
      const picker = await openPicker(page, toolbox);
      await sweepFigures(page, picker, look, 'the actor picker of the 24-actor run', 'picker-24');
    }
  });

  test('the 300-actor toolbox scrolled to its end meets its readability figures and target sizes at every width in both looks', async ({ page, request }) => {
    test.setTimeout(600_000);
    for (const look of LOOKS) {
      const toolbox = await openCohortToolbox(page, request, RUNS.maximum, MAXIMUM.tools, WIDTHS[1], look, 150_000);
      await expect(toolbox.locator('[data-toolbox-rows]')).toHaveAttribute('data-line-count', '300', { timeout: 60_000 });
      for (const width of READ_WIDTHS) {
        await test.step(`the 300-actor toolbox at its end at ${width} in the ${look} look`, async () => {
          await page.setViewportSize(sized(width));
          await expect(toolbox).toBeVisible();
          // The list's last line is A300's head.
          const last = await readLinesFrom(toolbox, 'end', 1);
          expect(last.map(line => line.name)).toEqual(['A300']);
          await expectFigures(page, toolbox, `${look}, the 300-actor toolbox at its end, ${width}`, width);
          if (width === 320 || width === 1440) await picture(page, `${width}-${look}-a14-toolbox-300-end`);
        });
      }
    }
  });

  test('at 1440 the pair\'s toolbox opens on at most 15 controls, 5 text styles, 12 rules and boxes and 8 colours, in both looks', async ({ page, request }) => {
    test.setTimeout(180_000);
    for (const look of LOOKS) {
      await test.step(`1440 in the ${look} look`, async () => {
        await openPairSim(page, request, WIDTHS[1], look);
        const toolbox = await openToolbox(page, 12);
        await page.mouse.move(1, 1);
        await settle(toolbox);
        const first = await firstScreen(page, toolbox);
        expect.soft(first.controls, `${look}: the first screen's controls: ${first.detail.controls.join('; ')}`).toBeLessThanOrEqual(15);
        expect.soft(first.textStyles, `${look}: the first screen's text styles: ${first.detail.textStyles.join('; ')}`).toBeLessThanOrEqual(5);
        expect.soft(first.rulesAndBoxes, `${look}: the first screen's rules and boxes: ${first.detail.rulesAndBoxes.join('; ')}`).toBeLessThanOrEqual(12);
        expect.soft(first.colours, `${look}: the first screen's colours: ${first.detail.colours.join('; ')}`).toBeLessThanOrEqual(8);
        await picture(page, `1440-${look}-a14-first-screen`);
      });
    }
  });

  test('every header row and row of keys is one row at 320, 360, 390, 430, 480 and 768 with the 120-character name and every station open, and nothing scrolls sideways', async ({ page, request }) => {
    test.setTimeout(360_000);
    for (const look of LOOKS) {
      await openPairSim(page, request, WIDTHS[0], look);
      await forgetOpenStations(page);

      // The 120-character name's trace with every station open and Record open (Review Focus 5; feature 12's QA 7).
      await pressInspect(inspectKey(page, LONG_NAME));
      const long = traceOf(page, LONG_NAME);
      await expect(long).toBeVisible();
      await long.getByRole('button', { name: 'Open all stations', exact: true }).click();
      await expectOpen(long, { request: true, judge: true, added: true });
      await openRecord(long);
      await sweepRows(page, long, look, 'the 120-character name\'s trace', [TRACE_HEADER, RECORD_KEYS]);
      for (const width of SWEEP_WIDTHS) {
        await page.setViewportSize({ width, height: 844 });
        await expectWrapsInside(long.locator('[data-forge-head] h2'), long, `${width}, ${look}: the 120-character name in the trace`);
      }
      await picture(page, `768-${look}-a14-long-name-trace`);
      await closeTrace(long);

      // The re-forged tool's attempt row, at its attempt 1.
      await page.setViewportSize(WIDTHS[0]);
      await pressInspect(inspectKey(page, RATION).first());
      const ration = traceOf(page, RATION);
      await attemptKeys(ration).previous.click();
      await expect(attemptKeys(ration).line).toHaveText('Attempt 1 of 2');
      await sweepRows(page, ration, look, `${RATION}'s trace at attempt 1`, [TRACE_HEADER, ATTEMPT_ROW]);
      await closeTrace(ration);

      // The pair's toolbox, with the 120-character name in its row.
      await page.setViewportSize(WIDTHS[0]);
      const toolbox = await openToolbox(page, 12);
      await sweepRows(page, toolbox, look, 'the pair\'s toolbox', TOOLBOX_ROWS);
      const longRow = rowOf(toolbox, LONG_NAME);
      for (const width of SWEEP_WIDTHS) {
        await page.setViewportSize({ width, height: 844 });
        await expectWrapsInside(longRow.locator('[data-row-name]'), longRow, `${width}, ${look}: the 120-character name in its row`);
      }
      await picture(page, `320-${look}-a14-long-name-row`);

      // The pair's actor picker: its top row and its foot.
      await page.setViewportSize(WIDTHS[0]);
      const picker = await openPicker(page, toolbox);
      await sweepRows(page, picker, look, 'the pair\'s actor picker', PICKER_ROWS);
      await page.keyboard.press('Escape');
      await expect(picker).toBeHidden();
    }
  });

  test('with the text spacing of WCAG 1.4.12 nothing is cut or overlaps, and the header rows keep their keys on one row', async ({ page, request }) => {
    test.setTimeout(240_000);
    for (const look of LOOKS) {
      await openPairSim(page, request, WIDTHS[0], look);
      await forgetOpenStations(page);
      await page.addStyleTag({ content: TEXT_SPACING });

      const spaced = async (root: Locator, where: string, rows: string[]) => {
        for (const width of [320, 390, 1440]) {
          await test.step(`${where} at ${width} in the ${look} look`, async () => {
            await page.setViewportSize(sized(width));
            await expect(root).toBeVisible();
            await settle(root);
            // Read from the surface's top, where its fixed header row covers nothing.
            await root.evaluate((el) => { el.scrollTop = 0; });
            const faults = await spacingFaults(root);
            expect.soft(faults.cut, `${width}, ${look}, ${where}: no word is cut`).toEqual([]);
            expect.soft(faults.overlaps, `${width}, ${look}, ${where}: no word overlaps another`).toEqual([]);
            for (const row of await keyRows(root, rows)) {
              expect.soft(row.found && row.oneRow && row.inside, `${width}, ${look}, ${where}: ${row.row} keeps its keys on one row`).toBe(true);
            }
            if (width === 320) await picture(page, `320-${look}-a14-text-spacing-${where.startsWith('the trace') ? 'trace' : 'toolbox'}`);
          });
        }
      };

      await pressInspect(inspectKey(page, LONG_NAME));
      const long = traceOf(page, LONG_NAME);
      await expect(long).toBeVisible();
      await long.getByRole('button', { name: 'Open all stations', exact: true }).click();
      await expectOpen(long, { request: true, judge: true, added: true });
      await spaced(long, 'the trace of the 120-character name with every station open', [TRACE_HEADER]);
      await closeTrace(long);

      await page.setViewportSize(WIDTHS[0]);
      const toolbox = await openToolbox(page, 12);
      await spaced(toolbox, 'the pair\'s toolbox', ['[data-toolbox-header]']);
    }
  });
});

// ── Component captures ────────────────────────────────────────────────────

/** Where the component captures go: the pictures of the built screens, beside before/ from the screens they replace. */
const AFTER = 'after';

/** Rests the pointer off every control, so no key is drawn under it. */
const restPointer = (page: Page) => page.mouse.move(1, 1);

/**
 * Saves one component capture: a picture of the window as it stands, and
 * beside it the place of every line of words the surface shows, in per cent
 * of the window, with the size and contrast the page computes for it. A
 * reader of the picture's pixels boxes each line where it stands.
 */
async function capture(page: Page, surface: Locator, name: string): Promise<void> {
  await settle(surface);
  await picture(page, `${AFTER}/${name}`);
  writeFileSync(`${PICTURES}/${AFTER}/${name}.words.json`, `${JSON.stringify(await wordBoxes(surface))}\n`);
}

/** Scrolls a trace, which scrolls inside its own dialog, back to its top. */
const toTop = (surface: Locator) => surface.evaluate((el) => { el.scrollTop = 0; });

test.describe('component captures', () => {
  // Pictures of the built page, with no assertion beyond reaching each state; one retry is kept for a slow runner.
  test.describe.configure({ retries: 1 });

  test('the pair\'s toolbox and a tool\'s trace in each of its states, at a phone and a desktop in both looks', async ({ page, request }) => {
    test.setTimeout(360_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        const at = `${size.width}-${look}`;
        await openPairSim(page, request, size, look);
        await forgetOpenStations(page);

        // The toolbox, as the Sim footer opens it.
        const toolbox = await openToolbox(page, 12);
        await restPointer(page);
        await capture(page, toolbox, `${at}-toolbox`);
        await toolbox.getByRole('button', { name: 'Close the toolbox', exact: true }).click();
        await expect(toolbox).toBeHidden();

        // A passed tool's trace as it opens: its deciding station open, the others closed to one line.
        await pressInspect(inspectKey(page, LANDING));
        const landing = traceOf(page, LANDING, 1);
        await expect(landing).toBeVisible();
        await restPointer(page);
        await capture(page, landing, `${at}-trace-passed`);

        // Record open, its key at the top of what the trace shows.
        await openRecord(landing);
        await recordKey(landing).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await restPointer(page);
        await capture(page, landing, `${at}-trace-record`);
        await recordKey(landing).click();
        await expect(recordKey(landing)).toHaveAttribute('aria-expanded', 'false');

        // The same trace with every station open.
        await landing.getByRole('button', { name: 'Open all stations', exact: true }).click();
        await expectOpen(landing, { request: true, judge: true, added: true });
        await toTop(landing);
        await restPointer(page);
        await capture(page, landing, `${at}-trace-open-all`);

        // A fresh page, so the stations opened above are not kept open on the next tools.
        await openPairSim(page, request, size, look);
        await forgetOpenStations(page);

        // A tool that did not pass, with the reason its forge recorded.
        await pressInspect(inspectKey(page, RADIATION));
        const radiation = traceOf(page, RADIATION);
        await expect(radiation.getByText(RADIATION_REASON)).toBeVisible();
        await restPointer(page);
        await capture(page, radiation, `${at}-trace-did-not-pass`);
        await closeTrace(radiation);

        // The tool forged twice: its latest attempt with the spur of attempt 1, then attempt 1 with its branch to attempt 2.
        await pressInspect(inspectKey(page, RATION).first());
        const ration = traceOf(page, RATION);
        await expect(attemptKeys(ration).line).toHaveText('2 of 2');
        await restPointer(page);
        await capture(page, ration, `${at}-trace-spur`);
        await attemptKeys(ration).previous.click();
        await expect(attemptKeys(ration).line).toHaveText('Attempt 1 of 2');
        // The branch leaves the line after Request's evidence: on a phone it is brought into view.
        await toTop(ration);
        await stationOf(ration, 'request').getByRole('link', { name: 'Attempt 2 · Passed', exact: true }).scrollIntoViewIfNeeded();
        await restPointer(page);
        await capture(page, ration, `${at}-trace-branch`);
      });
    }
  });

  test('a station\'s key at rest, under the pointer, pressed and focused, and an inactive station, at a phone and a desktop in both looks', async ({ page, request }) => {
    test.setTimeout(240_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        const at = `${size.width}-${look}`;
        await openPairSim(page, request, size, look);
        await forgetOpenStations(page);
        // Dietrich Voss's passed tool: Judge opens with it, Request and Added have evidence to open, Code and Tests have none.
        await pressInspect(inspectKey(page, OXYGEN));
        const trace = traceOf(page, OXYGEN);
        await expect(trace).toBeVisible();
        const key = stationKey(trace, 'request');
        await expect(key).toHaveAttribute('aria-expanded', 'false');

        // At rest.
        await restPointer(page);
        await capture(page, trace, `${at}-keys-rest`);

        // Under the pointer.
        await key.hover();
        await capture(page, trace, `${at}-keys-hover`);

        // An inactive station, with the pointer on it: Code has nothing to open on the run's record.
        const code = stationKey(trace, 'code');
        await expect(code).toHaveAttribute('aria-disabled', 'true');
        await code.hover();
        await capture(page, trace, `${at}-keys-inactive`);

        // Pressed: the pointer held down on the key, then let go off it, on the outcome sentence, so the press opens nothing.
        // It comes before the keyboard's focus, so the pressed key carries no focus ring.
        await key.hover();
        await page.mouse.down();
        await capture(page, trace, `${at}-keys-pressed`);
        await trace.locator('[data-forge-outcome]').hover();
        await page.mouse.up();
        await expect(key).toHaveAttribute('aria-expanded', 'false');

        // Focused from the keyboard: Shift+Tab and Tab leave and come back to the key.
        await key.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(key).toBeFocused();
        await restPointer(page);
        await capture(page, trace, `${at}-keys-focus`);
      });
    }
  });

  test('the 24-actor toolbox grouped with a fold open, and its actor picker open, at a phone and a desktop in both looks', async ({ page, request }) => {
    test.setTimeout(360_000);
    for (const { size, look } of WALKS) {
      await test.step(`${size.width} in the ${look} look`, async () => {
        const at = `${size.width}-${look}`;
        const toolbox = await openCohortToolbox(page, request, RUNS.dozens, DOZENS.tools, size, look, 60_000);
        await expect(groupKey(toolbox)).toHaveAccessibleName('Group: Actor');
        const a1 = foldHead(toolbox, 'A1').getByRole('button');
        await a1.click();
        await expect(a1).toHaveAttribute('aria-expanded', 'true');
        await restPointer(page);
        await capture(page, toolbox, `${at}-toolbox-24-fold-open`);

        // The picker opens inside the toolbox: a sheet on a phone, a popover under its key on a desktop.
        await openPicker(page, toolbox);
        await restPointer(page);
        await capture(page, toolbox, `${at}-picker-24`);
      });
    }
  });

  test('the 300-actor toolbox scrolled to its end, at a desktop and a phone in both looks', async ({ page, request }) => {
    test.setTimeout(600_000);
    for (const look of LOOKS) {
      // A run of this size plays in once a look, at the desktop's width; the window then takes the phone's with the toolbox open.
      const toolbox = await openCohortToolbox(page, request, RUNS.maximum, MAXIMUM.tools, WIDTHS[1], look, 150_000);
      await expect(toolbox.locator('[data-toolbox-rows]')).toHaveAttribute('data-line-count', '300', { timeout: 60_000 });
      for (const size of [WIDTHS[1], WIDTHS[0]]) {
        await test.step(`${size.width} in the ${look} look`, async () => {
          await page.setViewportSize(size);
          await expect(toolbox).toBeVisible();
          // The list's last line is A300's head: reading it scrolls the list to its end.
          await readLinesFrom(toolbox, 'end', 1);
          await restPointer(page);
          await capture(page, toolbox, `${size.width}-${look}-toolbox-300-end`);
        });
      }
    }
  });
});
