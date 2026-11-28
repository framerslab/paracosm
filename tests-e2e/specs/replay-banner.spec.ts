/**
 * Track 1B regression: the active replay banner must read as INFO, not
 * error. Earlier the banner used `var(--accent)` (rust) as its
 * background, with secondary text dropped to `opacity: 0.55` — the
 * combination put metadata under WCAG AA on the warm background.
 *
 * This spec runs against any cached session the test server happens to
 * have. On a fresh server with zero sessions it skips. The structural
 * regression (no inline opacity, "· No model is called." separator) is
 * covered by the SSR unit test in
 * `src/cli/dashboard/src/components/layout/ReplayBanner.test.tsx` so
 * the fix is locked in even when the e2e skips.
 */
import { test, expect } from '@playwright/test';

interface SessionsResponse {
  sessions?: Array<{ id: string }>;
}

test.describe('Replay banner @replay', () => {
  test('renders with neutral palette and a separator before "No model is called."', async ({ page, request }) => {
    const sessionsRes = await request.get('/sessions');
    test.skip(!sessionsRes.ok(), 'GET /sessions returned non-2xx — server not ready');
    const list = (await sessionsRes.json()) as SessionsResponse;
    test.skip(!list.sessions?.length, 'no sessions cached on the test server');
    const id = list.sessions![0].id;

    await page.goto(`/sim?replay=${encodeURIComponent(id)}`);

    const banner = page.getByRole('status').filter({ hasText: /^Watching a saved run/i });
    await expect(banner).toBeVisible({ timeout: 15_000 });

    // The background must NOT be the rust accent (#e06530 ≈ 224,101,48).
    const bg = await banner.evaluate((el) => getComputedStyle(el).backgroundColor);
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(bg);
    expect(m, `Unparseable background ${bg}`).toBeTruthy();
    const [, rs, gs, bs] = m!;
    const r = Number(rs);
    const g = Number(gs);
    const b = Number(bs);
    const dist = Math.hypot(r - 224, g - 101, b - 48);
    expect(dist, `Banner background is too close to the rust accent (got ${bg})`).toBeGreaterThan(80);

    // The cached-playback tag must have a separator preceding it. The
    // bug surfaced as "8:28 AMNo model is called." with no visual break.
    const text = await banner.innerText();
    expect(text).toMatch(/No model is called\./);
  });

  test('exit button removes ?replay= query param', async ({ page, request }) => {
    const sessionsRes = await request.get('/sessions');
    test.skip(!sessionsRes.ok(), 'server not ready');
    const list = (await sessionsRes.json()) as SessionsResponse;
    test.skip(!list.sessions?.length, 'no sessions to replay');
    const id = list.sessions![0].id;

    await page.goto(`/sim?replay=${encodeURIComponent(id)}`);
    await page.getByRole('button', { name: /Leave the replay/i }).click();
    await expect(page).toHaveURL(/^[^?]*(\?(?!.*\breplay=).*)?$/);
  });
});
