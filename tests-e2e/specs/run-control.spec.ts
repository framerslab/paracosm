/**
 * The dashboard's Run controls and the active scenario.
 *
 * useScenario renders the Mars Genesis fallback until GET /scenario
 * answers, so a Run pressed in that window posted Mars's values to a
 * server on another scenario. And the Run button read `presets[].actors`
 * while /scenario sends `presets[].leaders`, so an Atlas Lab run started
 * with "Actor A" and "Actor B" in units named "Colony Alpha" and "Colony
 * Beta".
 *
 * The page talks to the real server, switched to Atlas Lab. /setup is
 * intercepted, so nothing here starts a run or calls a model; the body the
 * real server takes is covered in tests/cli/dashboard-run-payload.test.ts.
 * Each test switches the one server's active scenario, so the file runs
 * one test at a time.
 */
import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'default' });

interface SetupBody {
  actors: Array<{ name: string; unit?: string }>;
  scenarioId?: string;
  startTime?: number;
  population?: number;
  seed?: number;
  quickstart?: { scenarioId?: string };
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

/** Holds GET /scenario until the returned function is called. */
async function holdScenario(page: Page): Promise<() => void> {
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/scenario', async route => {
    await released;
    await route.continue();
  });
  return release;
}

const runMenuButton = (page: Page) => page.getByRole('button', { name: 'RUN', exact: true });
const runNewItem = (page: Page) => page.getByRole('menuitem', { name: /Run New Simulation|Loading scenario/ });
const emptyStateRun = (page: Page) => page.getByRole('button', { name: /^(Run Simulation|Loading scenario)/ });
const settingsLaunch = (page: Page) => page.getByRole('button', { name: /Launch simulation|Loading scenario/i });

test.describe('Run controls @run', () => {
  test.beforeEach(async ({ request }) => {
    const switched = await request.post('/scenario/switch', { data: { id: 'atlas-lab' } });
    expect(switched.ok()).toBe(true);
  });

  test("Run New Simulation posts Atlas Lab's leaders, in units named for a lab", async ({ page }) => {
    const bodies = await captureSetup(page);
    await page.goto('/sim?tab=sim');
    await runMenuButton(page).click();
    await expect(runNewItem(page)).toHaveText(/Run New Simulation/);
    // The pointer has not left the RUN button: its tooltip must not sit
    // over the menu it just opened.
    await runNewItem(page).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].scenarioId).toBe('atlas-lab');
    expect(bodies[0].actors.map(a => a.name)).toEqual(['Marcus Reinhardt', 'Priya Kapoor']);
    expect(bodies[0].actors.map(a => a.unit)).toEqual(['Lab Alpha', 'Lab Beta']);
  });

  test("Settings launches Atlas Lab's leaders, in units named for a lab", async ({ page }) => {
    const bodies = await captureSetup(page);
    await page.goto('/sim?tab=settings');
    await expect(page.getByRole('textbox', { name: 'Name', exact: true }).first()).toHaveValue('Marcus Reinhardt');
    await expect(page.getByRole('textbox', { name: 'Unit', exact: true }).first()).toHaveValue('Lab Alpha');
    await settingsLaunch(page).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].scenarioId).toBe('atlas-lab');
    expect(bodies[0].startTime).toBe(1);
    expect(bodies[0].actors.map(a => a.name)).toEqual(['Marcus Reinhardt', 'Priya Kapoor']);
    expect(bodies[0].actors.map(a => a.unit)).toEqual(['Lab Alpha', 'Lab Beta']);
  });

  test('the Sim tab Run and the Run menu wait for GET /scenario', async ({ page }) => {
    const bodies = await captureSetup(page);
    const release = await holdScenario(page);
    await page.goto('/sim?tab=sim');

    await expect(emptyStateRun(page)).toBeDisabled();
    await expect(emptyStateRun(page)).toHaveText(/Loading scenario/);
    await runMenuButton(page).click();
    await expect(runNewItem(page)).toBeDisabled();
    await expect(runNewItem(page)).toHaveText(/Loading scenario/);
    expect(bodies).toHaveLength(0);

    release();
    await expect(runNewItem(page)).toBeEnabled();
    await expect(runNewItem(page)).toHaveText(/Run New Simulation/);
    await page.keyboard.press('Escape');
    await expect(emptyStateRun(page)).toBeEnabled();
    await emptyStateRun(page).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].scenarioId).toBe('atlas-lab');
    expect(bodies[0].actors.map(a => a.name)).toEqual(['Marcus Reinhardt', 'Priya Kapoor']);
  });

  test('Settings Launch waits for GET /scenario', async ({ page }) => {
    const bodies = await captureSetup(page);
    const release = await holdScenario(page);
    await page.goto('/sim?tab=settings');

    await expect(settingsLaunch(page)).toBeDisabled();
    await expect(settingsLaunch(page)).toHaveText(/Loading scenario/);

    release();
    await expect(settingsLaunch(page)).toBeEnabled();
    await expect(settingsLaunch(page)).toHaveText(/Launch Simulation/);
    await settingsLaunch(page).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].scenarioId).toBe('atlas-lab');
    expect(bodies[0].startTime).toBe(1);
  });

  test('a unit typed while GET /scenario loads is kept when the leaders arrive', async ({ page }) => {
    const bodies = await captureSetup(page);
    const release = await holdScenario(page);
    await page.goto('/sim?tab=settings');
    await page.getByRole('textbox', { name: 'Unit', exact: true }).first().fill('Alpha Wing');

    release();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true }).first()).toHaveValue('Marcus Reinhardt');
    await expect(settingsLaunch(page)).toBeEnabled();
    await settingsLaunch(page).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].actors.map(a => a.unit)).toEqual(['Alpha Wing', 'Lab Beta']);
  });

  test('a name typed while GET /scenario loads is kept when the leaders arrive', async ({ page }) => {
    const bodies = await captureSetup(page);
    const release = await holdScenario(page);
    await page.goto('/sim?tab=settings');
    const names = page.getByRole('textbox', { name: 'Name', exact: true });
    await names.first().fill('Zed Okafor');

    release();
    await expect(settingsLaunch(page)).toBeEnabled();
    await expect(names.nth(1)).toHaveValue('Priya Kapoor');
    await expect(names.first()).toHaveValue('Zed Okafor');
    await settingsLaunch(page).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].actors.map(a => a.name)).toEqual(['Zed Okafor', 'Priya Kapoor']);
    expect(bodies[0].actors.map(a => a.unit)).toEqual(['Lab Alpha', 'Lab Beta']);
  });

  test("a unit left by another scenario's run takes this scenario's word", async ({ page }) => {
    const bodies = await captureSetup(page);
    // The last launch was on Deep Ocean Station, and Settings' scenario switch
    // reloads the page onto Atlas Lab with the form open.
    await page.addInitScript(() => {
      localStorage.setItem('paracosm:activeRunActors', JSON.stringify([
        { name: 'Captain Ingrid Halvorsen', archetype: 'The Captain', unit: 'Station Alpha' },
        { name: 'Commander Takeshi Morimoto', archetype: 'The Commander', unit: 'Station Beta' },
        { name: 'Dr. Amara Osei', archetype: 'The Scientist', unit: 'Station Gamma' },
      ]));
    });
    const release = await holdScenario(page);
    await page.goto('/sim?tab=settings');
    await expect(page.getByRole('textbox', { name: 'Unit', exact: true }).first()).toHaveValue('Station Alpha');

    release();
    await expect(settingsLaunch(page)).toBeEnabled();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true }).first()).toHaveValue('Marcus Reinhardt');
    await settingsLaunch(page).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].actors.slice(0, 2).map(a => a.name)).toEqual(['Marcus Reinhardt', 'Priya Kapoor']);
    expect(bodies[0].actors.map(a => a.unit)).toEqual(['Lab Alpha', 'Lab Beta', 'Lab Gamma']);
  });

  test("a finished run's Run again waits for GET /scenario", async ({ page }) => {
    const bodies = await captureSetup(page);
    // The server's event stream replays a finished run, and the last launch on
    // this device was Atlas Lab's. Until the scenario answers, the page holds
    // the Mars fallback and would say it has no launch to run again.
    await page.route('**/events', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: 'event: connected\ndata: {}\n\nevent: complete\ndata: {}\n\n',
    }));
    await page.addInitScript(() => {
      localStorage.setItem('paracosm:lastLaunchConfig', JSON.stringify({
        scenarioId: 'atlas-lab',
        seed: 7,
        actors: [{ name: 'Marcus Reinhardt' }, { name: 'Priya Kapoor' }],
      }));
    });
    const release = await holdScenario(page);
    await page.goto('/sim?tab=sim');
    const runAgain = page.getByText('Spin up a new run').locator('..').getByRole('button');

    await expect(runAgain).toBeDisabled();
    await expect(runAgain).toHaveText(/Loading scenario/);

    release();
    await expect(runAgain).toBeEnabled();
    await expect(runAgain).toHaveText(/Run again/);
    await runAgain.click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].scenarioId).toBe('atlas-lab');
    expect(bodies[0].seed).toBe(8);
  });

  test('a failed GET /scenario keeps Run waiting, and the page tries again', async ({ page }) => {
    let answered = 0;
    let release = () => {};
    const released = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/scenario', async route => {
      answered += 1;
      if (answered === 1) {
        await route.fulfill({ status: 500, body: 'unavailable' });
        return;
      }
      await released;
      await route.continue();
    });
    const failed = page.waitForResponse(r => r.url().endsWith('/scenario') && r.status() === 500);
    await page.goto('/sim?tab=sim');
    await failed;

    await expect(emptyStateRun(page)).toBeDisabled();
    await expect.poll(() => answered, { timeout: 15_000 }).toBeGreaterThan(1);
    await expect(emptyStateRun(page)).toBeDisabled();

    release();
    await expect(emptyStateRun(page)).toBeEnabled();
  });

  test('the run the catalog hands across its reload waits for GET /scenario', async ({ page }) => {
    const bodies = await captureSetup(page);
    // The catalog's Run stashes this and reloads after /scenario/switch.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('e2e:seeded')) return;
      sessionStorage.setItem('e2e:seeded', '1');
      sessionStorage.setItem('paracosm:catalogPendingRun', JSON.stringify({ actorCount: 2, ts: Date.now() }));
    });
    await page.goto('/sim?tab=quickstart');

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].quickstart?.scenarioId).toBe('atlas-lab');
    expect(bodies[0].actors.map(a => a.name)).toEqual(['Marcus Reinhardt', 'Priya Kapoor']);
  });
});
