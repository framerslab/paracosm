/**
 * A ?load= link that names a run file on another site.
 *
 * A link such as /sim?load=https://other.site/run.json&autoload=1 is
 * written by whoever shares it, not by the visitor. The page asks once,
 * naming the site, before it fetches anything; and a provider_error event
 * inside the run file links the banner only to the provider pages the
 * server itself sends, so an address the file names elsewhere shows as
 * text.
 *
 * The other site is page.route on a host that does not resolve; it
 * answers with Access-Control-Allow-Origin: * as a public file host does.
 * The page talks to the real server for everything else.
 */
import { test, expect, type Page } from '@playwright/test';

const OTHER_HOST = 'runs.example.test';
const RUN_URL = `https://${OTHER_HOST}/shared/run.json`;
const FOREIGN_LINK = `https://${OTHER_HOST}/openai-billing`;

/** A run file whose provider_error names an address on the file's own host. */
const hostileRun = {
  schemaVersion: 3,
  events: [
    {
      type: 'provider_error',
      leader: 'A',
      data: { kind: 'quota', provider: 'openai', message: 'OpenAI credits exhausted.', actionUrl: FOREIGN_LINK },
    },
    { type: 'turn_start', leader: 'A', data: { turn: 1, time: 1, title: 'Turn 1' } },
    { type: 'turn_done', leader: 'A', data: { turn: 1, time: 1, title: 'Turn 1' } },
  ],
};

/** Serves the run file from the other host and counts the requests it gets. */
async function serveOtherHost(page: Page): Promise<{ count: () => number }> {
  let requests = 0;
  await page.route(`https://${OTHER_HOST}/**`, async route => {
    requests += 1;
    // The live feed's first connect clears the page's events, so the run
    // is answered once the feed is up, or it can be cleared.
    await expect(page.getByRole('status', { name: /^Live\./ }).first()).toBeVisible();
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(hostileRun),
    });
  });
  return { count: () => requests };
}

const linkTo = (target: string) => `/sim?load=${encodeURIComponent(target)}&autoload=1`;
const askDialog = (page: Page) => page.getByRole('dialog', { name: 'Load a run from another site?' });
const providerBanner = (page: Page) => page.getByRole('alert').filter({ hasText: 'OpenAI credits exhausted' });

test.describe('a load link to another site', () => {
  test('asks once, naming the site, before anything is fetched or shown', async ({ page }) => {
    const other = await serveOtherHost(page);
    await page.goto(linkTo(RUN_URL));
    await expect(page.getByRole('status', { name: /^Live\./ }).first()).toBeVisible();

    const dialog = askDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(OTHER_HOST);
    expect(other.count()).toBe(0);
    await expect(providerBanner(page)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => other.count()).toBe(1);

    // autoload=1: the one question was the site; the run then loads.
    const banner = providerBanner(page);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(FOREIGN_LINK);
    await expect(banner.getByRole('link')).toHaveCount(0);
    await expect(page.locator(`a[href^="https://${OTHER_HOST}"]`)).toHaveCount(0);
  });

  test('Cancel fetches nothing and drops the link from the address bar', async ({ page }) => {
    const other = await serveOtherHost(page);
    await page.goto(linkTo(RUN_URL));
    const dialog = askDialog(page);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.has('load')).toBe(false);
    await page.waitForTimeout(500);
    expect(other.count()).toBe(0);
    await expect(providerBanner(page)).toHaveCount(0);
  });

  test("keeps the dialog's buttons on one row at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await serveOtherHost(page);
    await page.goto(linkTo(RUN_URL));
    const dialog = askDialog(page);
    await expect(dialog).toBeVisible();
    const cancel = await dialog.getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
    const load = await dialog.getByRole('button', { name: 'Load', exact: true }).boundingBox();
    expect(cancel && load).toBeTruthy();
    expect(Math.abs(cancel!.y - load!.y)).toBeLessThan(2);
    expect(load!.x + load!.width).toBeLessThanOrEqual(320);
  });

  test("a link to the page's own site loads with no question", async ({ page, baseURL }) => {
    await page.route('**/own-runs/*.json', async route => {
      await expect(page.getByRole('status', { name: /^Live\./ }).first()).toBeVisible();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hostileRun) });
    });
    await page.goto(linkTo(`${baseURL}/own-runs/run.json`));
    await expect(providerBanner(page)).toBeVisible();
    await expect(askDialog(page)).toHaveCount(0);
    // The file's address on another host is still text, wherever the file came from.
    await expect(page.locator(`a[href^="https://${OTHER_HOST}"]`)).toHaveCount(0);
  });
});
