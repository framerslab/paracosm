import { expect, type Page } from '@playwright/test';
import { TAB_NAMES } from '../../src/dashboard/src/components/layout/frameWords.js';
import type { ScenarioClientPayload } from '../../src/dashboard/src/hooks/useScenario.js';
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

/** Finds a section menu item by the visible title that precedes its description. */
export function sectionMenuItem(page: Page, title: string) {
  return page.getByRole('menu', { name: 'Sections' }).getByRole('menuitem')
    .filter({ has: page.getByText(title, { exact: true }) });
}

/** Opens a dashboard tab by its accessible key. */
export async function openTab(page: Page, tab: DashboardTab): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Sections' });
  const label = TAB_NAMES[tab];
  await expect(nav).toBeVisible();
  const link = nav.getByRole('link', { name: label, exact: true });
  if (tab === 'quickstart' || tab === 'sim' || (tab === 'reports' && await link.isVisible())) {
    await link.click();
    return;
  }
  // getByRole has no `has` option: the filter picks More out of the row's arrow keys.
  const key = nav.getByRole('button').filter({ has: page.locator('[data-more-label]') });
  if (await key.getAttribute('aria-expanded') !== 'true') await key.click();
  await sectionMenuItem(page, label).click();
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

/** Waits for the dashboard to process the run feed's connection frame before loading a file. */
export async function waitForRunConnection(page: Page): Promise<void> {
  await expect(page.getByRole('main')).toHaveAttribute('data-run-connection', 'connected');
}

/** Changes selected facts on the real scenario response. */
export async function routeScenario(page: Page, patch: (scenario: ScenarioClientPayload) => ScenarioClientPayload): Promise<void> {
  await page.route('**/scenario', async route => {
    const response = await route.fetch();
    const scenario = await response.json() as ScenarioClientPayload;
    await route.fulfill({ response, json: patch(scenario) });
  });
}
