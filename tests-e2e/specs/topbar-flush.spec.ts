/**
 * Track 1C regression: the TopBar must sit flush against the top of the
 * viewport on every dashboard tab. The reported bug showed ~10-15 px of
 * empty space above the TopBar on every tab — visible in screenshots
 * across SIM, Quickstart, etc. Static-CSS audit didn't surface a
 * culprit, so this test pins the contract end-to-end and catches any
 * future regression that puts whitespace back above the chrome.
 */
import { test, expect } from '@playwright/test';

const TABS = ['quickstart', 'studio', 'sim', 'viz', 'chat', 'reports', 'library', 'settings'] as const;

test.describe('TopBar flush against viewport top @layout', () => {
  for (const tab of TABS) {
    test(`TopBar.y === 0 on /sim?tab=${tab}`, async ({ page }) => {
      await page.goto(`/sim?tab=${tab}`);
      // Wait for the dashboard chrome to mount.
      await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible({ timeout: 15_000 });
      const topBar = page.locator('#root').getByRole('banner');
      const box = await topBar.boundingBox();
      expect(box, 'TopBar must render with a bounding box').toBeTruthy();
      // Allow up to 1 px to account for sub-pixel rounding on certain
      // displays. Anything above that is the empty-space bug.
      expect(box!.y, `TopBar.y=${box!.y} px — must be 0 (no empty space above)`).toBeLessThan(1);
    });
  }

  // The user's screenshot 3 had `?replay=<id>` in the URL on the SIM
  // tab. When the replay session id can't be resolved (server has been
  // restarted / cache evicted), the dashboard renders the
  // ReplayNotFoundBanner above the TopBar — that banner must render
  // with non-zero visible content, never as a 0-height ghost row that
  // pushes the TopBar down.
  test('ReplayNotFoundBanner is visible (not a 0-height ghost) when ?replay points at a missing id', async ({ page }) => {
    await page.goto('/sim?tab=sim&replay=00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible({ timeout: 15_000 });
    // Either the active banner OR the not-found banner must be visible.
    const anyBanner = page.locator('[role=status], [role=alert]').filter({ hasText: /REPLAY/i });
    await expect(anyBanner.first()).toBeVisible({ timeout: 15_000 });
    const bannerBox = await anyBanner.first().boundingBox();
    expect(bannerBox, 'banner must have a bounding box').toBeTruthy();
    expect(bannerBox!.height, `Replay banner height=${bannerBox!.height} px — empty banner row above the TopBar`).toBeGreaterThan(8);
  });
});
