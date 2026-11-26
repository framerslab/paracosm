import { expect, test } from '@playwright/test';
import { openTab } from '../support/frame.js';
import { settle } from '../support/readability.js';

test.skip(!process.env.SIMULATION_PROVENANCE_PICTURES, 'The CI pictures job runs these captures.');
test.use({ deviceScaleFactor: 2 });

const origin = 'http://127.0.0.1:3474';

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
  for (const look of ['dark', 'light'] as const) {
    test(`simulation provenance at ${viewport.width} px in ${look}`, async ({ page }) => {
      const picture = (surface: string) => page.screenshot({
        path: `test-pictures/simulation-provenance/${viewport.width}-${look}-${surface}.png`,
        animations: 'disabled',
      });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: look, reducedMotion: 'reduce' });
      await page.addInitScript(theme => localStorage.setItem('paracosm-theme', theme), look);
      await page.goto(origin + '/sim');

      const firstScreen = page.getByTestId('run-first-screen');
      const start = firstScreen.getByRole('button', { name: /^start\b/i });
      const notice = firstScreen.getByTestId('note-ai');
      await expect(start).toBeEnabled();
      await notice.scrollIntoViewIfNeeded();
      await settle(notice);
      await picture('first-screen');

      await start.click();
      await page.waitForURL(url => url.searchParams.get('tab') === 'sim');
      await expect(page.getByRole('status', { name: /^Simulation status: Complete\./ })).toBeVisible();
      await expect(page.getByRole('status', { name: 'Notifications' }).getByRole('button', { name: 'Dismiss', exact: true }))
        .toHaveCount(0, { timeout: 20_000 });
      const decision = page.getByText('Keep a reserve of water.', { exact: true }).filter({ visible: true }).first();
      await decision.scrollIntoViewIfNeeded();
      await settle(decision);
      await picture('watch');

      await openTab(page, 'reports');
      const report = page.getByRole('region', { name: 'Turn-by-turn report' });
      const summary = report.getByText('Pressure held overnight.', { exact: true }).filter({ visible: true }).first();
      await summary.scrollIntoViewIfNeeded();
      await settle(summary);
      await picture('reports');
    });
  }
}
