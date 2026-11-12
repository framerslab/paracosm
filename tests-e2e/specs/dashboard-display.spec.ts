/**
 * What a run's pages show: the Library's replay result and its replay match
 * figure, and on the Sim tab a salvaged report and the commander's bar.
 *
 * The Library tests talk to the real server, over HTTP, with three stored
 * Mars Genesis runs in its run history (tests-e2e/support/library-replay-server.ts):
 * Replay asks the server, which replays the stored artifact and counts the
 * attempt in GET /api/v1/runs/aggregate.
 *
 * The Sim tab test serves one run's stream from here, frame by frame as the
 * orchestrator and the server write them, on the default server.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stored runs live on a local server of their own.');
// One server holds the replay counters these tests read, so they run in
// order, and a retry would start from the counts an earlier attempt left.
test.describe.configure({ mode: 'default', retries: 0 });

const LIBRARY = 'http://127.0.0.1:3460';

const card = (page: Page, leader: string) => page.getByRole('article', { name: `Run mars-genesis by ${leader}` });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Run detail' });
/** The Replay match figure in the Library's stats strip. */
const replayMatch = (page: Page) => page.getByText('Replay match', { exact: true }).locator('xpath=..');

/** The figure the strip should show for the server's counters now. */
async function serverReplayMatch(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${LIBRARY}/api/v1/runs/aggregate`);
  expect(res.ok()).toBe(true);
  const agg = await res.json() as { replaysAttempted: number; replaysMatched: number };
  return agg.replaysAttempted > 0 ? `${Math.round((agg.replaysMatched / agg.replaysAttempted) * 100)}%` : 'n/a';
}

/** The server's replay counters now, with the figure the strip should show for them. */
async function serverReplays(request: APIRequestContext): Promise<{ attempted: number; figure: string }> {
  const res = await request.get(`${LIBRARY}/api/v1/runs/aggregate`);
  expect(res.ok()).toBe(true);
  const agg = await res.json() as { replaysAttempted: number };
  return { attempted: agg.replaysAttempted, figure: await serverReplayMatch(request) };
}

async function openAndReplay(page: Page, leader: string): Promise<void> {
  await card(page, leader).getByRole('button', { name: 'Open' }).click();
  await expect(drawer(page).getByRole('heading', { name: 'Mars Genesis' })).toBeVisible();
  await drawer(page).getByRole('button', { name: 'Replay', exact: true }).click();
}

async function closeDrawer(page: Page): Promise<void> {
  await drawer(page).getByRole('button', { name: 'Close detail' }).click();
  await expect(drawer(page)).toHaveCount(0);
}

test.describe('Library replay @library', () => {
  test.use({ baseURL: LIBRARY });

  test('the Replay match figure follows each replay the page runs', async ({ page, request }) => {
    await page.goto('/sim?tab=library');
    await expect(card(page, 'Changed run')).toBeVisible();
    await expect(replayMatch(page)).toContainText(await serverReplayMatch(request));

    await openAndReplay(page, 'Changed run');
    await expect(drawer(page)).toContainText('Diverged at');
    await expect(replayMatch(page)).toContainText(await serverReplayMatch(request));
    await closeDrawer(page);

    await openAndReplay(page, 'Recorded run');
    await expect(drawer(page)).toContainText('Kernel deterministic');
    await expect(replayMatch(page)).toContainText(await serverReplayMatch(request));
  });

  test('a replay that diverges shows the whole place and both values the server names', async ({ page }) => {
    await page.goto('/sim?tab=library');
    await openAndReplay(page, 'Changed run');
    // The server names the second between-turn step's morale, recorded value
    // first: "/scenarioExtensions/kernelSnapshotsAfterProgression/1/state/metrics/morale (0.123456789 vs ...)".
    await expect(drawer(page)).toContainText('/scenarioExtensions/kernelSnapshotsAfterProgression/1/state/metrics/morale (0.123456789 vs ');
  });

  test('a run replay cannot verify shows the whole reason and what to do', async ({ page }) => {
    await page.goto('/sim?tab=library');
    await openAndReplay(page, 'Older run');
    await expect(drawer(page)).toContainText('Replay cannot verify this run: it holds no snapshot of the state right after each between-turn step');
    await expect(drawer(page)).toContainText('run the simulation again to get a run replay can verify.');
  });

  test('the Replay match figure follows a replay the server counted after the drawer was closed', async ({ page, request }) => {
    await page.goto('/sim?tab=library');
    await expect(card(page, 'Recorded run')).toBeVisible();
    const before = await serverReplays(request);
    await expect(replayMatch(page)).toContainText(before.figure);

    // The server replays the run and counts it, and its answer reaches the
    // page once the drawer is closed.
    await page.route('**/api/v1/runs/*/replay', async route => {
      const answer = await route.fetch();
      await closeDrawer(page);
      await route.fulfill({ response: answer });
    });
    await openAndReplay(page, 'Recorded run');
    await expect(drawer(page)).toHaveCount(0);
    await expect.poll(async () => (await serverReplays(request)).attempted).toBe(before.attempted + 1);

    // A match after the replays of the tests above moves the figure, so a
    // strip that did not read the counters again still shows the old one.
    const after = await serverReplays(request);
    expect(after.figure).not.toBe(before.figure);
    await expect(replayMatch(page)).toContainText(after.figure);
  });

  test('a new filter set shows none of the last set\'s figures while its own load', async ({ page }) => {
    await page.goto('/sim?tab=library');
    await expect(replayMatch(page)).toBeVisible();

    // Hold the server's answer for the new filter set.
    let release = (): void => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(
      url => url.pathname === '/api/v1/runs/aggregate' && url.searchParams.get('mode') === 'batch-point',
      async route => { await held; await route.continue(); },
    );
    await page.getByRole('button', { name: '+ Filter' }).click();
    await page.getByRole('dialog', { name: 'Add filter' }).getByRole('button', { name: 'batch-point' }).click();
    await expect(page.getByRole('button', { name: 'Remove mode: batch-point' })).toBeVisible();
    // The stored runs are turn-loop runs: their totals are not this filter set's.
    await expect(page.getByText('Replay match', { exact: true })).toHaveCount(0);

    release();
    await expect(replayMatch(page)).toContainText('n/a');
  });
});

test.describe('A run on the Sim tab @sim', () => {
  const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const ARIA = { name: 'Aria Chen', archetype: 'The Visionary' };
  const DIETRICH = { name: 'Dietrich Voss', archetype: 'The Engineer' };
  const turn = { turn: 1, time: 2035 };
  const sim = (leader: string, type: string, data: Record<string, unknown>) => sse('sim', { type, leader, data: { ...turn, ...data } });

  /** One leader's first turn, as the orchestrator emits it, with what `extra` adds after the department's report. */
  const leaderTurn = (leader: string, choice: string, outcome: string, extra: string[]) => [
    sim(leader, 'turn_start', { title: 'Landfall', crisis: 'Choose a landing site.', category: 'environmental', births: 0, deaths: 0, metrics: { population: 30, morale: 0.85 }, emergent: false, turnSummary: '', totalEvents: 1, pacing: 'normal' }),
    sim(leader, 'event_start', { eventIndex: 0, totalEvents: 1, title: 'Landfall', description: 'Choose a landing site.', category: 'environmental', emergent: false, turnSummary: '', pacing: 'normal' }),
    sim(leader, 'specialist_start', { department: 'engineering', eventIndex: 0 }),
    ...extra,
    sim(leader, 'specialist_done', { department: 'engineering', summary: 'engineering report: the plains are safer.', eventIndex: 0, citations: 0, citationList: [], risks: [], forgedTools: [], recommendedActions: [] }),
    sim(leader, 'decision_pending', { eventIndex: 0 }),
    sim(leader, 'decision_made', { decision: choice, rationale: choice, reasoning: choice, selectedPolicies: [], eventIndex: 0 }),
    sim(leader, 'outcome', { outcome, category: 'environmental', emergent: false, systemDeltas: { morale: 0.02 }, eventIndex: 0 }),
    sim(leader, 'turn_done', { metrics: { population: 30, morale: 0.87 } }),
  ];

  /**
   * A leader's result as the pair runner writes it (`leaderTag` in
   * src/cli/pair-runner.ts): the event names the leader by its tag, the
   * archetype in kebab case without "The", where the `sim` events carry the
   * leader's name. The artifact keeps that name beside each decision's check
   * against the bar its prompt stated.
   */
  const result = (leader: { name: string; archetype: string }, barCheck: Record<string, unknown>) => sse('result', {
    leader: leader.archetype.toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, '-'),
    summary: { population: 30, morale: 0.87 },
    fingerprint: null,
    artifact: {
      metadata: { runId: `run_${leader.name.split(' ')[0].toLowerCase()}`, scenario: { id: 'mars-genesis', name: 'Mars Genesis' }, seed: 950, mode: 'turn-loop', startedAt: '2026-11-12T00:00:00.000Z' },
      scenarioExtensions: {
        paracosmInternal: {
          leader: { name: leader.name, archetype: leader.archetype },
          commanderDecisions: [{ ...turn, eventIndex: 0, eventTitle: 'Landfall', decision: { decision: '', rationale: '', barDeparture: '' }, outcome: 'conservative_success', barCheck }],
          barChecks: { decisions: 1, followed: barCheck.departs ? 0 : 1, departed: barCheck.departs ? 1 : 0, departedWithoutFact: barCheck.unexplained ? 1 : 0 },
        },
      },
    },
  });

  const body = [
    sse('connected', {}),
    sse('active_scenario', { id: 'mars-genesis', name: 'Mars Genesis', runKey: 'a-finished-pair-run', forkedFrom: null }),
    sse('status', { phase: 'starting', maxTurns: 1, customEvents: [] }),
    sse('status', { phase: 'parallel', actors: [ARIA, DIETRICH] }),
    // Aria Chen's engineering report failed its schema on an effect key the
    // run does not hold, and the run kept the report without it.
    ...leaderTurn(ARIA.name, 'Select Arcadia Planitia for the first settlement.', 'conservative_success', [
      sim(ARIA.name, 'validation_fallback', {
        site: 'dept:engineering:turn1:event1',
        schemaName: 'DepartmentReport',
        rawTextPreview: '{"summary":"engineering report"}',
        error: 'Validation failed after 3 attempts; the report was kept without the effect keys the run does not hold',
        salvaged: true,
        droppedKeys: ['habitatShielding'],
      }),
    ]),
    // Dietrich Voss's decision reply failed its schema every time, and the run took the fallback.
    ...leaderTurn(DIETRICH.name, 'Select Arcadia Planitia for the first settlement.', 'conservative_success', [
      sim(DIETRICH.name, 'validation_fallback', {
        site: 'commander:turn1:event1',
        schemaName: 'CommanderDecision',
        rawTextPreview: '{}',
        error: 'Validation failed after 3 attempts',
      }),
    ]),
    // Aria Chen's bar was 82 and the bold option's chance 80: she refused it.
    result(ARIA, { boldChance: 80, bar: 82, clearsBar: false, choseBold: false, departs: false, departureFact: '', unexplained: false }),
    // Dietrich Voss's bar was 36 and the chance 80, yet he refused it and named no fact.
    result(DIETRICH, { boldChance: 80, bar: 36, clearsBar: true, choseBold: false, departs: true, departureFact: '', unexplained: true }),
    sse('complete', { timestamp: '2026-11-12T00:01:00.000Z' }),
    sse('replay_done', {}),
  ].join('');

  test('a report kept without unheld keys is not counted as a fallback, and each decision shows the bar it was checked against', async ({ page }) => {
    await page.route('**/events', route => route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body }));
    await page.goto('/sim?tab=sim');

    await expect(page.getByLabel('1 validation fallback, 1 reply kept without the keys the run does not hold')).toBeVisible();
    await expect(page.getByLabel(/validation fallbacks/)).toHaveCount(0);

    await expect(page.getByText("Bar 82: the bold option's chance 80 is under it, so the bold option was refused", { exact: true })).toBeVisible();
    await expect(page.getByText("Bar 36: the bold option's chance 80 clears it, yet the bold option was refused, with no fact named for it", { exact: true })).toBeVisible();
  });

  /**
   * A `validation_fallback` event as the orchestrator emits it: no turn,
   * event or department of its own, only the call site that names them.
   */
  const schemaEvent = (leader: string, data: Record<string, unknown>) => sse('sim', { type: 'validation_fallback', leader, data });

  test('each schema event of one leader is counted once, a kept report apart from a fallback', async ({ page }) => {
    const salvage = schemaEvent(ARIA.name, {
      site: 'dept:engineering:turn1:event1',
      schemaName: 'DepartmentReport',
      rawTextPreview: '{"summary":"engineering report"}',
      error: 'Validation failed after 3 attempts; the report was kept without the effect keys the run does not hold',
      salvaged: true,
      droppedKeys: ['habitatShielding'],
    });
    const fallback = schemaEvent(ARIA.name, {
      site: 'commander:turn1:event1',
      schemaName: 'CommanderDecision',
      rawTextPreview: '{}',
      error: 'Validation failed after 3 attempts',
    });
    const oneLeader = [
      sse('connected', {}),
      sse('active_scenario', { id: 'mars-genesis', name: 'Mars Genesis', runKey: 'a-finished-run-of-one-leader', forkedFrom: null }),
      sse('status', { phase: 'starting', maxTurns: 1, customEvents: [] }),
      sse('status', { phase: 'parallel', actors: [ARIA] }),
      // Aria Chen's engineering report was kept without a key the run does
      // not hold, and her decision reply failed its schema every time.
      ...leaderTurn(ARIA.name, 'Select Arcadia Planitia for the first settlement.', 'conservative_success', [salvage, fallback]),
      // The server's buffer sends the same frames again after a reconnect.
      salvage,
      fallback,
      sse('complete', { timestamp: '2026-11-12T00:01:00.000Z' }),
      sse('replay_done', {}),
    ].join('');
    await page.route('**/events', route => route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: oneLeader }));
    await page.goto('/sim?tab=sim');

    await expect(page.getByLabel('1 validation fallback, 1 reply kept without the keys the run does not hold', { exact: true })).toBeVisible();
  });
});
