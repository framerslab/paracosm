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

/** A third site the run file can be sent on to, which nobody named. */
const ELSEWHERE_HOST = 'elsewhere.example.test';

/** Serves the run file on the third site, after the feed is up, and counts the requests. */
async function serveElsewhere(page: Page): Promise<{ count: () => number }> {
  let requests = 0;
  await page.route(`https://${ELSEWHERE_HOST}/**`, async route => {
    requests += 1;
    await expect(page.getByRole('status', { name: /^Live\./ }).first()).toBeVisible();
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(hostileRun),
    });
  });
  return { count: () => requests };
}

/** Answers `pattern` with a redirect to the run file on the third site. */
async function redirectToElsewhere(page: Page, pattern: string): Promise<void> {
  await page.route(pattern, route => route.fulfill({
    status: 302,
    headers: { Location: `https://${ELSEWHERE_HOST}/run.json`, 'Access-Control-Allow-Origin': '*' },
  }));
}

const movedToast = (page: Page) => page.getByText(`The file redirects to ${ELSEWHERE_HOST}, so it was not loaded.`);

test.describe('a load link whose file is sent on to another site', () => {
  test("a link to the page's own site that redirects elsewhere shows nothing from there", async ({ page, baseURL }) => {
    const elsewhere = await serveElsewhere(page);
    await redirectToElsewhere(page, '**/own-runs/moved.json');
    await page.goto(linkTo(`${baseURL}/own-runs/moved.json`));
    await expect(page.getByRole('status', { name: /^Live\./ }).first()).toBeVisible();

    await expect(movedToast(page)).toBeVisible();
    expect(elsewhere.count()).toBeLessThanOrEqual(1);
    await expect(providerBanner(page)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Load simulation' })).toHaveCount(0);
  });

  test('a site the visitor agreed to that redirects elsewhere shows nothing from there', async ({ page }) => {
    await serveElsewhere(page);
    await redirectToElsewhere(page, `https://${OTHER_HOST}/moved.json`);
    await page.goto(linkTo(`https://${OTHER_HOST}/moved.json`));
    const dialog = askDialog(page);
    await expect(dialog).toContainText(OTHER_HOST);
    await dialog.getByRole('button', { name: 'Load', exact: true }).click();

    await expect(movedToast(page)).toBeVisible();
    await expect(providerBanner(page)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Load simulation' })).toHaveCount(0);
  });
});

test.describe('after a load link is cancelled', () => {
  test("the visitor's own file still gets the preview", async ({ page }) => {
    await serveOtherHost(page);
    await page.goto(`${linkTo(RUN_URL)}&tab=reports`);
    await expect(page.getByRole('status', { name: /^Live\./ }).first()).toBeVisible();
    await askDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(askDialog(page)).toHaveCount(0);

    const ownRun = {
      schemaVersion: 3,
      events: [
        { type: 'turn_start', leader: 'A', data: { turn: 1, time: 1, title: 'Turn 1' } },
        { type: 'turn_done', leader: 'A', data: { turn: 1, time: 1, title: 'Turn 1' } },
      ],
    };
    await page.getByRole('button', { name: 'RUN', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Load from file/ }).click();
    await (await chooser).setFiles({ name: 'own-run.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(ownRun)) });

    // The link's autoload=1 was for the link's file, which the visitor
    // refused: their own file shows its preview and waits for their click.
    const preview = page.getByRole('dialog', { name: 'Load simulation' });
    await expect(preview).toBeVisible();
    await page.waitForTimeout(500);
    await expect(preview).toBeVisible();
    await preview.getByRole('button', { name: /^(Load|Load anyway|Replace current simulation)$/ }).click();
    await expect(preview).toHaveCount(0);
  });
});

test.describe('a run file whose provider_error address is not text', () => {
  test('shows the banner and keeps the page', async ({ page, baseURL }) => {
    const oddRun = {
      ...hostileRun,
      events: hostileRun.events.map(e => (e.type === 'provider_error'
        ? { ...e, data: { ...e.data, actionUrl: { href: FOREIGN_LINK } } }
        : e)),
    };
    await page.route('**/own-runs/odd.json', async route => {
      await expect(page.getByRole('status', { name: /^Live\./ }).first()).toBeVisible();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oddRun) });
    });
    await page.goto(linkTo(`${baseURL}/own-runs/odd.json`));
    await expect(providerBanner(page)).toBeVisible();
    await expect(page.getByText('SIMULATION ERROR')).toHaveCount(0);
    await expect(page.locator(`a[href^="https://${OTHER_HOST}"]`)).toHaveCount(0);
  });
});
