/**
 * A saved run picked from the Run menu opens its replay.
 *
 * The page talks to the real server over HTTP (tests-e2e/support/shared-run-server.ts):
 * one Mars Genesis pair run is stored there as the server stores a finished
 * run. The Run menu's "Run Saved Simulation" lists it; picking it loads
 * /sim?replay=<id>&tab=sim, which plays the run through the server's own
 * /sessions/:id/replay.
 */
import { test, expect } from '@playwright/test';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stored run lives on a local server of its own.');

const SERVER = 'http://127.0.0.1:3462';

test.use({ baseURL: SERVER });

test('a saved run picked under Run Saved Simulation in the Run menu opens its replay', async ({ page, request }) => {
  const res = await request.get(`${SERVER}/sessions`);
  expect(res.ok()).toBe(true);
  const { sessions } = await res.json() as { sessions: Array<{ id: string }> };
  expect(sessions).toHaveLength(1);
  const id = sessions[0].id;

  await page.goto('/sim?tab=sim');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  const menu = page.getByRole('menu', { name: 'Run actions' });
  await expect(menu).toBeVisible();
  const saved = menu.getByRole('menuitem', { name: /Run Saved Simulation/ });
  await expect(saved).toBeEnabled();
  await saved.click();
  await menu.getByRole('button').filter({ hasText: 'Aria Chen' }).first().click();

  await page.waitForURL(url => url.searchParams.get('replay') === id);
  expect(new URL(page.url()).searchParams.get('tab')).toBe('sim');
  await expect(page.getByRole('status').filter({ hasText: /^REPLAYING/i })).toBeVisible();
});
