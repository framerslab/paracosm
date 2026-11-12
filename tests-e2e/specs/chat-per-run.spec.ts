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
 * leaders and the same person under a new run key. /chat is answered here
 * too, so no model is called.
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

/** One pair run of Mars Genesis whose first turn has ended, with one person reacting under each leader. */
function runStream(runKey: string, mood: string): string {
  return [
    sse('connected', {}),
    sse('active_scenario', { id: 'mars-genesis', name: 'Mars Genesis', runKey, forkedFrom: null }),
    sse('status', { phase: 'starting', maxTurns: 3, customEvents: [] }),
    sse('status', { phase: 'parallel', actors: leaders }),
    ...leaders.flatMap(leader => [
      sse('sim', {
        type: 'turn_start',
        leader: leader.name,
        data: { turn: 1, time: 2035, title: 'Dust storm over the landing site', category: 'environmental', crisis: '', births: 0, deaths: 0, metrics: {} },
      }),
      sse('sim', {
        type: 'agent_reactions',
        leader: leader.name,
        data: {
          turn: 1,
          time: 2035,
          reactions: [{
            name: PERSON, role: 'Engineer', department: 'engineering', mood, age: 34,
            marsborn: false, agentId: 'mira-okafor', memory: null,
          }],
        },
      }),
    ]),
    sse('replay_done', {}),
  ].join('');
}

const chat = (page: Page) => page.getByRole('region', { name: 'Agent chat' });
const person = (page: Page) => chat(page).getByRole('button', { name: new RegExp(`^${PERSON}`) });
const thread = (page: Page) => chat(page).getByRole('log', { name: `Messages with ${PERSON}` });
const input = (page: Page) => chat(page).getByRole('textbox', { name: `Message ${PERSON}` });

test.describe('Chat threads per run @chat', () => {
  test('a second run of the same scenario starts the same person\'s thread empty and sends no earlier turn', async ({ page }) => {
    let body = runStream('chat-run-first', 'anxious');
    let served = 0;
    await page.route('**/events', route => {
      served += 1;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
    });
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

    await page.goto('/sim?tab=sim');
    await page.getByRole('tab', { name: 'CHAT', exact: true }).click();

    // The first run: the person's thread opens with its greeting, then a message and its reply.
    await expect(person(page)).toContainText('ANXIOUS');
    await person(page).click();
    await expect(thread(page).getByText(/I lived through this simulation/)).toHaveCount(1);
    await input(page).fill('What did the dust storm do to the habitat?');
    await input(page).press('Enter');
    await expect(thread(page).getByText('Reply 1 from the colony.')).toBeVisible();
    expect(chatRequests).toHaveLength(1);
    expect(chatRequests[0].postDataJSON().history).toEqual([
      { role: 'user', content: 'What did the dust storm do to the habitat?' },
    ]);

    // The same run handed to the page again after a dropped connection keeps the thread.
    const seen = served;
    await expect.poll(() => served).toBeGreaterThan(seen + 2);
    await expect(thread(page).getByText('What did the dust storm do to the habitat?')).toBeVisible();
    await expect(thread(page).getByText('Reply 1 from the colony.')).toBeVisible();

    // The second run of the same scenario: the same leaders and the same person under a new run key.
    body = runStream('chat-run-second', 'hopeful');
    await expect(person(page)).toContainText('HOPEFUL');
    await person(page).click();
    await expect(thread(page).getByText(/I lived through this simulation/)).toHaveCount(1);
    await expect(thread(page).getByText('What did the dust storm do to the habitat?')).toHaveCount(0);
    await expect(thread(page).getByText('Reply 1 from the colony.')).toHaveCount(0);

    // The next message goes to /chat with no turn of the first run.
    await input(page).fill('How is the colony now?');
    await input(page).press('Enter');
    await expect(thread(page).getByText('Reply 2 from the colony.')).toBeVisible();
    expect(chatRequests).toHaveLength(2);
    expect(chatRequests[1].postDataJSON().history).toEqual([
      { role: 'user', content: 'How is the colony now?' },
    ]);
  });
});
