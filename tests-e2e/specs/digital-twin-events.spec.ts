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
 *
 * A run started from the Run tab's Start replaces the Digital Twin views:
 * the page opens the run on the Sim tab. The result panel and the progress
 * view once stayed on the SIM tab over a new run, and a twin's answer that
 * came back after the page left it brought the panel back. A run the server
 * refuses replaces nothing, and a run loaded from a file or a clear of the
 * page's local data replaces the views as a new run does.
 *
 * Delete server data drops every finished run the server holds and tells the
 * pages showing one. A finished twin's result is such a view, so it empties
 * too: the server holds nothing of that run to show again.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { openTab } from '../support/frame.js';
import { TWIN_ENGINE_ERROR, TWIN_ENGINE_FAILS, TWIN_ENGINE_FALLBACK, TWIN_ENGINE_SLOW, twinArtifact, twinEvents, twinRows } from '../support/digital-twin-run.js';
import { noRunOnPage, pressStart } from '../support/start-run.js';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stub engine runs on a local server of its own.');
test.use({ baseURL: 'http://127.0.0.1:3457' });
test.describe.configure({ mode: 'default' });

const TWIN_ROUTE = '**/api/quickstart/simulate-intervention';
/** The token tests-e2e/support/digital-twin-server.ts starts with; it guards temporary folders only. */
const ADMIN_TOKEN = 'e2e-twin-admin-token';
const ADMIN_TOKEN_KEY = 'paracosm:adminToken';
const LEADER = 'Cautious Methodical Evaluator';
const ROWS = twinRows(twinEvents(LEADER));

const running = (page: Page) => page.getByRole('heading', { name: /Digital Twin · Running/ });
const result = (page: Page) => page.getByRole('heading', { name: 'Digital Twin · Intervention Result' });
const playback = (page: Page, position: number) => page.getByRole('heading', { name: `Playback · ${position} / ${ROWS} events` });
const dismiss = (page: Page) => page.getByRole('button', { name: 'Clear · run another' });
const finishedRun = (page: Page) => page.getByText('Spin up a new run');
const pairRunning = (page: Page) => page.getByRole('status', { name: /^Simulation status: Running\./ });
/** What the Run tab says above Start when the server refuses the run. */
const RUN_DID_NOT_START = 'The run did not start. Press Start again.';
const stat = (page: Page, label: string) => page.locator('[class*="statsBar"]').getByText(label, { exact: true }).locator('xpath=..');

/** Opens the Digital Twin card and presses Run on its first preset. */
async function startRun(page: Page): Promise<void> {
  await page.goto('/sim?tab=quickstart');
  await page.getByRole('button', { name: 'Patient · treatment' }).click();
  await page.getByRole('button', { name: 'Run digital twin' }).click();
}

/**
 * Lets the request through to the server and holds its answer from the page
 * until the returned function is called. With `subjectId`, the request runs
 * that subject instead of the preset's.
 */
async function holdAnswer(page: Page, subjectId?: string): Promise<() => void> {
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.route(TWIN_ROUTE, async route => {
    const body = route.request().postDataJSON() as { subject: Record<string, unknown> };
    const answer = await route.fetch(subjectId
      ? { postData: JSON.stringify({ ...body, subject: { ...body.subject, id: subjectId } }) }
      : undefined);
    await released;
    // A page that has left for a run it started has dropped the request.
    await route.fulfill({ response: answer }).catch(() => undefined);
  });
  return release;
}

/** A run saved from the page, in the shape the Save action writes: one leader's finished turn. */
function savedRun(): { name: string; mimeType: string; buffer: Buffer } {
  const leader = 'Saved Leader';
  const events = [
    { type: 'status', leader: '', data: { phase: 'parallel', maxTurns: 1, actors: [{ name: leader, archetype: 'The Saver' }] } },
    ...twinEvents(leader, 1),
  ];
  const save = {
    config: null,
    events,
    results: [],
    verdict: null,
    startedAt: '2026-11-03T00:00:00.000Z',
    completedAt: '2026-11-03T00:01:00.000Z',
    schemaVersion: 3,
  };
  return { name: 'mars-saved-run.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(save)) };
}

/**
 * Answers every /setup as the server answers a visitor who has used the
 * day's run (the /setup rate limit in src/server/server-app.ts): no run
 * starts.
 */
async function refuseRuns(page: Page): Promise<void> {
  await page.route('**/setup', route => route.fulfill({
    status: 429,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Rate limit exceeded. Maximum 1 simulations per day. Add your own API keys in Settings to remove this limit.', limit: 1, remaining: 0 }),
  }));
}

/**
 * Waits until the Digital Twin card has handled its answer: it hands the
 * result or the failure to the page, then shows its Run button again. The
 * card sits on the Quickstart tab, hidden while the SIM tab is open.
 */
async function twinAnswerHandled(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Run digital twin', includeHidden: true })).toHaveCount(1);
}

/** Starts a pair run from the Run tab's Start; the page opens the run on the Sim tab. */
async function startPairRun(page: Page): Promise<void> {
  await pressStart(page);
  await expect(page).toHaveURL(/[?&]tab=sim\b/);
}

/** Loads a saved run from a file through Studio, taking whatever the page shows. */
async function loadSavedRun(page: Page): Promise<void> {
  await openTab(page, 'studio');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open a run file', exact: true }).click();
  await (await chooser).setFiles(savedRun());
  await page.getByRole('button', { name: /^(Load|Replace current simulation)$/ }).click();
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
    // A screen reader reads changes to a live region it already holds, not
    // the words of one that arrives with them: the turn's region must be in
    // the page, empty, before the first turn.
    await page.addInitScript(() => {
      const w = window as Window & { addedWithTurn?: boolean };
      w.addedWithTurn = false;
      new MutationObserver(records => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            if (!(node instanceof Element)) continue;
            const regions = [node, ...Array.from(node.querySelectorAll('[aria-live="polite"]'))]
              .filter(el => el.getAttribute('aria-live') === 'polite');
            if (regions.some(el => /^Turn \d+ of \d+$/.test(el.textContent ?? ''))) w.addedWithTurn = true;
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    const release = await holdAnswer(page);
    await startRun(page);
    await expectProgressOfWholeRun(page);
    // The run's status bar follows the twin's turns, and reads each one aloud.
    const status = page.getByRole('region', { name: 'Run status' });
    await expect(status.getByRole('progressbar', { name: 'Simulation progress, turn 2 of 2' })).toHaveCount(1);
    await expect(status.locator('[aria-live="polite"]').filter({ hasText: /^Turn 2 of 2$/ })).toHaveCount(1);
    expect(await page.evaluate(() => (window as Window & { addedWithTurn?: boolean }).addedWithTurn)).toBe(false);
    // Its spend is the twin's too: the page's own scenario ran nothing.
    await expect(status).toContainText(/\d+k tokens/);

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
    await expect(noRunOnPage(page)).toBeVisible();
    await expect(finishedRun(page)).toHaveCount(0);
  });

  test('the run status bar counts the twin\'s own validation fallbacks on another scenario', async ({ page }) => {
    const release = await holdAnswer(page, TWIN_ENGINE_FALLBACK);
    await startRun(page);
    await expect(running(page)).toBeVisible();
    const status = page.getByRole('region', { name: 'Run status' });
    await expect(status.getByRole('progressbar', { name: 'Simulation progress, turn 2 of 2' })).toHaveCount(1);
    await expect(status.getByLabel('1 validation fallback', { exact: true })).toBeVisible();
    release();
    await expect(result(page)).toBeVisible();
    await expect(status.getByLabel('1 validation fallback', { exact: true })).toBeVisible();
  });

  test('a page that did not run it stays without it', async ({ page, browser, baseURL }) => {
    const other = await browser.newContext({ baseURL });
    try {
      const otherPage = await other.newPage();
      await otherPage.goto('/sim?tab=sim');
      await expect(noRunOnPage(otherPage)).toBeVisible();

      const release = await holdAnswer(page);
      await startRun(page);
      await expectProgressOfWholeRun(page);
      release();
      await expect(playback(page, ROWS)).toBeVisible();

      await expect(noRunOnPage(otherPage)).toBeVisible();
      await expect(finishedRun(otherPage)).toHaveCount(0);
      await otherPage.reload();
      await expect(noRunOnPage(otherPage)).toBeVisible();
      await expect(finishedRun(otherPage)).toHaveCount(0);
    } finally {
      await other.close();
    }
  });

  test('a run started with Start replaces the result', async ({ page }) => {
    await startRun(page);
    await expect(result(page)).toBeVisible();
    await expect(playback(page, ROWS)).toBeVisible();

    await startPairRun(page);
    await expect(pairRunning(page)).toBeVisible();
    await expect(result(page)).toHaveCount(0);
    await expect(running(page)).toHaveCount(0);
    await expect(page.getByText(/^Turn 1 \/ \d+$/)).toBeVisible();
  });

  test('a run started during the twin\'s run replaces its progress', async ({ page }) => {
    const release = await holdAnswer(page);
    await startRun(page);
    await expectProgressOfWholeRun(page);

    // The page leaves for the run it started, and with it the twin's request.
    await startPairRun(page);
    await expect(pairRunning(page)).toBeVisible();
    await expect(running(page)).toHaveCount(0);

    release();
    await expect(result(page)).toHaveCount(0);
    await expect(running(page)).toHaveCount(0);
    await expect(pairRunning(page)).toBeVisible();
    await expect(page.getByText(/^Turn 1 \/ \d+$/)).toBeVisible();
  });

  test('a run the server refuses leaves the twin\'s progress as it was, and the twin\'s answer still lands', async ({ page }) => {
    await refuseRuns(page);
    const release = await holdAnswer(page);
    await startRun(page);
    await expectProgressOfWholeRun(page);

    // The refused press stays on the Run tab and says so above Start.
    await pressStart(page);
    await expect(page.getByTestId('start-failure')).toHaveText(RUN_DID_NOT_START);
    await openTab(page, 'sim');
    await expectProgressOfWholeRun(page);

    release();
    await expect(result(page)).toBeVisible();
    await expect(playback(page, ROWS)).toBeVisible();
  });

  test('a run the server refuses leaves a finished twin\'s result and its playback', async ({ page }) => {
    await refuseRuns(page);
    await startRun(page);
    await expect(playback(page, ROWS)).toBeVisible();

    await pressStart(page);
    await expect(page.getByTestId('start-failure')).toHaveText(RUN_DID_NOT_START);
    await openTab(page, 'sim');
    await expect(result(page)).toBeVisible();
    await expect(playback(page, ROWS)).toBeVisible();
  });

  test('a twin\'s failure that comes back after the page left it says nothing on the Quickstart tab', async ({ page }) => {
    const release = await holdAnswer(page, TWIN_ENGINE_FAILS);
    await startRun(page);
    await expect(running(page)).toBeVisible();

    // The page leaves the twin for a run loaded from a file, and stays open.
    await loadSavedRun(page);
    await expect(running(page)).toHaveCount(0);
    await expect(finishedRun(page)).toBeVisible();

    release();
    await page.waitForResponse(response => response.url().endsWith('/api/quickstart/simulate-intervention'));
    await twinAnswerHandled(page);
    await openTab(page, 'quickstart');
    await expect(page.getByRole('button', { name: 'Patient · treatment' })).toBeVisible();
    await expect(page.getByText(TWIN_ENGINE_ERROR)).toHaveCount(0);
    await expect(page.getByText('Digital twin failed')).toHaveCount(0);
  });

  test('a run loaded from a file replaces the result', async ({ page }) => {
    await startRun(page);
    await expect(result(page)).toBeVisible();

    await loadSavedRun(page);

    await expect(result(page)).toHaveCount(0);
    await expect(finishedRun(page)).toBeVisible();
  });

  test('a twin the provider stopped reads Interrupted in the run status', async ({ page }) => {
    await page.route(TWIN_ROUTE, async route => {
      const answer = await route.fetch();
      const json = await answer.json() as { artifact: Record<string, unknown> };
      await route.fulfill({ response: answer, json: { ...json, artifact: { ...json.artifact, aborted: true } } });
    });
    await startRun(page);
    await expect(result(page)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Run status' })
      .getByRole('status', { name: /^Simulation status: Interrupted/ })).toBeVisible();
  });

  test('clearing local data clears the result', async ({ page }) => {
    await startRun(page);
    await expect(result(page)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Run status' })
      .getByRole('status', { name: /^Simulation status: Complete/ })).toBeVisible();

    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: 'Open run actions menu' }).click();
    await page.getByRole('menuitem', { name: /Clear local data/ }).click();
    await openTab(page, 'sim');

    await expect(result(page)).toHaveCount(0);
    await expect(noRunOnPage(page)).toBeVisible();
  });

  test('Delete server data clears the result of a finished twin, whose run the server drops', async ({ page }) => {
    // The admin token is saved in this browser before the page loads, as an operator's is.
    await page.addInitScript(([key, token]) => window.localStorage.setItem(key, token), [ADMIN_TOKEN_KEY, ADMIN_TOKEN] as const);
    await startRun(page);
    await expect(result(page)).toBeVisible();

    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: 'Open run actions menu' }).click();
    await page.getByRole('menuitem', { name: 'Delete server data' }).click();
    await expect(page.getByText(/ files deleted on the server\./).first()).toBeVisible();
    await openTab(page, 'sim');

    await expect(result(page)).toHaveCount(0);
    await expect(noRunOnPage(page)).toBeVisible();
  });

  test('clearing local data while a twin still runs keeps the twin\'s later events out of the page\'s views', async ({ page }) => {
    // The twin writes an event every 150 ms, and the page's /clear takes a
    // second to reach the server: the twin's events in that second arrive
    // after the page dropped its run and before the server says which run
    // is writing.
    await page.route('**/clear', async route => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await route.continue();
    });
    await page.route(TWIN_ROUTE, route => {
      const body = route.request().postDataJSON() as { subject: Record<string, unknown> };
      return route.continue({ postData: JSON.stringify({ ...body, subject: { ...body.subject, id: TWIN_ENGINE_SLOW } }) });
    });
    await startRun(page);
    await expect(running(page)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Run status' })
      .getByRole('status', { name: /^Simulation status: Running/ })).toBeVisible();
    await expect(stat(page, 'Turn')).toContainText('1 / 2');

    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: 'Open run actions menu' }).click();
    await page.getByRole('menuitem', { name: /Clear local data/ }).click();
    await openTab(page, 'sim');

    await twinAnswerHandled(page);
    await expect(running(page)).toHaveCount(0);
    await expect(result(page)).toHaveCount(0);
    await expect(noRunOnPage(page)).toBeVisible();
    await expect(page.getByText('Week 8 labs')).toHaveCount(0);
  });

  test('a run that fails ends the progress view and says why', async ({ page }) => {
    await page.route(TWIN_ROUTE, (route: Route) => {
      const body = route.request().postDataJSON() as { subject: Record<string, unknown> };
      return route.continue({ postData: JSON.stringify({ ...body, subject: { ...body.subject, id: TWIN_ENGINE_FAILS } }) });
    });
    await startRun(page);
    await expect(page.getByText(TWIN_ENGINE_ERROR).filter({ visible: true }).first()).toBeVisible();
    await expect(running(page)).toHaveCount(0);
    await expect(noRunOnPage(page)).toBeVisible();
  });

  test('a run in the page\'s scenario that takes the feed leaves the twin\'s progress and playback as they were', async ({ page }) => {
    // The answer and the stream come from here, as in the reconnect tests
    // below, so another visitor's run can arrive during this page's twin.
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
        sse('active_scenario', { id: 't2d-glp1-protocol', name: 't2d-glp1-protocol', runKey: request.runKey, forkedFrom: null }),
        sse('status', { phase: 'parallel', maxTurns: 2, actors: [{ name: LEADER, archetype: 'The Methodical Evaluator' }] }),
        ...twinEvents(LEADER).map(event => sse('sim', event)),
        sse('replay_done', {}),
      ].join('');
      await released;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ artifact: twinArtifact(request.subject, request.intervention), durationMs: 1 }) });
    });

    await startRun(page);
    await expectProgressOfWholeRun(page);

    // Another visitor's run in this page's scenario takes the server's buffer.
    const otherLeader = 'Another Visitor';
    body = [
      sse('connected', {}),
      sse('active_scenario', { id: 'mars-genesis', name: 'mars-genesis', runKey: 'another-visitors-run', forkedFrom: null }),
      sse('status', { phase: 'parallel', maxTurns: 1, actors: [{ name: otherLeader, archetype: 'The Visitor' }] }),
      ...twinEvents(otherLeader, 1).map(event => sse('sim', event)),
      sse('complete', {}),
      sse('replay_done', {}),
    ].join('');
    const seen = served;
    await expect.poll(() => served).toBeGreaterThan(seen + 2);
    await expectProgressOfWholeRun(page);

    release();
    await expect(result(page)).toBeVisible();
    await expect(playback(page, ROWS)).toBeVisible();

    // Clearing the result hands the page to the run its feed holds.
    await dismiss(page).click();
    await expect(result(page)).toHaveCount(0);
    await expect(finishedRun(page)).toBeVisible();
    await expect(page.getByText('Week 8 labs')).toHaveCount(0);
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
