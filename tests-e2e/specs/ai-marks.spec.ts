import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { expect, test, type Locator, type Page } from '@playwright/test';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The marking spec uses a writable fixture server.');

const origin = 'http://127.0.0.1:3474';
const meta = 'meta[name="ai-generated-content"][content="partial"]';

async function openPair(page: Page, look: 'light' | 'dark') {
  await page.addInitScript(look => localStorage.setItem('paracosm-theme', look), look);
  await page.goto(origin + '/sim');
  const firstScreen = page.getByTestId('run-first-screen');
  await expect(firstScreen.getByRole('heading', { name: 'Mars Genesis', exact: true })).toBeVisible();
  await expect(page.locator(meta)).toHaveCount(0);
  const setup = page.waitForResponse(response => response.url() === origin + '/setup' && response.request().method() === 'POST');
  await firstScreen.getByRole('button', { name: /^start\b/i }).click();
  expect((await setup).ok()).toBeTruthy();
  await page.waitForURL(url => url.searchParams.get('tab') === 'sim');
}

async function expectMark(text: Locator) {
  await expect(text).toBeVisible();
  const block = text.locator('xpath=ancestor-or-self::*[@data-ai-generated="true"][1]');
  await expect(block).toHaveCount(1);
  const label = block.getByText('AI-written', { exact: true });
  await expect(label).toHaveCount(1);
  await expect(label).toBeVisible();
}

for (const width of [390, 1440]) {
  for (const look of ['light', 'dark'] as const) {
    test(`model-written decisions in Watch at ${width}px in ${look}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 960 },
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
      });
      try {
        const page = await context.newPage();
        await openPair(page, look);
        const decision = page.getByText('Keep a reserve of water.', { exact: true }).filter({ visible: true }).first();
        await expectMark(decision);
        await expect(page.locator(meta)).toHaveCount(1);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await decision.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `test-pictures/sim-first-screen/ai-marks/${width}-${look}.png`, animations: 'disabled' });
      } finally {
        await context.close();
      }
    });
  }
}

test('generated leaders and successful chat replies carry their own source', async ({ page }) => {
  await page.goto(origin + '/sim');
  const generated = await page.request.post(origin + '/api/quickstart/generate-actors', {
    data: { scenarioId: 'mars-genesis', count: 2 },
  });
  expect(generated.ok()).toBeTruthy();
  const { actors } = await generated.json();
  expect(actors[0].aiAuthorship).toEqual({
    model: 'test-leader-writer',
    fields: expect.arrayContaining(['name', 'archetype', 'unit', 'instructions']),
  });
  delete actors[1].aiAuthorship;
  await page.route('**/setup', async route => {
    await route.continue({ postData: { ...route.request().postDataJSON(), actors } });
  });
  await openPair(page, 'dark');
  await expect(page.getByText('Generated leader', { exact: true }).first()).toBeVisible();
  const reply = await page.request.post(origin + '/chat', {
    data: { agentId: 'generated-leader-crew-1', leader: 'Generated leader', message: 'How are the stores?' },
  });
  expect(reply.ok()).toBeTruthy();
  expect(await reply.json()).toMatchObject({
    reply: 'The water stores are stable.',
    aiAuthorship: { model: 'test-chat', fields: ['reply'] },
  });

  await page.getByRole('tab', { name: 'CHAT', exact: true }).click();
  const actor = page.getByRole('combobox', { name: 'Filter chat agents by lead actor' });
  await actor.selectOption({ label: (await actor.locator('option').allTextContents()).find(label => label.startsWith('Generated leader ('))! });
  await page.getByRole('button', { name: /Noor Aziz/ }).first().click();
  const greeting = page.getByText(/I lived through this simulation/).first();
  await expect(greeting).toBeVisible();
  await expect(greeting.locator('xpath=ancestor-or-self::*[@data-ai-generated="true"]')).toHaveCount(0);

  let releaseReply!: () => void;
  const pending = new Promise<void>(resolve => { releaseReply = resolve; });
  const replyReceived = page.waitForResponse(response => response.url() === origin + '/chat');
  const delay = async (route: import('@playwright/test').Route) => {
    await pending;
    await route.continue();
  };
  await page.route('**/chat', delay);
  await page.getByRole('textbox', { name: 'Message Noor Aziz' }).fill('Check the reserve, please.');
  try {
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const typing = page.getByLabel('Noor Aziz is typing');
    await expect(typing).toBeVisible();
    await expect(typing.locator('xpath=ancestor-or-self::*[@data-ai-generated="true"]')).toHaveCount(0);
    const other = (await actor.locator('option').allTextContents()).find(label => label.startsWith('Supplied leader ('))!;
    await actor.selectOption({ label: other });
    await page.getByRole('button', { name: /Noor Aziz/ }).first().click();
    releaseReply();
    expect((await replyReceived).ok()).toBe(true);
    await expect(typing).toHaveCount(0);
    await expect(page.getByText('The water stores are stable.', { exact: true })).toHaveCount(0);
    const generated = (await actor.locator('option').allTextContents()).find(label => label.startsWith('Generated leader ('))!;
    await actor.selectOption({ label: generated });
    await page.getByRole('button', { name: /Noor Aziz/ }).first().click();
    await expectMark(page.getByText('The water stores are stable.', { exact: true }));
  } finally {
    releaseReply();
    await page.unroute('**/chat', delay);
  }
  const question = page.getByText('Check the reserve, please.', { exact: true });
  await expect(question).toBeVisible();
  await expect(question.locator('xpath=ancestor-or-self::*[@data-ai-generated="true"]')).toHaveCount(0);

  let sessionId: string | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(origin + '/sessions');
    if (!response.ok()) return false;
    const { sessions } = await response.json();
    sessionId = sessions.find((session: { id: string; leaderA?: string }) => session.leaderA === 'Generated leader')?.id;
    return typeof sessionId === 'string';
  }).toBe(true);
  await page.goto(origin + '/sim?tab=sim&replay=' + encodeURIComponent(sessionId!));
  await expectMark(page.getByText('Keep a reserve of water.', { exact: true }).filter({ visible: true }).first());
  await expect(page.locator(meta)).toHaveCount(1);
});

test('a selected run downloads readable HTML and PDF with the same provenance', async ({ page }) => {
  await page.goto(origin + '/sim?tab=library');
  const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/runArtifact-v0.8-turn-loop.json', import.meta.url), 'utf8'));
  const provenance = { aiGenerated: true, generator: 'paracosm', models: { commander: 'test-commander' } };
  const choice = 'Keep reserves & supplies </script> é 測試';
  const artifact = {
    ...fixture,
    metadata: { ...fixture.metadata, runId: 'run_report_marking_fixture' },
    provenance,
    decisions: [{ ...fixture.decisions[0], choice, aiWrittenFields: ['choice'] }],
  };
  const response = await page.request.post(origin + '/api/v1/library/import', { data: { artifact } });
  expect(response.status()).toBe(201);
  const { runId } = await response.json();
  await page.goto(origin + '/sim?tab=library&runId=' + encodeURIComponent(runId));
  const dialog = page.getByRole('dialog', { name: 'Run detail' });

  const [htmlDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download HTML' }).click(),
  ]);
  const html = readFileSync(await htmlDownload.path(), 'utf8');
  const parsed = await page.evaluate(source => {
    const dom = new DOMParser().parseFromString(source, 'text/html');
    return {
      metaCount: dom.querySelectorAll('meta[name="ai-generated-content"][content="partial"]').length,
      data: JSON.parse(dom.getElementById('paracosm-provenance')!.textContent!),
      passages: [...dom.querySelectorAll('[data-ai-generated="true"]')].map(el => el.textContent),
    };
  }, html);
  expect(parsed).toEqual({ metaCount: 1, data: { provenance }, passages: [choice + ' AI-written'] });
  expect(html).not.toContain('<h2>Verdict</h2>');

  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  const pdfBytes = readFileSync(await pdfDownload.path());
  const pdf = await PDFDocument.load(pdfBytes);
  const stream = pdf.catalog.lookup(PDFName.of('Metadata'), PDFRawStream);
  const xmp = new TextDecoder().decode(stream.getContents());
  const embedded = await page.evaluate(source => {
    const xml = new DOMParser().parseFromString(source, 'application/xml');
    return JSON.parse(xml.getElementsByTagNameNS('https://paracosm.agentos.sh/ns/provenance/1.0/', 'provenance')[0].textContent!);
  }, xmp);
  expect(embedded).toEqual(provenance);

  const dashboardRequire = createRequire(new URL('../../src/dashboard/package.json', import.meta.url));
  const pdfJs = await import(pathToFileURL(dashboardRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const rendering = pdfJs.getDocument({ data: Uint8Array.from(pdfBytes), disableFontFace: true });
  const report = await rendering.promise;
  try {
    const attachments = await report.getAttachments();
    const runJson = Array.from(attachments ?? []).find(([, file]) => file.filename === 'run.json');
    expect(runJson, 'the report includes the selected run as a JSON attachment').toBeDefined();
    const bytes = await report.getAttachmentContent(runJson![0]);
    expect(bytes?.byteLength, 'the selected run attachment has content').toBeGreaterThan(0);
    const json = JSON.parse(new TextDecoder().decode(bytes!));
    expect(json.provenance).toEqual(provenance);
    expect(json.decisions[0].choice).toBe(choice);
    const rendered = await (await report.getPage(1)).getTextContent();
    expect(rendered.items.some((item: { str?: string }) => item.str === 'AI-written')).toBe(true);
  } finally {
    await rendering.destroy();
  }
});

test('the Viz PNG download carries one valid metadata chunk', async ({ page }) => {
  await openPair(page, 'dark');
  await page.getByRole('tab', { name: 'VIZ', exact: true }).click();
  await expect(page.locator('canvas').filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Show (advanced|more) tools/ }).click();
  await page.getByRole('toolbar', { name: 'Viz tools' }).getByRole('button', { name: 'Export options' }).click();
  const original = await page.evaluateHandle(() => {
    const state = { png: null as Blob | null };
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      HTMLCanvasElement.prototype.toBlob = encode;
      encode.call(this, blob => {
        state.png = blob;
        callback(blob);
      }, type, quality);
    };
    return state;
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /^PNG/ }).click(),
  ]);
  const png = readFileSync(await download.path());
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const xmp: string[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const end = offset + 8 + length;
    expect(end + 4).toBeLessThanOrEqual(png.length);
    const keyword = 'XML:com.adobe.xmp';
    if (type === 'iTXt' && png.toString('ascii', offset + 8, offset + 8 + keyword.length) === keyword) {
      expect(crc32(png.subarray(offset + 4, end))).toBe(png.readUInt32BE(end));
      const start = offset + 8 + keyword.length;
      expect([...png.subarray(start, start + 5)]).toEqual([0, 0, 0, 0, 0]);
      xmp.push(png.toString('utf8', start + 5, end));
    }
    offset = end + 4;
  }
  expect(xmp).toHaveLength(1);
  expect(xmp[0]).toContain('http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia');
  expect(xmp[0]).toContain('"generator":"paracosm"');
  const marked = await page.evaluateHandle(base64 =>
    new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'image/png' }),
    png.toString('base64'));
  const pixels = await page.evaluate(async ({ original, marked }) => {
    if (!original.png) throw new Error('Viz did not encode a source composite');
    const [before, after] = await Promise.all([createImageBitmap(original.png), createImageBitmap(marked)]);
    const sameSize = before.width === after.width && before.height === after.height;
    const canvas = document.createElement('canvas');
    canvas.width = before.width;
    canvas.height = before.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(before, 0, 0);
    const source = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(after, 0, 0);
    const exported = context.getImageData(0, 0, canvas.width, canvas.height).data;
    before.close();
    after.close();
    return { sameSize, samePixels: source.every((byte, index) => byte === exported[index]) };
  }, { original, marked });
  expect(pixels).toEqual({ sameSize: true, samePixels: true });
  await original.dispose();
  await marked.dispose();
});

test('Reports distinguishes authored decisions and department prose from a fallback with the same words', async ({ page }) => {
  await openPair(page, 'light');
  await page.getByRole('tab', { name: 'REPORTS', exact: true }).click();
  const report = page.getByRole('region', { name: 'Turn-by-turn report' });
  await expectMark(report.getByText('Keep a reserve of water.', { exact: true }).filter({ visible: true }).first());
  await expectMark(report.getByText('Spend the reserve on new wells.', { exact: true }).filter({ visible: true }).first());

  const summaries = report.getByText('Pressure held overnight.', { exact: true }).filter({ visible: true });
  await expect(summaries.first()).toBeVisible();
  const sources = await summaries.evaluateAll(nodes =>
    nodes.map(node => Boolean(node.closest('[data-ai-generated="true"]'))),
  );
  expect(sources).toContain(true);
  expect(sources).toContain(false);
  await expect(page.locator(meta)).toHaveCount(1);
});

test('Library reports include the saved verdict and its model for the selected actor', async ({ page }) => {
  await page.route('**/setup', route => {
    const launch = route.request().postDataJSON();
    launch.actors[0].name = 'Report leader';
    return route.continue({ postData: launch });
  });
  await openPair(page, 'dark');
  let runId: string | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(origin + '/api/v1/runs');
    const { runs } = await response.json();
    const record = runs.find((run: { actorName?: string; sessionId?: string }) => run.actorName === 'Report leader' && run.sessionId);
    runId = record?.runId;
    return Boolean(runId);
  }).toBe(true);
  await page.goto(origin + '/sim?tab=library&runId=' + encodeURIComponent(runId!));
  const dialog = page.getByRole('dialog', { name: 'Run detail' });
  const save = async (format: 'HTML' | 'PDF') => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Download ' + format }).click(),
    ]);
    return readFileSync(await download.path());
  };

  const html = (await save('HTML')).toString('utf8');
  const verdict = 'Stored water protected the new crops.';
  const models = { commander: 'test-commander-a', verdict: 'test-verdict' };
  const document = await page.evaluate(source => {
    const report = new DOMParser().parseFromString(source, 'text/html');
    return {
      marked: [...report.querySelectorAll('[data-ai-generated="true"]')].map(el => el.textContent),
      models: JSON.parse(report.querySelector('#paracosm-provenance')!.textContent!).provenance.models,
    };
  }, html);
  expect(document.marked).toContain(verdict + ' AI-written');
  expect(document.models).toEqual(models);

  const bytes = await save('PDF');
  const pdf = await PDFDocument.load(bytes);
  const metadata = pdf.catalog.lookup(PDFName.of('Metadata'), PDFRawStream);
  expect(new TextDecoder().decode(metadata.getContents())).toContain(JSON.stringify(models));
  const dashboardRequire = createRequire(new URL('../../src/dashboard/package.json', import.meta.url));
  const pdfJs = await import(pathToFileURL(dashboardRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const rendering = pdfJs.getDocument({ data: Uint8Array.from(bytes), disableFontFace: true });
  try {
    const report = await rendering.promise;
    const items = (await (await report.getPage(1)).getTextContent()).items;
    const text = items.map((item: { str?: string }) => item.str ?? '').join(' ');
    expect(text).toContain(verdict);
    expect(text).toMatch(/Stored water protected the new crops\.\s+AI-written/);
  } finally {
    await rendering.destroy();
  }
});

test('the Scenario Editor exports only the recorded compiler role for a generated scenario', async ({ page }) => {
  await page.goto(origin + '/sim?tab=settings');
  const draft = JSON.parse(readFileSync(new URL('../../scenarios/mars.json', import.meta.url), 'utf8'));
  const id = 'marks-compiler-' + Date.now();
  const compiled = await page.request.post(origin + '/compile', { data: {
    scenario: { ...draft, id }, webSearch: false,
  } });
  expect(compiled.ok()).toBe(true);
  expect(await compiled.text()).toContain('event: complete');
  expect((await page.request.post(origin + '/scenario/switch', { data: { id } })).ok()).toBe(true);
  await page.reload();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export as JSON file' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(id + '.json');
  const scenario = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(scenario.provenance).toEqual({
    aiGenerated: true, generator: 'paracosm', models: { compiler: 'test-compiler' },
  });
});

test('editing generated instructions clears their source and preserves the other generated fields', async ({ page }) => {
  await page.goto(origin + '/sim?tab=settings');
  const generated = await page.request.post(origin + '/api/quickstart/generate-actors', {
    data: { scenarioId: 'mars-genesis', count: 2 },
  });
  expect(generated.ok()).toBe(true);
  const { actors } = await generated.json();
  delete actors[1].aiAuthorship;
  // Supply generated profiles as the settings roster while the real editor
  // and launch request exercise field-level edits.
  await page.route('**/scenario', async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, presets: [{ id: 'default', leaders: actors }] } });
  });
  await page.reload();
  const instructions = page.getByRole('textbox', { name: 'Instructions', exact: true }).first();
  await expect(instructions).toHaveValue(actors[0].instructions);
  await instructions.fill('Leave half the water in storage today.');
  const launch = page.waitForRequest(request => request.url() === origin + '/setup' && request.method() === 'POST');
  await page.getByRole('button', { name: 'Launch simulation' }).click();
  const [edited, supplied] = (await launch).postDataJSON().actors;
  expect(edited.instructions).toBe('Leave half the water in storage today.');
  expect(edited.aiAuthorship).toEqual({
    model: 'test-leader-writer',
    fields: expect.arrayContaining(['name', 'archetype']),
  });
  expect(edited.aiAuthorship.fields).not.toContain('instructions');
  expect(supplied.aiAuthorship).toBeUndefined();
  await page.waitForURL(url => url.searchParams.get('tab') === 'sim');
  const authoredArchetype = page.getByText('ENGINEER', { exact: true }).filter({ visible: true })
    .and(page.locator('[data-ai-generated="true"] > span')).first();
  await expectMark(authoredArchetype);
  const human = page.getByText('"Leave half the water in storage today."', { exact: true }).filter({ visible: true }).first();
  await expect(human).toBeVisible();
  await expect(human.locator('xpath=ancestor-or-self::*[@data-ai-generated="true"]')).toHaveCount(0);
});

for (const count of [24, 300]) {
  test(`a selected generated leader retains its mark in a cohort of ${count}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(origin + '/sim');
    const generated = await page.request.post(origin + '/api/quickstart/generate-actors', {
      data: { scenarioId: 'mars-genesis', count },
    });
    expect(generated.ok()).toBe(true);
    const { actors } = await generated.json();
    expect(actors).toHaveLength(count);
    expect(actors[count - 1].aiAuthorship.model).toBe('test-leader-writer');
    await page.route('**/setup', route => route.continue({
      postData: { ...route.request().postDataJSON(), actors, turns: 2 },
    }));
    await openPair(page, 'dark');
    await expect(page.getByTestId('watch-grid-track').locator('[aria-label^="Living swarm grid for actor "]')).toHaveCount(count, { timeout: 60_000 });
    await page.locator('button[data-layout="constellation"]').click();
    const row = page.getByRole('row', { name: `Generated leader ${count}, Engineer`, exact: false });
    await row.focus();
    await expect(row).toBeFocused();
    await row.press('Enter');
    const profile = page.getByRole('dialog', { name: `Report for Generated leader ${count}` });
    await expectMark(profile.getByText('ENGINEER', { exact: true }));
    await expect(page.locator(meta)).toHaveCount(1);
    await profile.getByRole('button', { name: 'Close drill-in' }).click();
    await expect(profile).toHaveCount(0);
  });
}
