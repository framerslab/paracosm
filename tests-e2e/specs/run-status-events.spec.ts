/**
 * The page keeps every status event of a run.
 *
 * A pair run writes two: `phase: 'starting'` with the turn count, then
 * `phase: 'parallel'` with the leaders, and only the second tells the page the
 * run is running. The page's dedupe key for a status event held its type and
 * nothing else, so it kept the first and dropped the second: a live run read
 * "Idle" in the footer, showed no progress bar and kept the RUN button that
 * starts another run over it.
 *
 * The first test talks to the real server, over HTTP and SSE, with its pair
 * runner stubbed (tests-e2e/support/pair-run-server.ts), and starts the run
 * from the page's own Run button. The second serves the stream from here and
 * ends it after each replay, so the page reconnects and is handed the whole
 * run again, as a dropped connection is.
 */
import { test, expect, type Page } from '@playwright/test';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stub pair runner runs on a local server of its own.');
test.use({ baseURL: 'http://127.0.0.1:3458' });
test.describe.configure({ mode: 'default' });

const running = (page: Page) => page.getByRole('status', { name: /^Simulation status: Running\./ });
const idle = (page: Page) => page.getByRole('status', { name: /^Simulation status: Idle\./ });
const progress = (page: Page, maxTurns: number | RegExp) =>
  page.getByText(typeof maxTurns === 'number' ? `Turn 1 / ${maxTurns}` : maxTurns, { exact: true });
const runMenuButton = (page: Page) => page.getByRole('button', { name: 'RUN', exact: true });
const emptyStateRun = (page: Page) => page.getByRole('button', { name: /^(Run Simulation|Loading scenario)/ });

test.describe('Run status events @status', () => {
  test('a run started from the page shows as running from its second status event on', async ({ page, request }) => {
    expect((await request.post('/clear')).ok()).toBe(true);
    await page.goto('/sim?tab=sim');
    await expect(emptyStateRun(page)).toBeEnabled();
    await emptyStateRun(page).click();

    await expect(running(page)).toBeVisible();
    await expect(progress(page, /^Turn 1 \/ \d+$/)).toBeVisible();
    await expect(runMenuButton(page)).toHaveCount(0);

    // A page that opens during the run is handed both frames in the replay.
    await page.reload();
    await expect(running(page)).toBeVisible();
    await expect(progress(page, /^Turn 1 \/ \d+$/)).toBeVisible();
    await expect(idle(page)).toHaveCount(0);
  });

  test('a page that reconnects during a run keeps it running', async ({ page }) => {
    const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const leaders = [
      { name: 'Aria Chen', archetype: 'The Visionary' },
      { name: 'Dietrich Voss', archetype: 'The Engineer' },
    ];
    const body = [
      sse('connected', {}),
      sse('active_scenario', { id: 'mars-genesis', name: 'Mars Genesis', runKey: 'a-pair-run-in-flight', forkedFrom: null }),
      sse('status', { phase: 'starting', maxTurns: 4, customEvents: [] }),
      sse('status', { phase: 'parallel', actors: leaders }),
      ...leaders.map(leader => sse('sim', {
        type: 'turn_start',
        leader: leader.name,
        data: { turn: 1, time: 2035, title: 'Director generating...', crisis: '', births: 0, deaths: 0, metrics: {} },
      })),
      sse('replay_done', {}),
    ].join('');
    let served = 0;
    await page.route('**/events', route => {
      served += 1;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
    });

    await page.goto('/sim?tab=sim');
    await expect(running(page)).toBeVisible();
    await expect(progress(page, 4)).toBeVisible();

    const seen = served;
    await expect.poll(() => served).toBeGreaterThan(seen + 2);
    await expect(running(page)).toBeVisible();
    await expect(progress(page, 4)).toBeVisible();
    await expect(runMenuButton(page)).toHaveCount(0);

    // However often the page was handed the run, it holds each frame once:
    // the two status frames and each leader's turn_start.
    await page.getByRole('tab', { name: 'SETTINGS', exact: true }).click();
    await page.getByRole('tab', { name: 'Event Log', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Event Log (4 events)' })).toBeVisible();
  });
});
