import { expect, test } from '@playwright/test';

/**
 * Pictures of the landing page's first screen at 390 by 844 and 1,440 by 900
 * px in both looks, at 2x, for a pull request's before and after
 * (.github/workflows/landing-first-screen-pictures.yml runs it on the base
 * and on the head). Motion is reduced, so the replay rests on its verdict
 * and the picture holds still.
 */
const phase = process.env.LANDING_CAPTURE;
test.skip(!phase, 'The CI pictures job runs these captures.');

test.use({ deviceScaleFactor: 2 });

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  for (const look of ['dark', 'light'] as const) {
    test(`the first screen at ${viewport.width} px in the ${look} look`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: 'reduce', baseURL: 'http://127.0.0.1:3456' });
      await context.addInitScript((chosen) => {
        try { localStorage.setItem('paracosm-theme', chosen); } catch { /* the default look */ }
      }, look);
      const page = await context.newPage();
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      const replay = page.locator('#lp-replay');
      if (await replay.count()) await expect(replay).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `test-pictures/landing-first-screen/${phase}/${viewport.width}-${look}.png` });
      await context.close();
    });
  }
}
