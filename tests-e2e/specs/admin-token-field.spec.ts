/**
 * The admin token is entered in Settings.
 *
 * On a server with admin writes on (ADMIN_WRITE=true and an ADMIN_TOKEN) the
 * dashboard sends the token this browser keeps under the localStorage key
 * paracosm:adminToken on four kinds of call: Save to Disk, Delete server data
 * in the run actions menu, and Rename and Delete in a scenario's details.
 * Settings holds an Admin Token field, shown only where admin writes are on,
 * and a refused call says where that field is.
 *
 * The pages talk to a real server of their own with admin writes on
 * (tests-e2e/support/admin-write-server.ts). Its scenarios folder is a
 * temporary one holding one compiled scenario, the scenario saved is a real
 * one (scenarios/submarine.json), no model is called and nothing starts a
 * run. The last test reads the default server, which runs with admin writes
 * off.
 */
import { test, expect, type Locator, type Page, type Request } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The admin-write server runs locally, on a port of its own.');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_BASE = 'http://127.0.0.1:3461';
/** The token tests-e2e/support/admin-write-server.ts starts with; it guards temporary folders only. */
const TOKEN = 'e2e-admin-token';
const TOKEN_KEY = 'paracosm:adminToken';
const submarine = readFileSync(path.resolve(__dirname, '../../scenarios/submarine.json'), 'utf-8');
const SCENARIO_ID = (JSON.parse(submarine) as { id: string }).id;

const WHERE = 'Enter it in Settings, under Admin Token, and press Save.';
const REFUSED = `Disk write refused: the admin token is missing or wrong. ${WHERE}`;
const SAVED = new RegExp(`Saved "${SCENARIO_ID}" (draft JSON )?to disk at scenarios/${SCENARIO_ID}\\.json`);
/** A token the server refuses: a server wipe sent with it removes nothing. */
const WRONG = 'not-the-token';
/** The refusal in a scenario's details, for Rename and for Delete. */
const REFUSED_IN_DRAWER = `Admin token refused and cleared. ${WHERE}`;
/** A token a request header cannot carry: the euro sign is U+20AC. */
const UNSENDABLE_TOKEN = 'tok\u20ACen';
const UNSENDABLE = 'This token holds a character a request header cannot carry, so it is not kept. '
  + 'A token may hold only printable ASCII and Latin-1 characters: U+0020 to U+007E and U+00A0 to U+00FF.';
/**
 * The question Clear local data asks, with a token saved or not. Its POST
 * /clear lets go of this browser's own run on the server and stops it when
 * it is still running, so the question says so.
 */
const CLEAR_QUESTION = 'Clear local data? This wipes the in-browser simulation buffer + cached events for this dashboard.\n\n'
  + "It also lets go of this browser's run on the server, and stops it if it is still running.\n\n"
  + 'Run history, saved sessions, and on-disk artifact files are kept.\n\n'
  + 'Cannot be undone.';
/** What a scenario's details say when the server refused an older token and a newer one is saved. */
const refusedWithNewerToken = (call: string, button: string) =>
  `The server refused the admin token this ${call} was sent with. A newer token is saved in this browser; press ${button} to try again with it.`;
/** Delete server data, when the server's answer did not arrive or could not be read. */
const WIPE_NOT_KNOWN = /Whether the server's data was deleted is not known/;
/** The compiled scenario tests-e2e/support/admin-write-server.ts plants. */
const COMPILED_ID = 'e2e-compiled-scenario';
const COMPILED_NAME = 'E2E Compiled Scenario';

const settingsLaunch = (page: Page) => page.getByRole('button', { name: /Launch simulation|Loading scenario/i });
const editor = (page: Page) => page.getByRole('textbox', { name: 'Scenario JSON editor' });
const saveToDisk = (page: Page) => page.getByRole('button', { name: 'Save scenario to disk' });
const tokenGroup = (page: Page) => page.getByRole('group', { name: 'Admin Token' });
const tokenInput = (page: Page) => page.locator('#admin-token');
const saveToken = (page: Page) => page.getByRole('button', { name: 'Save admin token' });
const clearToken = (page: Page) => page.getByRole('button', { name: 'Clear admin token' });
const tokenStatus = (page: Page) => page.locator('#admin-token-status');
const runActions = (page: Page) => page.getByRole('button', { name: 'Open run actions menu' });
const closeRunActions = (page: Page) => page.getByRole('button', { name: 'Close run actions' });
const clearLocal = (page: Page) => page.getByRole('menuitem', { name: 'Clear local data' });
const deleteServerData = (page: Page) => page.getByRole('menuitem', { name: 'Delete server data' });
const storedToken = (page: Page) => page.evaluate(key => window.localStorage.getItem(key), TOKEN_KEY);

/** Opens Settings on `base` and waits for the form, which follows GET /scenario. */
async function openSettings(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/sim?tab=settings`);
  await expect(settingsLaunch(page)).toBeEnabled();
}

/**
 * Puts the real scenario in the editor. The editor loads the active scenario
 * on its own first; filling before that load lands would be overwritten.
 */
async function fillEditor(page: Page): Promise<void> {
  await expect(editor(page)).toHaveValue(/"id"/);
  await editor(page).fill(submarine);
  await expect(editor(page)).toHaveValue(new RegExp(`"id": "${SCENARIO_ID}"`));
  await expect(saveToDisk(page)).toBeEnabled();
}

/** Every request the page sends, kept for the checks on where the token went. */
function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on('request', request => { requests.push(request); });
  return requests;
}

const isDiskWrite = (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === '/scenario/store';
const isServerWipe = (request: Request) => new URL(request.url()).pathname === '/admin/data/wipe';

/** Saves `token` through the field in Settings. */
async function saveTokenInSettings(page: Page, token: string): Promise<void> {
  await openSettings(page, ADMIN_BASE);
  await tokenInput(page).fill(token);
  await saveToken(page).click();
  await expect(tokenStatus(page)).toHaveText(/A token is saved in this browser/);
}

/** The name every visitor sees for the compiled scenario, or undefined when it is not listed. */
async function compiledName(page: Page): Promise<string | undefined> {
  const body = await (await page.request.get(`${ADMIN_BASE}/scenarios`)).json() as { scenarios: Array<{ id: string; name: string }> };
  return body.scenarios.find(scenario => scenario.id === COMPILED_ID)?.name;
}

/** Opens the compiled scenario's details from the Quickstart catalog. */
async function openCompiledDetails(page: Page): Promise<Locator> {
  await expect.poll(() => compiledName(page), 'the compiled scenario is in the catalog').toBe(COMPILED_NAME);
  await page.goto(`${ADMIN_BASE}/sim?tab=quickstart`);
  await page.getByRole('button', { name: `View detail for ${COMPILED_NAME}` }).click();
  const details = page.getByRole('dialog', { name: `Scenario detail: ${COMPILED_NAME}` });
  await expect(details).toBeVisible();
  return details;
}

/**
 * The scenario files the admin-write server wrote at or after `since`. Its
 * scenarios folder is a temporary one of its own
 * (tests-e2e/support/admin-write-server.ts), and a draft saved to disk is
 * listed by no route, so the file is where the write is read back.
 */
function scenarioFilesWrittenSince(since: number): string[] {
  return readdirSync(tmpdir())
    .filter(name => name.startsWith('paracosm-e2e-admin-write-'))
    .map(name => path.join(tmpdir(), name, 'scenarios', `${SCENARIO_ID}.json`))
    .filter(file => existsSync(file) && statSync(file).mtimeMs >= since);
}

test.describe('Admin token field @admin', () => {
  test('Save to Disk says where to enter the token, works once it is entered, and is refused again once it is cleared', async ({ page }) => {
    // Two seconds of slack for a file system that keeps coarse write times.
    const startedAt = Date.now() - 2000;
    const requests = recordRequests(page);
    await openSettings(page, ADMIN_BASE);
    await fillEditor(page);

    // No token entered: the server answers 401 and the page says where the token goes.
    await saveToDisk(page).click();
    await expect(page.getByText(REFUSED)).toBeVisible();
    expect(requests.filter(isDiskWrite).map(request => request.headers()['x-admin-token'])).toEqual([undefined]);
    // The refusal is what a person acts on, so it reads at 13 px or more like the field it names.
    const refusalPx = await page.getByText(REFUSED).evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(refusalPx, 'the refusal text size').toBeGreaterThanOrEqual(13);

    // The field is a password field with a name, and it does not autofill.
    await expect(tokenInput(page)).toHaveAttribute('type', 'password');
    await expect(tokenInput(page)).toHaveAttribute('autocomplete', 'off');
    await expect(tokenInput(page)).toHaveAccessibleName('Token for this server');
    await expect(tokenStatus(page)).toHaveText(/No token is saved in this browser/);

    // Entered and saved: kept under the one key, never shown back.
    await tokenInput(page).fill(TOKEN);
    await saveToken(page).click();
    await expect(tokenStatus(page)).toHaveText(/A token is saved in this browser/);
    await expect(tokenInput(page)).toHaveValue('');
    expect(await page.evaluate(key => window.localStorage.getItem(key), TOKEN_KEY)).toBe(TOKEN);

    await saveToDisk(page).click();
    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(page.getByText(REFUSED)).toHaveCount(0);
    // The server wrote the scenario into its own scenarios folder, whole. Read
    // again on a miss: another test may be saving the same file at this moment.
    await expect(() => {
      const written = scenarioFilesWrittenSince(startedAt);
      expect(written.length, 'scenario files the server wrote during this test').toBeGreaterThanOrEqual(1);
      expect(JSON.parse(readFileSync(written[0], 'utf-8'))).toEqual(JSON.parse(submarine));
    }).toPass({ timeout: 5000 });

    // The token went out as the header of the disk write and nowhere else.
    const carrying = requests.filter(request => request.headers()['x-admin-token'] !== undefined);
    expect(carrying.length).toBe(1);
    expect(isDiskWrite(carrying[0])).toBe(true);
    expect(carrying[0].headers()['x-admin-token']).toBe(TOKEN);
    expect(requests.filter(request => request.url().includes(TOKEN))).toEqual([]);

    // Cleared: gone from the browser, and the next disk write is refused with the same words.
    await clearToken(page).click();
    await expect(tokenStatus(page)).toHaveText(/No token is saved in this browser/);
    expect(await page.evaluate(key => window.localStorage.getItem(key), TOKEN_KEY)).toBeNull();
    // The save reloaded the active scenario into the editor; whichever scenario it holds, the write is refused first.
    await expect(saveToDisk(page)).toBeEnabled();
    await saveToDisk(page).click();
    await expect(page.getByText(REFUSED)).toBeVisible();
    expect(requests.filter(isDiskWrite).map(request => request.headers()['x-admin-token'])).toEqual([undefined, TOKEN, undefined]);
  });

  test('the field is one row from 320 px up, with phone-size targets and text of 13 px or more', async ({ page }) => {
    const box = async (locator: Locator, what: string) => {
      const found = await locator.boundingBox();
      expect(found, what).not.toBeNull();
      return found!;
    };
    const fontPx = (locator: Locator) => locator.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));

    for (const width of [320, 360, 390, 430, 480, 667, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await openSettings(page, ADMIN_BASE);
      await tokenInput(page).scrollIntoViewIfNeeded();

      const group = await box(tokenGroup(page), `${width}px: the Admin Token group`);
      const input = await box(tokenInput(page), `${width}px: the token input`);
      const save = await box(saveToken(page), `${width}px: Save`);
      const clear = await box(clearToken(page), `${width}px: Clear`);

      // One row: the three share a top edge and a height, and run left to right without overlap.
      for (const control of [save, clear]) {
        expect(Math.abs(control.y - input.y), `${width}px: one row`).toBeLessThanOrEqual(1);
        expect(Math.abs(control.height - input.height), `${width}px: one height`).toBeLessThanOrEqual(1);
      }
      expect(save.x, `${width}px: Save after the input`).toBeGreaterThanOrEqual(input.x + input.width);
      expect(clear.x, `${width}px: Clear after Save`).toBeGreaterThanOrEqual(save.x + save.width);
      // Inside its panel, which the row does not stretch.
      expect(input.x, `${width}px: starts inside the group`).toBeGreaterThanOrEqual(group.x);
      expect(clear.x + clear.width, `${width}px: ends inside the group`).toBeLessThanOrEqual(group.x + group.width);
      const apiKeys = await box(page.getByRole('group', { name: 'API Keys' }), `${width}px: the API Keys group`);
      expect(group.width, `${width}px: no wider than the API Keys panel above it`).toBeLessThanOrEqual(apiKeys.width + 0.5);
      // Room to type in.
      expect(input.width, `${width}px: input width`).toBeGreaterThanOrEqual(80);

      // A phone held either way: 667 px is a phone held sideways.
      if (width <= 768) {
        for (const control of [input, save, clear]) {
          expect(control.height, `${width}px: 44 px targets on a phone or a small tablet`).toBeGreaterThanOrEqual(44);
        }
      }

      const texts = [
        tokenGroup(page).locator('legend'),
        tokenGroup(page).locator('label[for="admin-token"]'),
        tokenGroup(page).locator('p').first(),
        tokenInput(page),
        saveToken(page),
        clearToken(page),
        tokenStatus(page),
      ];
      for (const text of texts) {
        expect(await fontPx(text), `${width}px: text size`).toBeGreaterThanOrEqual(13);
      }
    }
  });

  test('where the browser blocks storage the token is held for the page and Save to Disk works', async ({ page }) => {
    // This browser refuses the one key, as a browser with storage blocked refuses every key.
    await page.addInitScript(key => {
      for (const method of ['getItem', 'setItem', 'removeItem']) {
        const proto = Storage.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
        const original = proto[method];
        proto[method] = function (this: Storage, ...args: unknown[]) {
          if (args[0] === key) throw new DOMException('The operation is insecure.', 'SecurityError');
          return original.apply(this, args);
        };
      }
    }, TOKEN_KEY);
    await openSettings(page, ADMIN_BASE);
    await expect(tokenStatus(page)).toHaveText(/No token is saved in this browser/);

    await tokenInput(page).fill(TOKEN);
    await saveToken(page).click();
    await expect(tokenStatus(page)).toHaveText(/kept only until this page reloads/);

    await fillEditor(page);
    await saveToDisk(page).click();
    await expect(page.getByText(SAVED)).toBeVisible();
  });

  test('Clear local data sends no server wipe, with a token saved or not, and its question says it lets go of this browser\'s run on the server', async ({ page }) => {
    const questions: string[] = [];
    page.on('dialog', dialog => { questions.push(dialog.message()); void dialog.accept(); });
    const requests = recordRequests(page);
    await openSettings(page, ADMIN_BASE);

    await runActions(page).click();
    await clearLocal(page).click();
    await expect.poll(() => questions.length).toBe(1);
    expect(questions[0]).toBe(CLEAR_QUESTION);

    // A token saved, a wrong one: a server wipe, were one sent, would remove nothing.
    await saveTokenInSettings(page, WRONG);
    await runActions(page).click();
    await clearLocal(page).click();
    await expect.poll(() => questions.length).toBe(2);
    expect(questions[1]).toBe(CLEAR_QUESTION);
    await expect(page.getByText('In-browser caches wiped. Server-stored runs are unchanged.').first()).toBeVisible();

    // Nothing went to the server, and the token stays.
    expect(requests.filter(isServerWipe)).toEqual([]);
    expect(await storedToken(page)).toBe(WRONG);
    await expect(tokenStatus(page)).toHaveText(/A token is saved in this browser/);
  });

  test('Delete server data shows only with a token saved, looks as Clear local data does, asks in its own words, and a refused token is dropped', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const questions: string[] = [];
    let accept = false;
    page.on('dialog', dialog => { questions.push(dialog.message()); void (accept ? dialog.accept() : dialog.dismiss()); });
    const requests = recordRequests(page);

    // No token saved: the menu holds Clear local data and not the server item.
    await openSettings(page, ADMIN_BASE);
    await runActions(page).click();
    await expect(clearLocal(page)).toBeVisible();
    await expect(deleteServerData(page)).toHaveCount(0);
    await closeRunActions(page).click();

    await saveTokenInSettings(page, WRONG);
    await runActions(page).click();
    await expect(deleteServerData(page)).toBeVisible();

    // The menu's destructive item, repeated: the same look, one column, one line each at 320 px.
    const look = (item: Locator) => item.evaluate(element => {
      const style = getComputedStyle(element);
      return [style.color, style.backgroundColor, style.fontFamily, style.fontSize, style.fontWeight, style.padding, style.textAlign, style.borderRadius].join(' | ');
    });
    expect(await look(deleteServerData(page))).toBe(await look(clearLocal(page)));
    const clearBox = (await clearLocal(page).boundingBox())!;
    const deleteBox = (await deleteServerData(page).boundingBox())!;
    expect(Math.abs(deleteBox.x - clearBox.x), 'one column').toBeLessThanOrEqual(1);
    expect(deleteBox.y, 'below Clear local data').toBeGreaterThanOrEqual(clearBox.y + clearBox.height);
    expect(Math.abs(deleteBox.height - clearBox.height), 'one line, as Clear local data').toBeLessThanOrEqual(1);

    // Declined: its question names what it deletes and for whom, and nothing is sent.
    await deleteServerData(page).click();
    await expect.poll(() => questions.length).toBe(1);
    expect(questions[0]).toContain('asks the server to delete its stored runs, saved sessions and run output files, for every visitor');
    expect(questions[0]).not.toContain('are kept.\n');
    expect(requests.filter(isServerWipe)).toEqual([]);
    expect(await storedToken(page)).toBe(WRONG);

    // Accepted with the wrong token: the server refuses, the token is dropped, and the page says where it goes.
    accept = true;
    await runActions(page).click();
    await deleteServerData(page).click();
    await expect(page.getByText(`Server data not deleted: the admin token was refused and has been cleared. ${WHERE}`).first()).toBeVisible();
    expect(requests.filter(isServerWipe).map(request => request.headers()['x-admin-token'])).toEqual([WRONG]);
    await expect(tokenStatus(page)).toHaveText(/No token is saved in this browser/);
    expect(await storedToken(page)).toBeNull();
  });

  test('a rename refused for its token drops that token, says where to enter it, and keeps the name', async ({ page }) => {
    await saveTokenInSettings(page, WRONG);
    const details = await openCompiledDetails(page);

    await details.getByRole('button', { name: `Rename ${COMPILED_NAME}` }).click();
    await details.getByRole('textbox', { name: 'New scenario name' }).fill('A new name');
    await details.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(details.getByRole('alert')).toHaveText(REFUSED_IN_DRAWER);
    // With no token left the open form's Save cannot send anything, so it is off.
    await expect(details.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    expect(await storedToken(page)).toBeNull();
    expect(await compiledName(page)).toBe(COMPILED_NAME);
  });

  test('a rename refused after a newer token was saved keeps that token in the details, and Save sends it', async ({ page }) => {
    // The first rename is held on its way out, then reaches the server, which refuses its token.
    let letGo!: () => void;
    const heldBack = new Promise<void>(resolve => { letGo = resolve; });
    const sent: Array<string | undefined> = [];
    await page.route(`${ADMIN_BASE}/scenarios/${COMPILED_ID}/rename`, async route => {
      sent.push(route.request().headers()['x-admin-token']);
      if (sent.length === 1) {
        await heldBack;
        await route.continue();
        return;
      }
      // The second is answered here, so the shared scenario keeps its name for the other tests.
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: COMPILED_ID, name: 'A new name' }) });
    });
    await saveTokenInSettings(page, WRONG);
    const details = await openCompiledDetails(page);

    await details.getByRole('button', { name: `Rename ${COMPILED_NAME}` }).click();
    await details.getByRole('textbox', { name: 'New scenario name' }).fill('A new name');
    await details.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);

    // A newer token is saved while the rename is out, as another tab of this browser saves one.
    await page.evaluate(([key, token]) => window.localStorage.setItem(key, token), [TOKEN_KEY, TOKEN] as const);
    letGo();
    await expect(details.getByRole('alert')).toHaveText(refusedWithNewerToken('rename', 'Save'));
    expect(await storedToken(page)).toBe(TOKEN);

    await details.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => sent).toEqual([WRONG, TOKEN]);
    await expect(page.getByRole('heading', { name: 'A new name' })).toBeVisible();
    expect(await compiledName(page)).toBe(COMPILED_NAME);
  });

  test('a delete refused after a newer token was saved keeps that token and the Delete button', async ({ page }) => {
    page.on('dialog', dialog => void dialog.accept());
    let letGo!: () => void;
    const heldBack = new Promise<void>(resolve => { letGo = resolve; });
    let deletes = 0;
    await page.route(`${ADMIN_BASE}/admin/scenarios/${COMPILED_ID}`, async route => {
      if (route.request().method() === 'DELETE' && ++deletes === 1) await heldBack;
      await route.continue();
    });
    await saveTokenInSettings(page, WRONG);
    const details = await openCompiledDetails(page);

    await details.getByRole('button', { name: `Delete scenario ${COMPILED_NAME}` }).click();
    await expect.poll(() => deletes).toBe(1);
    await page.evaluate(([key, token]) => window.localStorage.setItem(key, token), [TOKEN_KEY, TOKEN] as const);
    letGo();

    await expect(details.getByRole('alert')).toHaveText(refusedWithNewerToken('delete', 'Delete'));
    await expect(details.getByRole('button', { name: `Delete scenario ${COMPILED_NAME}` })).toBeVisible();
    expect(await storedToken(page)).toBe(TOKEN);
    expect(await compiledName(page)).toBe(COMPILED_NAME);
  });

  test('a delete refused for its token drops that token, says where to enter it, and keeps the scenario', async ({ page }) => {
    page.on('dialog', dialog => void dialog.accept());
    await saveTokenInSettings(page, WRONG);
    const details = await openCompiledDetails(page);

    await details.getByRole('button', { name: `Delete scenario ${COMPILED_NAME}` }).click();

    await expect(details.getByRole('alert')).toHaveText(REFUSED_IN_DRAWER);
    await expect(details.getByRole('button', { name: `Delete scenario ${COMPILED_NAME}` })).toHaveCount(0);
    expect(await storedToken(page)).toBeNull();
    expect(await compiledName(page)).toBe(COMPILED_NAME);
  });

  test('Delete server data whose answer cannot be read says the outcome is not known', async ({ page }) => {
    page.on('dialog', dialog => void dialog.accept());
    // A 200 whose body is not JSON: the server may have deleted its data, and nothing here says otherwise.
    await page.route(`${ADMIN_BASE}/admin/data/wipe`, route => route.fulfill({ status: 200, contentType: 'application/json', body: 'not json' }));
    await saveTokenInSettings(page, WRONG);
    await runActions(page).click();
    await deleteServerData(page).click();

    await expect(page.getByText(WIPE_NOT_KNOWN).first()).toBeVisible();
    await expect(page.getByText(/Server data not deleted/)).toHaveCount(0);
  });

  test('Delete server data shows once a failed admin-config request is asked again', async ({ page }) => {
    // A token is saved before the page loads, and every admin-config request of that load fails.
    await page.addInitScript(([key, token]) => window.localStorage.setItem(key, token), [TOKEN_KEY, WRONG] as const);
    let failing = true;
    let asked = 0;
    await page.route(`${ADMIN_BASE}/admin-config`, route => {
      asked += 1;
      return failing ? route.abort() : route.continue();
    });
    await page.goto(`${ADMIN_BASE}/sim?tab=settings`);
    await expect(settingsLaunch(page)).toBeEnabled();
    await expect.poll(() => asked, 'the page, Settings and the editor each asked').toBeGreaterThanOrEqual(3);
    await runActions(page).click();
    await expect(clearLocal(page)).toBeVisible();
    await expect(deleteServerData(page)).toHaveCount(0);
    await closeRunActions(page).click();

    // The server answers again, and the page asks again when its window has focus.
    failing = false;
    const before = asked;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => asked).toBeGreaterThan(before);
    await runActions(page).click();
    await expect(deleteServerData(page)).toBeVisible();
  });

  test('a token holding a character a request header cannot carry is refused at Save, with the characters a token may hold', async ({ page }) => {
    await openSettings(page, ADMIN_BASE);
    await tokenInput(page).fill(UNSENDABLE_TOKEN);
    await saveToken(page).click();

    await expect(tokenGroup(page).getByRole('alert')).toHaveText(UNSENDABLE);
    await expect(tokenStatus(page)).toHaveText(/No token is saved in this browser/);
    expect(await storedToken(page)).toBeNull();
  });

  test('a stored token holding a character a request header cannot carry is dropped on its first use, with the same words', async ({ page }) => {
    // Stored before Save refused such a token.
    await openSettings(page, ADMIN_BASE);
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [TOKEN_KEY, UNSENDABLE_TOKEN]);
    const requests = recordRequests(page);
    await openSettings(page, ADMIN_BASE);
    await expect(tokenStatus(page)).toHaveText(/A token is saved in this browser/);

    await fillEditor(page);
    await saveToDisk(page).click();

    await expect(page.getByText(`${UNSENDABLE} ${WHERE}`)).toBeVisible();
    await expect(tokenStatus(page)).toHaveText(/No token is saved in this browser/);
    expect(await storedToken(page)).toBeNull();
    expect(requests.filter(isDiskWrite)).toEqual([]);
  });

  test('text typed in the field and not saved stays out of the page markup', async ({ page }) => {
    const typed = 'typed-and-not-saved';
    await openSettings(page, ADMIN_BASE);
    await tokenInput(page).fill(typed);
    await expect(tokenInput(page)).toHaveValue(typed);
    await expect(saveToken(page)).toBeEnabled();

    expect(await tokenInput(page).getAttribute('value') ?? '', 'the input\'s value attribute').not.toContain(typed);
    expect(await page.evaluate(() => document.documentElement.outerHTML), 'the page markup').not.toContain(typed);

    // Saving still takes what was typed, and empties the input.
    await saveToken(page).click();
    await expect(tokenStatus(page)).toHaveText(/A token is saved in this browser/);
    expect(await storedToken(page)).toBe(typed);
    await expect(tokenInput(page)).toHaveValue('');
  });

  test('a token entered where an older one is stored and the new one cannot be is the one sent', async ({ page }) => {
    // This browser already holds an older token and has no room to store another:
    // writes of the key fail, reads and removals of it work.
    await page.addInitScript(({ key, older }) => {
      const proto = Storage.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
      const setItem = proto.setItem;
      try { setItem.call(window.localStorage, key, older); } catch { /* a document without storage */ }
      proto.setItem = function (this: Storage, ...args: unknown[]) {
        if (args[0] === key) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return setItem.apply(this, args);
      };
    }, { key: TOKEN_KEY, older: 'an-older-token' });
    const requests = recordRequests(page);
    await openSettings(page, ADMIN_BASE);
    await expect(tokenStatus(page)).toHaveText(/A token is saved in this browser/);

    await tokenInput(page).fill(TOKEN);
    await saveToken(page).click();
    await expect(tokenStatus(page)).toHaveText(/kept only until this page reloads/);

    // The disk write carries the token just entered, not the older one.
    await fillEditor(page);
    await saveToDisk(page).click();
    await expect.poll(() => requests.filter(isDiskWrite).map(request => request.headers()['x-admin-token'])).toEqual([TOKEN]);
    await expect(page.getByText(SAVED)).toBeVisible();
    // The older token is gone from storage, so a reload does not bring it back.
    expect(await page.evaluate(key => window.localStorage.getItem(key), TOKEN_KEY)).toBeNull();
  });

  test('a refusal that arrives after a new token was saved leaves the new token in place', async ({ page }) => {
    // The first disk write is held on its way out, as a slow connection holds it.
    let letGo!: () => void;
    const heldBack = new Promise<void>(resolve => { letGo = resolve; });
    let diskWrites = 0;
    await page.route(`${ADMIN_BASE}/scenario/store`, async route => {
      if (route.request().method() === 'POST' && ++diskWrites === 1) await heldBack;
      await route.continue();
    });
    await openSettings(page, ADMIN_BASE);
    await fillEditor(page);

    // Sent with no token, and still on its way.
    await saveToDisk(page).click();
    await expect.poll(() => diskWrites).toBe(1);

    // The token is entered while that request is out.
    await tokenInput(page).fill(TOKEN);
    await saveToken(page).click();
    await expect(tokenStatus(page)).toHaveText(/A token is saved in this browser/);

    // The server refuses the first request. The token entered since is not the one it refused.
    letGo();
    await expect(page.getByText(REFUSED)).toBeVisible();
    await expect(tokenStatus(page)).toHaveText(/A token is saved in this browser/);
    expect(await page.evaluate(key => window.localStorage.getItem(key), TOKEN_KEY)).toBe(TOKEN);

    await saveToDisk(page).click();
    await expect(page.getByText(SAVED)).toBeVisible();
  });

  test('the field shows when either of the two admin-config requests fails', async ({ page }) => {
    // Settings and its scenario editor each ask GET /admin-config on load. One
    // of the two is failed on each load, so on one load Save to Disk shows from
    // the editor's answer alone; the field it needs has to show there too.
    let asked = 0;
    let failed = 0;
    await page.route(`${ADMIN_BASE}/admin-config`, route => (++asked === failed ? route.abort() : route.continue()));
    for (const nth of [1, 2]) {
      asked = 0;
      failed = nth;
      await openSettings(page, ADMIN_BASE);
      await expect.poll(() => asked, `load ${nth}: both requests went out`).toBeGreaterThanOrEqual(2);
      await expect(tokenInput(page), `load ${nth}: request ${nth} failed`).toBeVisible();
    }
  });

  test('a server with admin writes off shows no token field', async ({ page }) => {
    const config = await (await page.request.get('/admin-config')).json() as { adminWrite: boolean };
    test.skip(config.adminWrite, 'This server runs with admin writes on; the check reads one with them off.');
    await page.goto('/sim?tab=settings');
    await expect(settingsLaunch(page)).toBeEnabled();
    await expect(editor(page)).toBeVisible();
    await expect(tokenGroup(page)).toHaveCount(0);
    await expect(tokenInput(page)).toHaveCount(0);
    await expect(saveToDisk(page)).toHaveCount(0);

    // A token left in this browser does not bring the server item into the menu.
    await page.evaluate(key => window.localStorage.setItem(key, 'a-token-from-elsewhere'), TOKEN_KEY);
    await page.reload();
    await expect(settingsLaunch(page)).toBeEnabled();
    await runActions(page).click();
    await expect(clearLocal(page)).toBeVisible();
    await expect(deleteServerData(page)).toHaveCount(0);
  });
});
