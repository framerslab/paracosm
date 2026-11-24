/**
 * Cross-tab mobile-responsive sweep.
 *
 * Asserts that no element on any primary tab extends past the document's
 * client width (i.e. no horizontal scroll, no clipped chrome) at the
 * mobile (390x844) viewport on the Chromium desktop project.
 *
 * Failures here mean a layout regression that ships horizontal scroll
 * to the dashboard's mobile users — the highest-fidelity audience for
 * the SEE-DECIDE-FORK loop on phones.
 */
import { test, expect } from '@playwright/test';

const TABS = ['quickstart', 'studio', 'sim', 'viz', 'chat', 'reports', 'library', 'settings'] as const;

interface Offender {
  tag: string;
  cls: string;
  right: number;
  width: number;
}

test.describe('Mobile responsive @mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const tab of TABS) {
    test(`no horizontal overflow on /sim?tab=${tab}`, async ({ page }) => {
      await page.goto(`/sim?tab=${tab}`);
      await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('tab-loading')).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const result = await page.evaluate(() => {
        const docW = document.documentElement.clientWidth;
        const offenders: Offender[] = [];
        // An element only counts as overflow if it's NOT inside an
        // ancestor that explicitly scrolls horizontally. Tab bars, code
        // blocks, and dense tables intentionally allow overflow with
        // overflow-x: auto/scroll — children of those are off-canvas
        // by design, and on the dashboard the user pans with their
        // finger.
        function isInsideHScroller(el: Element | null): boolean {
          while (el && el !== document.body) {
            const cs = getComputedStyle(el as HTMLElement);
            if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return true;
            el = el.parentElement;
          }
          return false;
        }
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const cs = getComputedStyle(el);
          if (cs.position === 'absolute' && (cs.clip !== 'auto' || cs.left.startsWith('-'))) continue;
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          // Menus and popovers sit on
          // a fixed/absolute layer; their content can extend past the
          // viewport without forcing horizontal page scroll. Skip
          // anything inside a position:fixed/absolute layer that the
          // page itself isn't anchored to.
          if (cs.position === 'fixed') continue;
          if (isInsideHScroller(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.right > docW + 1 && r.width > 0) {
            offenders.push({ tag: el.tagName, cls: (el.getAttribute('class') ?? '').slice(0, 60), right: Math.round(r.right), width: Math.round(r.width) });
          }
        }
        return { docW, offenders: offenders.slice(0, 5) };
      });
      expect(
        result.offenders,
        `Horizontal overflow on /sim?tab=${tab} (docW=${result.docW}): ${JSON.stringify(result.offenders, null, 2)}`,
      ).toHaveLength(0);
    });
  }
});
