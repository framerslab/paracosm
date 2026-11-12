/**
 * The admin token is entered in Settings.
 *
 * On a server with admin writes on (ADMIN_WRITE=true and an ADMIN_TOKEN) the
 * dashboard's Save to Disk, its server wipe and its scenario delete send the
 * token this browser keeps under the localStorage key paracosm:adminToken.
 * The dashboard had no control that writes that key, so each call answered
 * 401 with nothing on the page to act on. Settings holds an Admin Token
 * field, shown only where admin writes are on, and a refused call says where
 * that field is.
 *
 * The pages talk to a real server of their own with admin writes on
 * (tests-e2e/support/admin-write-server.ts). Its scenarios folder is a
 * temporary one, and the scenario saved is a real one (scenarios/submarine.json).
 * No model is called and nothing starts a run. The last test reads the
 * default server, which runs with admin writes off.
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

const settingsLaunch = (page: Page) => page.getByRole('button', { name: /Launch simulation|Loading scenario/i });
const editor = (page: Page) => page.getByRole('textbox', { name: 'Scenario JSON editor' });
const saveToDisk = (page: Page) => page.getByRole('button', { name: 'Save scenario to disk' });
const tokenGroup = (page: Page) => page.getByRole('group', { name: 'Admin Token' });
const tokenInput = (page: Page) => page.locator('#admin-token');
const saveToken = (page: Page) => page.getByRole('button', { name: 'Save admin token' });
const clearToken = (page: Page) => page.getByRole('button', { name: 'Clear admin token' });
const tokenStatus = (page: Page) => page.locator('#admin-token-status');

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

    for (const width of [320, 360, 390, 430, 480, 768]) {
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

      if (width <= 480) {
        for (const control of [input, save, clear]) {
          expect(control.height, `${width}px: 44 px targets on a phone`).toBeGreaterThanOrEqual(44);
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

  test('a token the server refuses on the server wipe is dropped, and the page says where to enter it', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    await openSettings(page, ADMIN_BASE);
    await tokenInput(page).fill('not-the-token');
    await saveToken(page).click();
    await expect(tokenStatus(page)).toHaveText(/A token is saved in this browser/);

    await page.getByRole('button', { name: 'Open run actions menu' }).click();
    await page.getByRole('menuitem', { name: 'Clear local data' }).click();

    await expect(page.getByText(`Server-side wipe skipped: the admin token was refused and has been cleared. ${WHERE}`).first()).toBeVisible();
    await expect(tokenStatus(page)).toHaveText(/No token is saved in this browser/);
    expect(await page.evaluate(key => window.localStorage.getItem(key), TOKEN_KEY)).toBeNull();
  });

  test('Clear local data asks in words that match what the click does, with and without a token', async ({ page }) => {
    // Every question is declined, so nothing is cleared here or on the server.
    const questions: string[] = [];
    page.on('dialog', dialog => { questions.push(dialog.message()); void dialog.dismiss(); });
    const askToClear = async () => {
      await page.getByRole('button', { name: 'Open run actions menu' }).click();
      await page.getByRole('menuitem', { name: 'Clear local data' }).click();
    };
    await openSettings(page, ADMIN_BASE);

    // No token: the click clears this browser only, and the question says the server's data is kept.
    await askToClear();
    await expect.poll(() => questions.length).toBe(1);
    expect(questions[0]).toContain('Server-stored runs, sessions, and on-disk artifact files are kept.');

    // A token saved: the same click also sends the server wipe, so the question says that instead.
    await tokenInput(page).fill(TOKEN);
    await saveToken(page).click();
    await expect(tokenStatus(page)).toHaveText(/A token is saved in this browser/);
    await askToClear();
    await expect.poll(() => questions.length).toBe(2);
    expect(questions[1]).toContain('asks the server to delete its stored runs, saved sessions and run output files');
    expect(questions[1]).not.toContain('are kept');
    await expect(tokenStatus(page)).toHaveText(/A token is saved in this browser/);
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
  });
});
