/**
 * Each visitor keeps the scenario they picked.
 *
 * The server held one scenario for everyone: one visitor's
 * /scenario/switch moved every other open page, whose next Run was
 * refused with 409 and whose reload came up on a scenario it never
 * picked. The pick now lives in the visitor's own paracosm_scenario
 * cookie, so each browser context here holds its own.
 *
 * The pages talk to the real server. /setup is intercepted, so nothing
 * here starts a run or calls a model. A switch goes through
 * page.request, which reads and writes the page's own context cookies;
 * the request fixture is a context of its own and would set a cookie no
 * page sees.
 */
import { test, expect, type Page } from '@playwright/test';

interface SetupBody {
  actors: Array<{ name: string }>;
  scenarioId?: string;
}

/** Answers /setup without starting a run and keeps each body the page sent. */
async function captureSetup(page: Page): Promise<SetupBody[]> {
  const bodies: SetupBody[] = [];
  await page.route('**/setup', async route => {
    bodies.push(route.request().postDataJSON() as SetupBody);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ redirect: '/sim' }) });
  });
  return bodies;
}

const firstName = (page: Page) => page.getByRole('textbox', { name: 'Name', exact: true }).first();
const settingsLaunch = (page: Page) => page.getByRole('button', { name: /Launch simulation|Loading scenario/i });
const finishedRun = (page: Page) => page.getByText('Spin up a new run');

/** Opens Settings and waits for GET /scenario, so the form holds the scenario's leaders. */
async function openSettings(page: Page): Promise<void> {
  await page.goto('/sim?tab=settings');
  await expect(settingsLaunch(page)).toBeEnabled();
}

test.describe('Scenario per visitor @scenario', () => {
  test("another visitor's switch leaves this page on its own scenario", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      const bodiesA = await captureSetup(pageA);
      const bodiesB = await captureSetup(pageB);

      await openSettings(pageA);
      await expect(firstName(pageA)).toHaveValue('Aria Chen');

      const switched = await pageB.request.post('/scenario/switch', { data: { id: 'atlas-lab' } });
      expect(switched.ok()).toBe(true);
      await openSettings(pageB);
      await expect(firstName(pageB)).toHaveValue('Marcus Reinhardt');

      await pageA.reload();
      await expect(settingsLaunch(pageA)).toBeEnabled();
      await expect(firstName(pageA)).toHaveValue('Aria Chen');

      await settingsLaunch(pageA).click();
      await expect.poll(() => bodiesA.length).toBe(1);
      expect(bodiesA[0].scenarioId).toBe('mars-genesis');

      await settingsLaunch(pageB).click();
      await expect.poll(() => bodiesB.length).toBe(1);
      expect(bodiesB[0].scenarioId).toBe('atlas-lab');
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('the page that switched comes up without the run the server still holds', async ({ page }) => {
    // The server's buffer holds a finished run. The switch no longer clears
    // it for everyone, so the page that switched skips that replay itself.
    // This stream ends after its replay, so the page reconnects about every
    // half second and is handed the same run each time.
    let served = 0;
    await page.route('**/events', route => {
      served += 1;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'event: connected\ndata: {}\n\nevent: complete\ndata: {}\n\nevent: replay_done\ndata: {}\n\n',
      });
    });
    await openSettings(page);
    await page.locator('#scenario-select').selectOption('atlas-lab');
    await expect(page.getByRole('heading', { name: 'Atlas Lab', exact: true }).first()).toBeVisible();
    await expect(firstName(page)).toHaveValue('Marcus Reinhardt');

    await page.getByRole('tab', { name: 'SIM', exact: true }).click();
    const reloaded = served;
    await expect.poll(() => served).toBeGreaterThan(reloaded + 1);
    await expect(finishedRun(page)).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('paracosm:scenarioSwitched'))).toBeNull();

    // A plain reload is no switch: the page shows what the server holds.
    await page.reload();
    await page.getByRole('tab', { name: 'SIM', exact: true }).click();
    await expect(finishedRun(page)).toBeVisible();
  });

  test('the page that compiled a scenario comes up on it without the run the server still holds', async ({ page }) => {
    let served = 0;
    await page.route('**/events', route => {
      served += 1;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'event: connected\ndata: {}\n\nevent: complete\ndata: {}\n\nevent: replay_done\ndata: {}\n\n',
      });
    });
    // The compile is answered here, so no model is called. The id it
    // reports is one the server holds, so the editor's switch to it is real.
    await page.route('**/compile', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: 'event: status\ndata: {"status":"compiling"}\n\nevent: complete\ndata: {"id":"atlas-lab","version":"1.0.0","departments":5,"hooks":7}\n\n',
    }));
    await openSettings(page);
    const compile = page.getByRole('button', { name: 'Compile scenario' });
    await expect(compile).toBeEnabled();
    await compile.click();

    await expect(page.getByRole('heading', { name: 'Atlas Lab', exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Compiled: atlas-lab/)).toBeVisible();
    await page.getByRole('tab', { name: 'SIM', exact: true }).click();
    const compiled = served;
    await expect.poll(() => served).toBeGreaterThan(compiled + 1);
    await expect(finishedRun(page)).toHaveCount(0);
  });

  test('a page comes up without the run the server holds for another scenario', async ({ page }) => {
    // Another visitor's finished Atlas Lab run is in the server's buffer,
    // opened by its active_scenario event. This page holds no pick, so it is
    // on Mars Genesis, and that run would draw under Mars Genesis's header
    // metrics and nouns.
    let runScenario = 'atlas-lab';
    let served = 0;
    await page.route('**/events', route => {
      served += 1;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: `event: connected\ndata: {}\n\nevent: active_scenario\ndata: ${JSON.stringify({ id: runScenario })}\n\nevent: complete\ndata: {}\n\nevent: replay_done\ndata: {}\n\n`,
      });
    });
    await openSettings(page);
    await expect(firstName(page)).toHaveValue('Aria Chen');
    await page.getByRole('tab', { name: 'SIM', exact: true }).click();
    const opened = served;
    await expect.poll(() => served).toBeGreaterThan(opened + 1);
    await expect(finishedRun(page)).toHaveCount(0);

    // A run in the page's own scenario shows.
    runScenario = 'mars-genesis';
    await expect(finishedRun(page)).toBeVisible();
  });

  test('the page that switched shows a run that opened while it was reconnecting', async ({ page }) => {
    // The run from before the switch names no scenario, so the switch's
    // mark is what skips it. A run that opens while the page is between two
    // connections reaches it in the next replay, not live, and must show.
    let body = 'event: connected\ndata: {}\n\nevent: complete\ndata: {}\n\nevent: replay_done\ndata: {}\n\n';
    let served = 0;
    await page.route('**/events', route => {
      served += 1;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
    });
    await openSettings(page);
    await page.locator('#scenario-select').selectOption('atlas-lab');
    await expect(page.getByRole('heading', { name: 'Atlas Lab', exact: true }).first()).toBeVisible();
    await expect(firstName(page)).toHaveValue('Marcus Reinhardt');
    await page.getByRole('tab', { name: 'SIM', exact: true }).click();
    const reloaded = served;
    await expect.poll(() => served).toBeGreaterThan(reloaded + 1);
    await expect(finishedRun(page)).toHaveCount(0);

    body = 'event: connected\ndata: {}\n\nevent: active_scenario\ndata: {"id":"atlas-lab"}\n\nevent: complete\ndata: {}\n\nevent: replay_done\ndata: {}\n\n';
    await expect(finishedRun(page)).toBeVisible();
  });

  test('a page whose run another scenario\'s run replaced shows it interrupted, not running', async ({ page }) => {
    // The page holds a Mars Genesis run in progress. Another visitor starts
    // an Atlas Lab run, which aborts it on the server and opens the buffer
    // with its own active_scenario event. The page skips the Atlas Lab
    // run, and with it the end of its own, so it must end that run itself.
    const runBody = (scenarioId: string, leader: string) => [
      'event: connected\ndata: {}',
      `event: active_scenario\ndata: ${JSON.stringify({ id: scenarioId })}`,
      `event: status\ndata: ${JSON.stringify({ phase: 'parallel', maxTurns: 6, actors: [{ name: leader, archetype: 'The Visionary' }] })}`,
      'event: replay_done\ndata: {}',
    ].join('\n\n') + '\n\n';
    let body = runBody('mars-genesis', 'Aria Chen');
    let served = 0;
    await page.route('**/events', route => {
      served += 1;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
    });
    await openSettings(page);
    await page.getByRole('tab', { name: 'SIM', exact: true }).click();
    const opened = served;
    await expect.poll(() => served).toBeGreaterThan(opened + 1);
    await expect(finishedRun(page)).toHaveCount(0);

    body = runBody('atlas-lab', 'Marcus Reinhardt');
    await expect(page.getByRole('status', { name: /^Interrupted\. Run interrupted: another run started on the server/ }).first()).toBeVisible();
  });

  test("a new run in the page's scenario starts clean after the run it replaced", async ({ page }) => {
    // A Mars Genesis run, then another visitor's Atlas Lab run, which ends
    // the Mars Genesis run on this page as interrupted, then a new Mars
    // Genesis run. The new run is shown on its own: it inherits neither
    // the interrupted state nor the events of the run before it.
    const runBody = (scenarioId: string, runKey: string, leader: string) => [
      'event: connected\ndata: {}',
      `event: active_scenario\ndata: ${JSON.stringify({ id: scenarioId, runKey })}`,
      `event: status\ndata: ${JSON.stringify({ phase: 'parallel', maxTurns: 6, actors: [{ name: leader, archetype: 'The Visionary' }] })}`,
      `event: sim\ndata: ${JSON.stringify({ type: 'turn_start', leader, data: { turn: 1, time: 2035, title: 'Dust storm' } })}`,
      'event: replay_done\ndata: {}',
    ].join('\n\n') + '\n\n';
    let body = runBody('mars-genesis', 'run-1', 'Aria Chen');
    let served = 0;
    await page.route('**/events', route => {
      served += 1;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
    });
    await openSettings(page);
    await page.getByRole('tab', { name: 'SIM', exact: true }).click();
    const opened = served;
    await expect.poll(() => served).toBeGreaterThan(opened + 1);

    body = runBody('atlas-lab', 'run-2', 'Marcus Reinhardt');
    await expect(page.getByRole('status', { name: /^Interrupted\./ }).first()).toBeVisible();

    body = runBody('mars-genesis', 'run-3', 'Aria Chen');
    await expect(page.getByRole('status', { name: /^Live\./ }).first()).toBeVisible();
    await expect(page.getByRole('status', { name: /^Interrupted\./ })).toHaveCount(0);
  });

  test("a loaded run offers a fork only in the page's own scenario", async ({ page, baseURL }) => {
    // A fork runs in its parent's scenario and a page shows a run only in
    // its own, so a Mars Genesis page that forked a loaded Atlas Lab run
    // would never see the fork: its branch would read running for good.
    const savedRun = (scenarioId: string, name: string, leader: string) => ({
      schemaVersion: 3,
      startedAt: '2026-11-02T00:00:00.000Z',
      completedAt: '2026-11-02T00:10:00.000Z',
      events: [1, 2].flatMap(turn => ['turn_start', 'turn_done'].map(type => ({
        type, leader, data: { turn, time: turn, title: `${name} turn ${turn}` },
      }))),
      results: [{
        leader,
        summary: {},
        fingerprint: null,
        artifact: {
          metadata: { runId: `parent-${scenarioId}`, scenario: { id: scenarioId, name }, mode: 'turn-loop', startedAt: '2026-11-02T00:00:00.000Z', seed: 11 },
          scenarioExtensions: {
            kernelSnapshotsPerTurn: [1, 2].map(turn => ({
              snapshotVersion: 1, scenarioId, turn, time: turn, state: {}, rngState: 0, startTime: 1, seed: 11,
            })),
          },
        },
      }],
      verdict: null,
    });
    const runs: Record<string, ReturnType<typeof savedRun>> = {
      'mars-genesis': savedRun('mars-genesis', 'Mars Genesis', 'Aria Chen'),
      'atlas-lab': savedRun('atlas-lab', 'Atlas Lab', 'Marcus Reinhardt'),
    };
    await page.route('**/saved-runs/*.json', async route => {
      // The live feed's first connect clears the page's events, so the
      // saved run is answered once the feed is up, or it can be cleared.
      await expect(page.getByRole('status', { name: /^Live\./ }).first()).toBeVisible();
      const id = new URL(route.request().url()).pathname.split('/').pop()!.replace(/\.json$/, '');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runs[id]) });
    });
    const forkButton = () => page.getByRole('button', { name: /^Fork at .* 1$/ });
    const openSaved = (id: string) => page.goto(`/sim?load=${encodeURIComponent(`${baseURL}/saved-runs/${id}.json`)}&autoload=1&tab=reports`);

    // This page holds no pick, so it is on Mars Genesis.
    await openSaved('mars-genesis');
    await expect(page.locator('#turn-1')).toBeVisible();
    await expect(forkButton()).toHaveCount(1);

    await expect(page.getByRole('note')).toHaveCount(0);

    await openSaved('atlas-lab');
    await expect(page.locator('#turn-1')).toBeVisible();
    await expect(page.getByRole('note')).toContainText('This run is in Atlas Lab');
    await expect(forkButton()).toHaveCount(0);
  });

  test('the privacy section names the cookie that holds the pick', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#privacy')).toContainText('paracosm_scenario');
  });
});
