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
 * - Before: pictures of the forged toolbox and of a forged tool's dialog as
 *   they are, at 390 and 1440 in both looks.
 * - The forge view's tokens: the quiet tone, the edge tone, the problem
 *   colour and the three text sizes hold their values in both looks, and
 *   --rust keeps its own.
 *
 * Each picture is saved into test-pictures/forged-tool-view/, which CI uploads.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  COHORT_SERVER, LOOKS, PAIR_SERVER, PICTURES, RUNS, WIDTHS,
  pairSessionId, replayUrl, sessionIdByName, useLook,
} from '../support/forge-view-pages.js';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stored runs live on local servers of their own.');

test.use({ deviceScaleFactor: 2 });

const LANDING = 'mars_landing_site_score';
/** The last tool of the pair run's stream: it is on the page once the replay has played in. */
const LAST_TOOL = 'rover_route_planner';

/** One column of the Viz tab's cohort view: an actor's living grid under its name. */
const cohortGrids = (page: Page) => page.getByLabel(/^Living swarm grid for actor \d+: /);

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

      test('the INSPECT dialog of a forged tool', async ({ page, request }) => {
        const id = await pairSessionId(request);
        await useLook(page, look);
        await page.goto(replayUrl(PAIR_SERVER, id, 'sim'));
        await expect(page.getByText(LAST_TOOL).first()).toBeAttached();
        // The key sits in the tool's forge card, a fold that opens on its summary row.
        const inspect = page.locator(`button[aria-label="Inspect forged tool ${LANDING}"]`);
        const summary = inspect.locator('..').locator('summary').first();
        await summary.scrollIntoViewIfNeeded();
        if (!(await inspect.isVisible())) await summary.click();
        await inspect.click();
        await expect(page.getByRole('dialog', { name: `Tool detail · ${LANDING}` })).toBeVisible();
        await page.screenshot({ path: `${PICTURES}/before/${size.width}-${look}-inspect.png` });
      });
    });
  }
}
