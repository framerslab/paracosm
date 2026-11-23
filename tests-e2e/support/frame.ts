import type { Page } from '@playwright/test';

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
