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
const emptyStateRun = (page: Page) => page.getByRole('button', { name: /^(Run Simulation|Loading scenario)/ });
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
    // it for everyone, so the page that switched drops that replay itself.
    await page.route('**/events', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: 'event: connected\ndata: {}\n\nevent: complete\ndata: {}\n\nevent: replay_done\ndata: {}\n\n',
    }));
    await openSettings(page);
    await page.locator('#scenario-select').selectOption('atlas-lab');
    await expect(page.getByRole('heading', { name: 'Atlas Lab', exact: true }).first()).toBeVisible();
    await expect(firstName(page)).toHaveValue('Marcus Reinhardt');

    await page.getByRole('tab', { name: 'SIM', exact: true }).click();
    await expect(emptyStateRun(page)).toBeVisible();
    // The stream ends and reconnects; each reconnect replays the same run.
    await page.waitForTimeout(2_000);
    await expect(finishedRun(page)).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('paracosm:scenarioSwitched'))).toBeNull();

    // A plain reload is no switch: the page shows what the server holds.
    await page.reload();
    await page.getByRole('tab', { name: 'SIM', exact: true }).click();
    await expect(finishedRun(page)).toBeVisible();
  });

  test('the privacy section names the cookie that holds the pick', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#privacy')).toContainText('paracosm_scenario');
  });
});
