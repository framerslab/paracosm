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
