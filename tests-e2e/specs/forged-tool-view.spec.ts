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
 * - Before: pictures of the forged toolbox as it is, at 390 and 1440 in
 *   both looks.
 * - The forge view's tokens: the quiet tone, the edge tone, the problem
 *   colour and the three text sizes hold their values in both looks, and
 *   --rust keeps its own.
 * - Feature 1 on the run's record: a forge card's INSPECT key opens the
 *   tool's trace, a dialog with the tool's outcome in one sentence over its
 *   line of five stations. Each test walks a phone and a desktop in both
 *   looks and is named for the step of the feature it proves.
 *
 * Each picture is saved into test-pictures/forged-tool-view/, which CI uploads.
 */
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  COHORT_SERVER, LOOKS, PAIR_SERVER, PICTURES, RUNS, SWEEP_WIDTHS, WIDTHS,
  pairSessionId, replayUrl, sessionIdByName, useLook, type Look,
} from '../support/forge-view-pages.js';

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
        await expect(passed.locator('[data-station="judge"]')).toContainText('Approved · confidence 0.98 out of 1');
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

for (const size of WIDTHS) {
  for (const look of LOOKS) {
    test.describe(`before: today's screens at ${size.width} in the ${look} look`, () => {
      test.use({ viewport: size });

      test('the Sim footer\'s forged toolbox', async ({ page, request }) => {
        const id = await pairSessionId(request);
        await useLook(page, look);
        await page.goto(replayUrl(PAIR_SERVER, id, 'sim'));
        await page.getByRole('button', { name: /^Open Forged Toolbox/ }).click();
        const toolbox = page.getByRole('dialog', { name: /^Forged Toolbox/ });
        await expect(toolbox.getByText(LAST_TOOL).first()).toBeVisible();
        await page.screenshot({ path: `${PICTURES}/before/${size.width}-${look}-toolbox.png` });
      });
    });
  }
}
