/**
 * Each run starts the Chat tab's threads empty.
 *
 * The Chat panel stays mounted across tab switches, and it kept its threads,
 * and the history it sends with each message, by leader and name and never
 * by run. A second run of the same scenario holds the same leaders and the
 * same people, so the first run's exchange showed under the second run's
 * person and went to /chat as that person's history (issue #212).
 *
 * The stream is served from here, as a pair run of Mars Genesis, and ends
 * after each replay, so the page reconnects and is handed the run again, as a
 * dropped connection is. The second run is the same scenario, the same
 * leaders and the same person under a new run key. A run restored from the
 * page's history, and a saved session's replay the page switches to without
 * a reload, are runs of their own too. /chat is answered here too, so no
 * model is called.
 */
import { test, expect, type Page, type Request } from '@playwright/test';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stream is served from the test against a local server.');
test.use({ baseURL: 'http://127.0.0.1:3458' });

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const leaders = [
  { name: 'Aria Chen', archetype: 'The Visionary' },
  { name: 'Dietrich Voss', archetype: 'The Engineer' },
];
const PERSON = 'Mira Okafor';
const MARS = { id: 'mars-genesis', name: 'Mars Genesis' };

/**
 * The events of one pair run whose turn has ended, with one person reacting
 * under each leader, as the page holds them: status frames as `status`
 * events with no leader, the rest as the stream's `sim` events.
 */
function runEvents(mood: string, turn = 1) {
  return [
    { type: 'status', leader: '', data: { phase: 'starting', maxTurns: 3, customEvents: [] } },
    { type: 'status', leader: '', data: { phase: 'parallel', actors: leaders } },
    ...leaders.flatMap(leader => [
      {
        type: 'turn_start',
        leader: leader.name,
        data: { turn, time: 2034 + turn, title: 'Dust storm over the landing site', category: 'environmental', crisis: '', births: 0, deaths: 0, metrics: {} },
      },
      {
        type: 'agent_reactions',
        leader: leader.name,
        data: {
          turn,
          time: 2034 + turn,
          reactions: [{
            name: PERSON, role: 'Engineer', department: 'engineering', mood, age: 34,
            marsborn: false, agentId: 'mira-okafor', memory: null,
          }],
        },
      },
    ]),
  ];
}

/** One pair run on the stream, opened by its active_scenario event. */
function runStream(runKey: string, mood: string, scenario = MARS): string {
  return [
    sse('connected', {}),
    sse('active_scenario', { ...scenario, runKey, forkedFrom: null }),
    ...runEvents(mood).map(e => (e.type === 'status' ? sse('status', e.data) : sse('sim', e))),
    sse('replay_done', {}),
  ].join('');
}

/** Answers each /chat POST here and keeps its request. */
async function answerChat(page: Page): Promise<Request[]> {
  const chatRequests: Request[] = [];
  await page.route('**/chat', route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    chatRequests.push(request);
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: `Reply ${chatRequests.length} from the colony.`, colonist: PERSON }),
    });
  });
  return chatRequests;
}

const chat = (page: Page) => page.getByRole('region', { name: 'Agent chat' });
const person = (page: Page) => chat(page).getByRole('button', { name: new RegExp(`^${PERSON}`) });
const thread = (page: Page) => chat(page).getByRole('log', { name: `Messages with ${PERSON}` });
const input = (page: Page) => chat(page).getByRole('textbox', { name: `Message ${PERSON}` });

const FIRST_MESSAGE = 'What did the dust storm do to the habitat?';

/** Opens the person's thread and sends the first message, which the test answers. */
async function chatOnce(page: Page, chatRequests: Request[]) {
  await person(page).click();
  await expect(thread(page).getByText(/I lived through this simulation/)).toHaveCount(1);
  await input(page).fill(FIRST_MESSAGE);
  await input(page).press('Enter');
  await expect(thread(page).getByText('Reply 1 from the colony.')).toBeVisible();
  expect(chatRequests).toHaveLength(1);
  expect(chatRequests[0].postDataJSON().history).toEqual([{ role: 'user', content: FIRST_MESSAGE }]);
}

/** The person's thread holds the greeting alone, and the next message goes to /chat with no earlier turn. */
async function expectFreshThread(page: Page, chatRequests: Request[]) {
  await person(page).click();
  await expect(thread(page).getByText(/I lived through this simulation/)).toHaveCount(1);
  await expect(thread(page).getByText(FIRST_MESSAGE)).toHaveCount(0);
  await expect(thread(page).getByText('Reply 1 from the colony.')).toHaveCount(0);

  await input(page).fill('How is the colony now?');
  await input(page).press('Enter');
  await expect(thread(page).getByText('Reply 2 from the colony.')).toBeVisible();
  expect(chatRequests).toHaveLength(2);
  expect(chatRequests[1].postDataJSON().history).toEqual([
    { role: 'user', content: 'How is the colony now?' },
  ]);
}

test.describe('Chat threads per run @chat', () => {
  test('a second run of the same scenario starts the same person\'s thread empty and sends no earlier turn', async ({ page }) => {
    let body = runStream('chat-run-first', 'anxious');
    let served = 0;
    await page.route('**/events', route => {
      served += 1;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
    });
    const chatRequests = await answerChat(page);

    await page.goto('/sim?tab=sim');
    await page.getByRole('tab', { name: 'CHAT', exact: true }).click();

    // The first run: the person's thread opens with its greeting, then a message and its reply.
    await expect(person(page)).toContainText('ANXIOUS');
    await chatOnce(page, chatRequests);

    // The same run handed to the page again after a dropped connection keeps the thread.
    const seen = served;
    await expect.poll(() => served).toBeGreaterThan(seen + 2);
    await expect(thread(page).getByText(FIRST_MESSAGE)).toBeVisible();
    await expect(thread(page).getByText('Reply 1 from the colony.')).toBeVisible();

    // The second run of the same scenario: the same leaders and the same person under a new run key.
    body = runStream('chat-run-second', 'hopeful');
    await expect(person(page)).toContainText('HOPEFUL');
    await expectFreshThread(page, chatRequests);
  });

  test('a run the visitor starts in another scenario leaves the shown run\'s threads as they were', async ({ page }) => {
    // The visitor starts a run in another scenario from another tab. This
    // page skips that run and goes on showing its own, ended as interrupted,
    // so the threads with that run's people stay.
    let body = runStream('chat-run-shown', 'anxious');
    let served = 0;
    await page.route('**/events', route => {
      served += 1;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
    });
    const chatRequests = await answerChat(page);

    await page.goto('/sim?tab=sim');
    await page.getByRole('tab', { name: 'CHAT', exact: true }).click();
    await expect(person(page)).toContainText('ANXIOUS');
    await chatOnce(page, chatRequests);

    body = runStream('chat-run-elsewhere', 'hopeful', { id: 'atlas-lab', name: 'Atlas Lab' });
    await expect(page.getByRole('status', { name: /^Interrupted\. Run interrupted: you started another run/ }).first()).toBeVisible();
    const seen = served;
    await expect.poll(() => served).toBeGreaterThan(seen + 1);

    await expect(person(page)).toContainText('ANXIOUS');
    await person(page).click();
    await expect(thread(page).getByText(FIRST_MESSAGE)).toBeVisible();
    await expect(thread(page).getByText('Reply 1 from the colony.')).toBeVisible();
  });

  test('a second run restored from the page\'s history starts the same person\'s thread empty and sends no earlier turn', async ({ page }) => {
    // Two runs of Mars Genesis kept in the browser's history, with the same
    // leaders and the same person, restored one after the other from the RUN
    // menu. Neither has a run key, so each load is a run of its own. The
    // stream holds no run.
    const entry = (id: number, mood: string, turn: number) => {
      const events = runEvents(mood, turn);
      return {
        id,
        createdAt: new Date(id).toISOString(),
        events,
        results: [],
        verdict: null,
        scenarioShortName: 'mars',
        summary: { actorNames: leaders.map(l => l.name), turnCount: turn, eventCount: events.length },
      };
    };
    const ring = [entry(Date.now() - 60_000, 'anxious', 1), entry(Date.now() - 120_000, 'hopeful', 2)];
    await page.addInitScript(value => {
      window.localStorage.setItem('paracosm-local-history-v2', value);
    }, JSON.stringify(ring));
    let served = 0;
    await page.route('**/events', route => {
      served += 1;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse('connected', {}) + sse('replay_done', {}) });
    });
    page.on('dialog', dialog => dialog.accept());
    const chatRequests = await answerChat(page);
    const restore = async (turns: RegExp) => {
      await page.getByRole('button', { name: 'RUN', exact: true }).click();
      await page.getByRole('menu', { name: 'Run actions' }).getByRole('button', { name: turns }).first().click();
    };

    await page.goto('/sim?tab=sim');
    await expect.poll(() => served).toBeGreaterThan(1);
    await page.getByRole('tab', { name: 'CHAT', exact: true }).click();

    await restore(/· 1 turn/);
    await expect(person(page)).toContainText('ANXIOUS');
    await chatOnce(page, chatRequests);

    await restore(/· 2 turns/);
    await expect(person(page)).toContainText('HOPEFUL');
    await expectFreshThread(page, chatRequests);
  });

  test('a saved session the page switches to after a run restored from its history starts the same person\'s thread empty', async ({ page }) => {
    // A Mars Genesis run restored from the RUN menu, then a saved session of
    // Mars Genesis with the same leaders and person, which the page switches
    // to without a reload, as the browser's Back and Forward buttons do.
    const events = runEvents('anxious', 1);
    const ring = [{
      id: Date.now() - 60_000,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      events,
      results: [],
      verdict: null,
      scenarioShortName: 'mars',
      summary: { actorNames: leaders.map(l => l.name), turnCount: 1, eventCount: events.length },
    }];
    await page.addInitScript(value => {
      window.localStorage.setItem('paracosm-local-history-v2', value);
    }, JSON.stringify(ring));
    let served = 0;
    await page.route('**/events', route => {
      served += 1;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse('connected', {}) + sse('replay_done', {}) });
    });
    const SESSION = 'chat-saved-session';
    await page.route(url => url.pathname === `/sessions/${SESSION}`, route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }));
    await page.route(url => url.pathname === `/sessions/${SESSION}/replay`, route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: runStream('chat-run-saved-session', 'hopeful'),
    }));
    page.on('dialog', dialog => dialog.accept());
    const chatRequests = await answerChat(page);

    await page.goto('/sim?tab=sim');
    await expect.poll(() => served).toBeGreaterThan(1);
    await page.getByRole('tab', { name: 'CHAT', exact: true }).click();

    await page.getByRole('button', { name: 'RUN', exact: true }).click();
    await page.getByRole('menu', { name: 'Run actions' }).getByRole('button', { name: /· 1 turn/ }).first().click();
    await expect(person(page)).toContainText('ANXIOUS');
    await chatOnce(page, chatRequests);

    await page.evaluate(session => {
      const url = new URL(window.location.href);
      url.searchParams.set('replay', session);
      window.history.pushState({}, '', url.toString());
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, SESSION);
    await expect(person(page)).toContainText('HOPEFUL');
    await expectFreshThread(page, chatRequests);
  });
});
