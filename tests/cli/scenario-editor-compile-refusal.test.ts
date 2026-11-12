/**
 * What the dashboard's scenario editor shows when the server refuses a compile.
 *
 * The editor posts its JSON to POST /compile and reads the answer as a
 * stream of `data:` lines. A refusal is one JSON object with no such line
 * (a 409 for an id that is taken, a 429 past the day's compiles, a 400), so
 * the editor showed nothing. `compileRefusal` reads that answer for the
 * editor, which shows its message in place of the compile result.
 *
 * The first test goes through createMarsServer over HTTP: the editor's own
 * steps (GET /scenario, the request body its helper builds, POST /compile),
 * with a stub compiler, so no model or network is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mars, withVisitors } from './helpers/run-server.js';
import { buildScenarioCompileRequest } from '../../src/dashboard/src/components/settings/scenarioCompileRequest.js';
import { compileRefusal } from '../../src/dashboard/src/components/settings/compileRefusal.js';
import type { ScenarioPackage } from '../../src/engine/types.js';

/** The request the editor builds from the JSON it holds, with its form left as it opens. */
function editorRequest(scenario: Record<string, unknown>) {
  return buildScenarioCompileRequest({ scenario, seedText: '', seedUrl: '', webSearch: true, maxSearches: '5' });
}

test("the editor's compile of the scenario it opens on, a built-in, reads the server's refusal", async () => {
  let compiles = 0;
  await withVisitors(async ({ cookied }) => {
    const page = cookied();
    // The editor loads the active scenario into its text area when it opens.
    const active = await page.json<Record<string, unknown>>('/scenario');
    assert.equal(active.id, mars.id);

    const refused = await page.post('/compile', editorRequest(active));
    assert.equal(await compileRefusal(refused), `"${mars.id}" is taken on this server. Give your scenario an id of its own.`);
    assert.equal(compiles, 0, 'the compiler was not called');

    // A compile the server takes is a stream, which the editor reads itself.
    const taken = await page.post('/compile', editorRequest({ ...active, id: 'editor-own-scenario' }));
    assert.equal(await compileRefusal(taken), null);
    assert.equal(taken.bodyUsed, false, 'the stream is left for the editor to read');
    assert.match(await taken.text(), /event: complete/);
  }, {
    compileScenario: async scenarioJson => {
      compiles += 1;
      return { ...scenarioJson, departments: [], hooks: {} } as unknown as ScenarioPackage;
    },
  });
});

test('a refusal with no message of its own reads as its status', async () => {
  assert.equal(await compileRefusal(new Response('Bad Gateway', { status: 502 })), 'The compile was refused (HTTP 502).');
  assert.equal(await compileRefusal(new Response(JSON.stringify({ error: '' }), { status: 429 })), 'The compile was refused (HTTP 429).');
});
