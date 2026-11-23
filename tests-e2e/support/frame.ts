import type { Page } from '@playwright/test';
import type { DashboardTab } from '../../src/dashboard/src/tab-routing.js';

export const SERVERS = {
  dashboard: 'http://127.0.0.1:3456',
  admin: 'http://127.0.0.1:3461',
  replay: 'http://127.0.0.1:3462',
  consent: 'http://127.0.0.1:3464',
  demo: 'http://127.0.0.1:3470',
} as const;

export const ENTRY_SCRIPT = '**/assets/index-*.js';

export async function holdScript(page: Page, ms: number): Promise<void> {
  await page.route(ENTRY_SCRIPT, async (route) => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

export async function lookOf(page: Page): Promise<{ light: boolean; scheme: string; ground: string; metas: string[] }> {
  return page.evaluate(() => ({
    light: document.documentElement.classList.contains('light'),
    scheme: getComputedStyle(document.documentElement).colorScheme,
    ground: getComputedStyle(document.body).backgroundColor,
    metas: Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'), (meta) => meta.content),
  }));
}

/** Opens a dashboard tab by its accessible key. */
export async function openTab(page: Page, tab: DashboardTab): Promise<void> {
  await page.getByRole('tab', { name: tab.toUpperCase(), exact: true }).click();
}

/** Scales the computed text sizes together, including fixed pixel line heights. */
export async function scaleText(page: Page, factor: number): Promise<void> {
  await page.evaluate((scale) => {
    const entries = Array.from(document.querySelectorAll<HTMLElement>('body, body *')).flatMap(element => {
      if (!(element instanceof HTMLElement)) return [];
      const style = getComputedStyle(element);
      return [{ element, fontSize: parseFloat(style.fontSize), lineHeight: style.lineHeight }];
    });
    for (const { element, fontSize, lineHeight } of entries) {
      if (Number.isFinite(fontSize)) element.style.setProperty('font-size', fontSize * scale + 'px', 'important');
      if (lineHeight.endsWith('px')) element.style.setProperty('line-height', parseFloat(lineHeight) * scale + 'px', 'important');
    }
  }, factor);
}
