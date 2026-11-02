/**
 * A Digital Twin run's events reach the page that ran it.
 *
 * The route forwarded each engine event under its own type name, which the
 * dashboard's one EventSource has no listener for, so the progress view read
 * "Waiting for the first server event..." until the response came back, and
 * the result's playback had nothing to walk. And the run is in
 * t2d-glp1-protocol while the page is on its own scenario, so the live feed's
 * scenario check would skip those events once they arrived.
 *
 * The first tests talk to the real server, over HTTP and SSE, with its engine
 * stubbed (tests-e2e/support/digital-twin-server.ts). The page's request stays
 * open until the test answers it: the server has finished by then, so what the
 * progress view shows came over /events and nowhere else. That server holds
 * one run at a time, so the tests run in order.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { TWIN_ENGINE_ERROR, TWIN_ENGINE_FAILS, twinArtifact, twinEvents, twinRows } from '../support/digital-twin-run.js';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stub engine runs on a local server of its own.');
test.use({ baseURL: 'http://127.0.0.1:3457' });
test.describe.configure({ mode: 'default' });

const TWIN_ROUTE = '**/api/quickstart/simulate-intervention';
const LEADER = 'Cautious Methodical Evaluator';
const ROWS = twinRows(twinEvents(LEADER));

const running = (page: Page) => page.getByRole('heading', { name: /Digital Twin · Running/ });
const result = (page: Page) => page.getByRole('heading', { name: 'Digital Twin · Intervention Result' });
const playback = (page: Page, position: number) => page.getByRole('heading', { name: `Playback · ${position} / ${ROWS} events` });
const dismiss = (page: Page) => page.getByRole('button', { name: 'Clear · run another' });
const emptyStateRun = (page: Page) => page.getByRole('button', { name: /^(Run Simulation|Loading scenario)/ });
const finishedRun = (page: Page) => page.getByText('Spin up a new run');
const stat = (page: Page, label: string) => page.locator('[class*="statsBar"]').getByText(label, { exact: true }).locator('xpath=..');

/** Opens the Digital Twin card and presses Run on its first preset. */
async function startRun(page: Page): Promise<void> {
  await page.goto('/sim?tab=quickstart');
  await page.getByRole('button', { name: 'Patient · treatment' }).click();
  await page.getByRole('button', { name: 'Run digital twin' }).click();
}

/** Lets the request through to the server and holds its answer from the page until the returned function is called. */
async function holdAnswer(page: Page): Promise<() => void> {
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.route(TWIN_ROUTE, async route => {
    const answer = await route.fetch();
    await released;
    await route.fulfill({ response: answer });
  });
  return release;
}

async function expectProgressOfWholeRun(page: Page): Promise<void> {
  await expect(running(page)).toBeVisible();
  await expect(stat(page, 'Turn')).toContainText('2 / 2');
  await expect(stat(page, 'LLM Calls')).toContainText('18');
  await expect(stat(page, 'Cost')).toContainText('$0.0180');
  await expect(stat(page, 'Tools forged')).toContainText('1');
  await expect(stat(page, 'Citations')).toContainText('2');
  await expect(page.getByText(`${ROWS} events`, { exact: true })).toBeVisible();
  await expect(page.getByText('Waiting for the first server event')).toHaveCount(0);
  await expect(page.getByText('Turn 2: HbA1c is falling.')).toBeVisible();
}

test.describe('Digital Twin events @twin', () => {
  test.beforeEach(async ({ request }) => {
    expect((await request.post('/clear')).ok()).toBe(true);
  });

  test('the page that ran it, on another scenario, counts the events as they arrive and plays them back', async ({ page }) => {
    const release = await holdAnswer(page);
    await startRun(page);
    await expectProgressOfWholeRun(page);

    release();
    await expect(result(page)).toBeVisible();
    await expect(playback(page, ROWS)).toBeVisible();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(playback(page, 0)).toBeVisible();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(playback(page, 1)).toBeVisible();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();

    // The run is not this page's scenario's: it goes in no history of it.
    expect(await page.evaluate(() => sessionStorage.getItem('paracosm:lastCachedRunFingerprint'))).toBeNull();

    // Clearing the result leaves the page as it was before the run.
    await dismiss(page).click();
    await expect(result(page)).toHaveCount(0);
    await expect(emptyStateRun(page)).toBeVisible();
    await expect(finishedRun(page)).toHaveCount(0);
  });

  test('a page that did not run it stays without it', async ({ page, browser, baseURL }) => {
    const other = await browser.newContext({ baseURL });
    try {
      const otherPage = await other.newPage();
      await otherPage.goto('/sim?tab=sim');
      await expect(emptyStateRun(otherPage)).toBeVisible();

      const release = await holdAnswer(page);
      await startRun(page);
      await expectProgressOfWholeRun(page);
      release();
      await expect(playback(page, ROWS)).toBeVisible();

      await expect(emptyStateRun(otherPage)).toBeVisible();
      await expect(finishedRun(otherPage)).toHaveCount(0);
      await otherPage.reload();
      await expect(emptyStateRun(otherPage)).toBeVisible();
      await expect(finishedRun(otherPage)).toHaveCount(0);
    } finally {
      await other.close();
    }
  });

  test('a run that fails ends the progress view and says why', async ({ page }) => {
    await page.route(TWIN_ROUTE, (route: Route) => {
      const body = route.request().postDataJSON() as { subject: Record<string, unknown> };
      return route.continue({ postData: JSON.stringify({ ...body, subject: { ...body.subject, id: TWIN_ENGINE_FAILS } }) });
    });
    await startRun(page);
    await expect(page.getByText(TWIN_ENGINE_ERROR).filter({ visible: true }).first()).toBeVisible();
    await expect(running(page)).toHaveCount(0);
    await expect(emptyStateRun(page)).toBeVisible();
  });

  for (const scenarioId of ['t2d-glp1-protocol', 'mars-genesis']) {
    test(`a page that reconnects during its run in ${scenarioId} counts each event once`, async ({ page }) => {
      // The stream ends after its replay, so the page reconnects about every
      // half second and is handed the whole run each time, as a dropped
      // connection is. The answer comes from here, so no run starts.
      const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      let body = sse('connected', {}) + sse('replay_done', {});
      let served = 0;
      await page.route('**/events', route => {
        served += 1;
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
      });
      let release = () => {};
      const released = new Promise<void>(resolve => { release = resolve; });
      await page.route(TWIN_ROUTE, async route => {
        const request = route.request().postDataJSON() as { subject: unknown; intervention: unknown; runKey?: string };
        body = [
          sse('connected', {}),
          sse('active_scenario', { id: scenarioId, name: scenarioId, runKey: request.runKey, forkedFrom: null }),
          sse('status', { phase: 'parallel', maxTurns: 2, actors: [{ name: LEADER, archetype: 'The Methodical Evaluator' }] }),
          ...twinEvents(LEADER).map(event => sse('sim', event)),
          sse('complete', {}),
          sse('replay_done', {}),
        ].join('');
        await released;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ artifact: twinArtifact(request.subject, request.intervention), durationMs: 1 }) });
      });

      await startRun(page);
      await expectProgressOfWholeRun(page);
      const seen = served;
      await expect.poll(() => served).toBeGreaterThan(seen + 2);
      await expectProgressOfWholeRun(page);

      release();
      await expect(playback(page, ROWS)).toBeVisible();

      // After the result is cleared, a run in the page's own scenario stays
      // as any run the feed delivered; a run in another one goes.
      await dismiss(page).click();
      await expect(result(page)).toHaveCount(0);
      if (scenarioId === 'mars-genesis') {
        await expect(finishedRun(page)).toBeVisible();
      } else {
        const cleared = served;
        await expect.poll(() => served).toBeGreaterThan(cleared + 1);
        await expect(finishedRun(page)).toHaveCount(0);
        await expect(page.getByText('Week 8 labs')).toHaveCount(0);
      }
    });
  }
});
