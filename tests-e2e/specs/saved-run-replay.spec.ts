/** A saved run in Library opens its replay from the server that stores it. */
import { test, expect } from '@playwright/test';
import { openTab } from '../support/frame.js';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stored run lives on a local server of its own.');

const SERVER = 'http://127.0.0.1:3462';

test.use({ baseURL: SERVER });

test('a saved run picked in Library opens its replay', async ({ page, request }) => {
  const res = await request.get(`${SERVER}/sessions`);
  expect(res.ok()).toBe(true);
  const { sessions } = await res.json() as { sessions: Array<{ id: string }> };
  expect(sessions).toHaveLength(1);
  const id = sessions[0].id;

  await page.goto('/sim?tab=sim');
  await openTab(page, 'library');
  await page.getByRole('region', { name: 'Saved runs' }).getByRole('link', { name: /Aria Chen/ }).click();

  await page.waitForURL(url => url.searchParams.get('replay') === id);
  expect(new URL(page.url()).searchParams.get('tab')).toBe('sim');
  await expect(page.getByRole('status').filter({ hasText: /^Watching a saved run/i })).toBeVisible();
});
