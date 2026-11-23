import { expect, test } from '@playwright/test';

const phase = process.env.VISITOR_LEGAL_CAPTURE;
test.skip(!phase, 'The CI pictures job runs these captures.');

const SERVER = 'http://127.0.0.1:3462';
test.use({ deviceScaleFactor: 2 });

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  for (const look of ['dark', 'light'] as const) {
    test(`key fields, age and teacher notices at ${viewport.width} in ${look}`, async ({ page, context }) => {
      const path = `test-pictures/visitor-keys-and-age/${phase}/${viewport.width}-${look}`;
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: look, reducedMotion: 'reduce' });
      await page.addInitScript(theme => localStorage.setItem('paracosm-theme', theme), look);
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SERVER });

      await page.goto(`${SERVER}/sim?tab=settings`);
      const settings = page.getByRole('group', { name: 'API Keys', exact: true });
      await expect(settings).toBeVisible();
      if (phase === 'after') {
        await expect(settings.getByTestId('visitor-key-notes').locator('p')).toHaveCount(5);
      }
      // The Settings scroll pane clips a fieldset taller than the viewport.
      // Keep the requested width and fit the whole section for this crop.
      const settingsHeight = await settings.evaluate(el => Math.ceil(el.getBoundingClientRect().height));
      await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, settingsHeight + 240) });
      await settings.scrollIntoViewIfNeeded();
      await expect(settings).toBeInViewport({ ratio: 0.99 });
      await settings.screenshot({ path: `${path}-settings.png`, animations: 'disabled' });

      await page.setViewportSize(viewport);
      await page.goto(`${SERVER}/sim`);
      const startAge = page.getByTestId('note-adults');
      const footerAge = page.getByTestId('foot-adults');
      await expect(startAge).toBeVisible();
      await startAge.locator('..').screenshot({ path: `${path}-start-age.png`, animations: 'disabled' });
      await expect(footerAge).toBeVisible();
      await footerAge.locator('..').screenshot({ path: `${path}-footer-age.png`, animations: 'disabled' });

      await page.goto(`${SERVER}/#about`);
      const about = page.locator('#about .sec-inner');
      await expect(about).toBeVisible();
      await about.screenshot({ path: `${path}-about.png`, animations: 'disabled' });

      const { sessions } = await (await page.request.get(`${SERVER}/sessions`)).json();
      expect(sessions).toHaveLength(1);
      await page.goto(`${SERVER}/sim?replay=${encodeURIComponent(sessions[0].id)}&tab=sim`);
      await expect(page.getByRole('status').filter({ hasText: /^REPLAYING/i })).toBeVisible();
      await page.getByRole('button', { name: 'Open run actions menu' }).click();
      await page.getByRole('menuitem', { name: /Share viz link/ }).click();
      await page.getByRole('status', { name: 'Share link' }).screenshot({
        path: `${path}-share.png`, animations: 'disabled',
      });
    });
  }
}
