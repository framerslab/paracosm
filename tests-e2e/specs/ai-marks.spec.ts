import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { settle } from '../support/readability.js';
import { openTab } from '../support/frame.js';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The marking spec uses a writable fixture server.');

const origin = 'http://127.0.0.1:3474';
const meta = 'meta[name="ai-generated-content"]';
const mark = '[data-ai-generated="true"]';
const startNotice = 'The leaders are AI agents. Everything they say is written by a language model and can be wrong.';
const chatNotice = 'Replies are written by an AI model.';
const reportNotice = 'Written by AI models in a Paracosm simulation.';
const iptcSource = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

async function openPair(page: Page, look: 'light' | 'dark') {
  await page.addInitScript(look => localStorage.setItem('paracosm-theme', look), look);
  await page.goto(origin + '/sim');
  const firstScreen = page.getByTestId('run-first-screen');
  await expect(firstScreen.getByRole('heading', { name: 'Mars Genesis', exact: true })).toBeVisible();
  const notice = firstScreen.getByText(startNotice, { exact: true });
  await expect(notice).toHaveCount(1);
  await expect(firstScreen.getByTestId('first-screen-notes').getByText(startNotice, { exact: true })).toBeVisible();
  await expectNoLabels(page);
  await expect(page.locator(meta)).toHaveCount(0);
  const setup = page.waitForResponse(response => response.url() === origin + '/setup' && response.request().method() === 'POST');
  const start = firstScreen.getByRole('button', { name: /^start\b/i });
  if ((page.viewportSize()?.width ?? 1440) < 900) {
    await expect(start).toBeEnabled();
    const target = await start.boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    expect(target?.width).toBeGreaterThanOrEqual(44);
  }
  await start.click();
  expect((await setup).ok()).toBeTruthy();
  await page.waitForURL(url => url.searchParams.get('tab') === 'sim');
}

for (const width of [320, 390, 640, 800]) {
  for (const look of ['light', 'dark'] as const) {
    test(`the longest stored verdict fits in the banner at ${width}px in ${look}`, async ({ page }) => {
      const leader = `Verdict headline ${width} ${look}`;
      const headline = 'Warming winds and widespread wildfires overwhelmed Mars while reserves dwindled.';
      expect(headline).toHaveLength(80);
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/setup', route => {
        const setup = route.request().postDataJSON();
        setup.actors[0].name = leader;
        return route.continue({ postData: setup });
      });
      await openPair(page, look);
      await expect(page.getByRole('status', { name: /^Simulation status: Complete\./ })).toBeVisible();
      const id = await savedPairId(page, leader);
      const replay = await page.request.get(origin + '/sessions/' + encodeURIComponent(id) + '/replay');
      expect(replay.ok()).toBe(true);
      expect(await replay.text()).toContain(JSON.stringify(headline));

      const banner = page.getByRole('status', { name: 'Simulation verdict' });
      const title = banner.getByText(headline, { exact: true });
      await expectMark(title);
      await expectQuietPage(page);
      const notifications = page.getByRole('status', { name: 'Notifications' });
      await expect(notifications.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCount(0, { timeout: 20_000 });
      await settle(banner);
      expect(await title.evaluate(element => {
        const button = element.closest('button')!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        return [...range.getClientRects()].every(rect =>
          rect.left >= button.left - 1 && rect.right <= button.right + 1
          && rect.top >= button.top - 1 && rect.bottom <= button.bottom + 1
          && rect.left >= 0 && rect.right <= document.documentElement.clientWidth,
        );
      }), 'the whole headline fits inside the button and viewport').toBe(true);
      await page.screenshot({
        path: `test-pictures/sim-first-screen/verdict-banner/${width}-${look}.png`,
        animations: 'disabled',
        scale: 'css',
      });
    });
  }
}

test('a long winner name leaves every word of the verdict headline whole at 800px', async ({ page }) => {
  const leader = 'Verdict headline beside a winner name of some length';
  const headline = 'Warming winds and widespread wildfires overwhelmed Mars while reserves dwindled.';
  await page.setViewportSize({ width: 800, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/setup', route => {
    const setup = route.request().postDataJSON();
    setup.actors[0].name = leader;
    return route.continue({ postData: setup });
  });
  await openPair(page, 'light');
  await expect(page.getByRole('status', { name: /^Simulation status: Complete\./ })).toBeVisible();
  const banner = page.getByRole('status', { name: 'Simulation verdict' });
  await expect(banner.getByText(leader + ' wins', { exact: true })).toBeVisible();
  const title = banner.getByText(headline, { exact: true });
  await expectMark(title);
  await settle(banner);
  const broken = await title.evaluate(element => {
    const words: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of node.textContent!.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index!);
        range.setEnd(node, match.index! + match[0].length);
        if (range.getClientRects().length > 1) words.push(match[0]);
      }
    }
    return words;
  });
  expect(broken, 'no word of the headline breaks across lines').toEqual([]);
  await banner.screenshot({ path: 'test-pictures/sim-first-screen/ai-marks/verdict-long-winner-800.png', animations: 'disabled' });
});

async function expectMark(text: Locator) {
  await expect(text).toBeVisible();
  const block = text.locator('xpath=ancestor-or-self::*[@data-ai-generated="true"][1]');
  await expect(block).toHaveCount(1);
  await expect(block).not.toContainText('AI-written');
}

async function expectNoLabels(page: Page) {
  const body = page.locator('body');
  expect(await body.innerText()).not.toContain('AI-written');
  expect(await body.textContent()).not.toContain('AI-written');
}

async function expectQuietPage(page: Page) {
  await expectNoLabels(page);
  await expect(page.locator(meta)).toHaveCount(1);
  await expect(page.locator(meta)).toHaveAttribute('content', 'partial');
}

/** Every match of the text is shown with no marked block around it. */
async function expectUnmarked(text: Locator) {
  await expect(text.first()).toBeVisible();
  expect(await text.evaluateAll(nodes => nodes.filter(node => node.closest('[data-ai-generated="true"]')).length)).toBe(0);
}

async function libraryRunId(page: Page, actor: string) {
  let runId: string | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(origin + '/api/v1/runs');
    const { runs } = await response.json();
    runId = runs.find((run: { actorName?: string }) => run.actorName === actor)?.runId;
    return Boolean(runId);
  }).toBe(true);
  return runId!;
}

for (const width of [320, 390, 1440]) {
  for (const look of ['light', 'dark'] as const) {
    test(`model-written decisions in Watch at ${width}px in ${look}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width, height: width <= 390 ? 844 : 960 },
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
      });
      try {
        const page = await context.newPage();
        await openPair(page, look);
        const decision = page.getByText('Keep a reserve of water.', { exact: true }).filter({ visible: true }).first();
        await expectMark(decision);
        await expect(page.locator(meta)).toHaveCount(1);
        await expect(page.getByRole('status', { name: /^Simulation status: Complete\./ })).toBeVisible();
        await savedPairId(page, 'Aria Chen');
        const notifications = page.getByRole('status', { name: 'Notifications' });
        await expect(notifications.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCount(0, { timeout: 20_000 });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await decision.scrollIntoViewIfNeeded();
        await settle(decision);
        await expectQuietPage(page);
        const filename = `${width}-${look}.png`;
        await page.screenshot({ path: `test-pictures/sim-first-screen/ai-marks/${filename}`, animations: 'disabled' });
        if (width !== 320) {
          await openTab(page, 'reports');
          const report = page.getByRole('region', { name: 'Turn-by-turn report' });
          const passage = report.getByText('Keep a reserve of water.', { exact: true }).filter({ visible: true }).first();
          await expectMark(passage);
          await expectQuietPage(page);
          await passage.scrollIntoViewIfNeeded();
          await settle(passage);
          await page.screenshot({ path: `test-pictures/sim-first-screen/ai-marks/reports-${filename}`, animations: 'disabled' });
        }
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

  await openTab(page, 'chat');
  const notice = page.getByText(chatNotice, { exact: true });
  await expect(notice).toHaveCount(0);
  const actor = page.getByRole('combobox', { name: 'Filter chat agents by lead actor' });
  await actor.selectOption({ label: (await actor.locator('option').allTextContents()).find(label => label.startsWith('Generated leader ('))! });
  await page.getByRole('button', { name: /Noor Aziz/ }).first().click();
  const greeting = page.getByText(/I lived through this simulation/).first();
  await expect(notice).toHaveCount(1);
  await expect(notice).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Noor Aziz' })).toHaveAccessibleDescription(chatNotice);
  expect((await page.locator('body').innerText()).indexOf(chatNotice))
    .toBeLessThan((await page.locator('body').innerText()).indexOf((await greeting.innerText()).trim()));
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
    await expect(notice).toHaveCount(1);
    await expect(notice).toBeVisible();
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
  await expect(notice).toHaveCount(1);
  await expect(notice).toBeVisible();
  await expectQuietPage(page);
  const question = page.getByText('Check the reserve, please.', { exact: true });
  await expect(question).toBeVisible();
  await expect(question.locator('xpath=ancestor-or-self::*[@data-ai-generated="true"]')).toHaveCount(0);

  const sessionId = await savedPairId(page, 'Generated leader');
  const replayUrl = origin + '/sessions/' + encodeURIComponent(sessionId) + '/replay';
  const replay = await page.request.get(replayUrl);
  expect(replay.ok()).toBe(true);
  const firstEvent = (await replay.text()).split(/\r?\n\r?\n/, 1)[0];
  const firstData = firstEvent.match(/^data: (.+)$/m);
  expect(firstData).not.toBeNull();
  expect(JSON.parse(firstData![1]).provenance).toMatchObject({
    aiGenerated: true, generator: 'paracosm', models: expect.any(Object),
  });
  await page.goto(origin + '/sim?tab=sim&replay=' + encodeURIComponent(sessionId));
  await expectMark(page.getByText('Keep a reserve of water.', { exact: true }).filter({ visible: true }).first());
  await expectQuietPage(page);
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

  await expectMark(dialog.locator(mark).filter({ hasText: choice }));
  await expectQuietPage(page);
  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download JSON' }).click(),
  ]);
  const run = JSON.parse(readFileSync(await jsonDownload.path(), 'utf8'));
  expect(run.provenance).toEqual(provenance);
  expect(run.decisions[0]).toMatchObject({ choice, aiWrittenFields: ['choice'] });

  const [htmlDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download HTML' }).click(),
  ]);
  const html = readFileSync(await htmlDownload.path(), 'utf8');
  const parsed = await page.evaluate(source => {
    const dom = new DOMParser().parseFromString(source, 'text/html');
    return {
      meta: [...dom.querySelectorAll('meta[name="ai-generated-content"]')].map(el => el.getAttribute('content')),
      titleNotice: dom.querySelector('h1 + p')?.textContent,
      body: dom.body.textContent,
      data: JSON.parse(dom.getElementById('paracosm-provenance')!.textContent!),
      passages: [...dom.querySelectorAll('[data-ai-generated="true"]')].map(el => el.textContent),
    };
  }, html);
  expect(parsed).toMatchObject({ meta: ['partial'], data: { provenance }, passages: [choice], titleNotice: reportNotice });
  expect(parsed.body).not.toContain('AI-written');
  expect(parsed.body!.split(reportNotice)).toHaveLength(2);
  expect(html).not.toContain('<h2>Verdict</h2>');

  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  const pdfBytes = readFileSync(await pdfDownload.path());
  const pdf = await PDFDocument.load(pdfBytes);
  const stream = pdf.catalog.lookup(PDFName.of('Metadata'), PDFRawStream);
  const xmp = new TextDecoder().decode(stream.getContents());
  expect(xmp).toContain(iptcSource);
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
    expect(json.decisions[0]).toMatchObject({ choice, aiWrittenFields: ['choice'] });
    const pages: string[] = [];
    for (let index = 1; index <= report.numPages; index++) {
      const { items } = await (await report.getPage(index)).getTextContent();
      pages.push(items.map((item: { str?: string }) => item.str ?? '').filter(Boolean).join('\n'));
    }
    expect(pages[0].split('\n')[1]).toBe(reportNotice);
    const text = pages.join('\n');
    expect(text.split(reportNotice)).toHaveLength(2);
    expect(text).not.toContain('AI-written');
  } finally {
    await rendering.destroy();
  }
});

test('a run with no model-written passage downloads HTML and PDF without the AI title line', async ({ page }) => {
  await page.goto(origin + '/sim?tab=library');
  const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/runArtifact-v0.8-turn-loop.json', import.meta.url), 'utf8'));
  const human = (record: Record<string, unknown>) => ({ ...record, aiWrittenFields: [] });
  const artifact = {
    ...fixture,
    metadata: { ...fixture.metadata, runId: 'run_report_human_fixture' },
    decisions: (fixture.decisions ?? []).map(human),
    specialistNotes: (fixture.specialistNotes ?? []).map(human),
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
  expect(html).toContain('<h2>Decision</h2>');
  expect(html).not.toContain('data-ai-generated="true"');
  expect(html).not.toContain(reportNotice);

  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  const pdfBytes = readFileSync(await pdfDownload.path());
  const dashboardRequire = createRequire(new URL('../../src/dashboard/package.json', import.meta.url));
  const pdfJs = await import(pathToFileURL(dashboardRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const rendering = pdfJs.getDocument({ data: Uint8Array.from(pdfBytes), disableFontFace: true });
  const report = await rendering.promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= report.numPages; index++) {
      const { items } = await (await report.getPage(index)).getTextContent();
      pages.push(items.map((item: { str?: string }) => item.str ?? '').filter(Boolean).join('\n'));
    }
    const text = pages.join('\n');
    expect(text).toContain('Decision');
    expect(text).not.toContain(reportNotice);
  } finally {
    await rendering.destroy();
  }
});

test('the Viz PNG download carries one valid metadata chunk', async ({ page }) => {
  await openPair(page, 'dark');
  await openTab(page, 'viz');
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
  expect(xmp[0]).toContain(iptcSource);
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
  await openTab(page, 'reports');
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
  await expectQuietPage(page);
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
  expect(document.marked).toContain(verdict);
  expect(html).not.toContain('AI-written');
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
    expect(text).toContain(reportNotice);
    expect(text).not.toContain('AI-written');
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
    .and(page.locator(mark)).first();
  await expectMark(authoredArchetype);
  const human = page.getByText('"Leave half the water in storage today."', { exact: true }).filter({ visible: true }).first();
  await expect(human).toBeVisible();
  await expect(human.locator('xpath=ancestor-or-self::*[@data-ai-generated="true"]')).toHaveCount(0);
});

test('applying a personality preset to a generated leader clears the source of its traits only', async ({ page }) => {
  await page.goto(origin + '/sim?tab=settings');
  const generated = await page.request.post(origin + '/api/quickstart/generate-actors', {
    data: { scenarioId: 'mars-genesis', count: 2 },
  });
  expect(generated.ok()).toBe(true);
  const { actors } = await generated.json();
  expect(actors[0].aiAuthorship.fields).toContain('hexaco');
  await page.route('**/scenario', async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, presets: [{ id: 'default', leaders: actors }] } });
  });
  await page.reload();
  await page.getByRole('combobox', { name: 'Personality', exact: true }).first().selectOption('balanced');
  const launch = page.waitForRequest(request => request.url() === origin + '/setup' && request.method() === 'POST');
  await page.getByRole('button', { name: 'Launch simulation' }).click();
  const [edited] = (await launch).postDataJSON().actors;
  expect(edited.hexaco).toEqual({
    openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5,
  });
  expect(edited.aiAuthorship.fields).not.toContain('hexaco');
  expect(edited.aiAuthorship.fields).toEqual(expect.arrayContaining(['name', 'archetype']));
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
    const grid = page.getByTestId('watch-grid-track').locator('canvas').first();
    await expect(grid).toBeVisible();
    await expect.poll(() => grid.evaluate(canvas => {
      const context = (canvas as HTMLCanvasElement).getContext('2d');
      return Boolean(context?.getImageData(0, 0, canvas.clientWidth, canvas.clientHeight).data.some(value => value !== 0));
    }), { message: 'the cohort grid paints the recorded cells' }).toBe(true);

    const typeTokens = [
      '--font-3xs', '--font-2xs', '--font-xs', '--font-sm', '--font-md', '--font-lg', '--font-xl',
      '--font-2xl', '--font-3xl', '--font-read-body', '--font-read', '--font-display',
    ];
    await page.evaluate(tokens => {
      const root = document.documentElement;
      const computed = getComputedStyle(root);
      const sizes = tokens.map(token => [token, Number.parseFloat(computed.getPropertyValue(token))] as const);
      for (const [token, size] of sizes) if (Number.isFinite(size)) root.style.setProperty(token, `${size * 2}px`);
    }, typeTokens);
    // At doubled type the generated leader's text keeps its machine-readable mark and no visible label.
    await settle(profile);
    await expectMark(profile.getByText('ENGINEER', { exact: true }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await profile.getByRole('button', { name: 'Close drill-in' }).click();
    await expect(profile).toHaveCount(0);
  });
}

for (const width of [390, 1280]) {
  test(`a generated leader's bio keeps the supplied leader's layout in Watch at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + '/sim');
    const generated = await page.request.post(origin + '/api/quickstart/generate-actors', {
      data: { scenarioId: 'mars-genesis', count: 2 },
    });
    expect(generated.ok()).toBeTruthy();
    const { actors } = await generated.json();
    expect(actors[0].aiAuthorship.fields).toContain('instructions');
    delete actors[1].aiAuthorship;
    await page.route('**/setup', async route => {
      await route.continue({ postData: { ...route.request().postDataJSON(), actors } });
    });
    await openPair(page, 'light');
    const bio = page.locator('.leaders-row').getByText('"' + actors[0].instructions + '"', { exact: true }).filter({ visible: true });
    await expect(bio).toHaveCount(2);
    await expectMark(bio.nth(0));
    await expectUnmarked(bio.nth(1));
    // Each bio is one line, beside that leader's sparklines where they show, whoever wrote it.
    const rows = await bio.evaluateAll(nodes => nodes.map(node => {
      const subRow = node.closest('div')!;
      const quote = [...subRow.children].find(child => child.contains(node))!;
      const sparklines = subRow.querySelector('.leader-sparklines')!;
      const box = quote.getBoundingClientRect();
      const spark = sparklines.getBoundingClientRect();
      return {
        sameRow: sparklines.getClientRects().length ? spark.top < box.bottom && spark.left >= box.right - 1 : null,
        whiteSpace: getComputedStyle(quote).whiteSpace,
      };
    }));
    const sameRow = width > 480 ? true : null;
    expect(rows).toEqual([
      { sameRow, whiteSpace: 'nowrap' },
      { sameRow, whiteSpace: 'nowrap' },
    ]);
    await page.locator('.leaders-row').filter({ visible: true }).screenshot({
      path: `test-pictures/sim-first-screen/ai-marks/leader-bios-${width}.png`,
      animations: 'disabled',
    });
  });
}

test('Watch, the event log and the verdict dialog each expose ownership on the displayed passage', async ({ page }) => {
  await openPair(page, 'dark');
  const decision = page.getByText('Keep a reserve of water.', { exact: true }).filter({ visible: true }).first();
  await expectMark(decision);
  const card = decision.locator('xpath=ancestor::*[./details/summary[contains(., "Full reasoning")]][1]');
  await card.locator('summary').click();
  await expectMark(card.getByText('The next harvest needs a cushion.', { exact: true }));
  await expectMark(card.locator('details').getByText('Keep a reserve of water.', { exact: true }));

  await expectMark(page.getByText('The reserve carried the crew.', { exact: true }).filter({ visible: true }).first());
  await page.getByRole('button', { name: /View Full Verdict/ }).click();
  const verdict = page.getByRole('dialog', { name: 'Simulation verdict' });
  await expectMark(verdict.getByText('Stored water protected the new crops.', { exact: true }));
  await expect(page.locator(meta)).toHaveCount(1);
  await verdict.getByRole('button', { name: 'Close verdict' }).click();
  await expect(verdict).toBeHidden();

  await openTab(page, 'settings');
  await page.getByRole('tab', { name: 'Event Log', exact: true }).click();
  const log = page.getByRole('log', { name: 'Event log' });
  const row = log.locator('details').filter({ hasText: 'Keep a reserve of water.' }).first();
  await row.locator('summary').click();
  await expectMark(row.locator('pre').filter({ hasText: 'Keep a reserve of water.' }));
});
async function savedPairId(page: Page, actor: string) {
  let id: string | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(origin + '/sessions');
    if (!response.ok()) return false;
    const { sessions } = await response.json();
    id = sessions.find((session: { id: string; leaderA?: string }) => session.leaderA === actor)?.id;
    return Boolean(id);
  }).toBe(true);
  return id!;
}

test('Studio and pinned comparison mark each stored decision', async ({ page }) => {
  const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/runArtifact-v0.8-turn-loop.json', import.meta.url), 'utf8'));
  const leaders = ['Reserve leader', 'Well leader'];
  const decisions = ['Keep the reserve for the next harvest.', 'Open a new well on the east side.'];
  const artifacts = leaders.map((name, index) => ({
    ...fixture,
    leader: { name, archetype: 'Engineer' },
    metadata: { ...fixture.metadata, runId: `marks-studio-${Date.now()}-${index}` },
    provenance: { aiGenerated: true, generator: 'paracosm', models: { commander: `test-commander-${index}` } },
    decisions: [{ ...fixture.decisions[0], actor: name, choice: decisions[index], aiWrittenFields: ['choice'] }],
  }));
  await page.goto(origin + '/sim?tab=studio');
  const drop = page.getByRole('button', { name: /Drop a paracosm RunArtifact JSON/ });
  await drop.locator('input[type="file"]').setInputFiles({
    name: 'authored-runs.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(artifacts)),
  });
  await page.getByRole('button', { name: /Reserve leader/ }).click();
  await expectMark(page.locator('[data-ai-generated="true"]').filter({ hasText: decisions[0] }));
  await expect(page.locator(meta)).toHaveCount(1);
  await page.getByRole('button', { name: /Back to bundle/ }).click();
  const imported = page.waitForResponse(response => response.url().endsWith('/api/v1/library/import')
    && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Promote bundle (2)' }).click();
  await expect(page.getByText(/added to Library \(2 runs\)/)).toBeVisible();
  const { runIds } = await (await imported).json() as { runIds: string[] };
  await page.getByRole('button', { name: 'Compare bundle', exact: true }).click();
  const grid = page.getByRole('region', { name: 'Bundle members grid' });
  const comparison = page.getByRole('region', { name: 'Decision rationale comparison' });
  const firstPin = grid.getByRole('checkbox', { name: `Pin ${leaders[0]} to compare` });
  const firstUnpin = grid.getByRole('checkbox', { name: `Unpin ${leaders[0]}` });
  const detailUrl = `**/api/v1/runs/${encodeURIComponent(runIds[0])}`;
  for (const invalidArtifact of [undefined, 'unreadable']) {
    await page.route(detailUrl, async route => {
      const response = await route.fetch();
      const detail = await response.json();
      await route.fulfill({ response, json: { ...detail, artifact: invalidArtifact } });
    }, { times: 1 });
    await firstPin.press('Space');
    const pinned = page.getByRole('region', { name: 'Pinned runs side-by-side' });
    await expect(pinned.getByText('Run artifact missing or invalid', { exact: true })).toBeVisible();
    await expect(comparison).toHaveCount(0);
    await firstUnpin.press('Space');
    await expect(firstPin).not.toBeChecked();
  }
  // The first run's read is held until the second run is pinned, so both
  // reads are open together, and the first run failed its earlier reads.
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(detailUrl, async route => {
    await held;
    await route.continue().catch(() => undefined);
  }, { times: 1 });
  await firstPin.press('Space');
  await expect(firstUnpin).toBeChecked();
  await grid.getByRole('checkbox', { name: `Pin ${leaders[1]} to compare` }).press('Space');
  await expect(grid.getByRole('checkbox', { name: `Unpin ${leaders[1]}` })).toBeChecked();
  release();
  const pinnedRuns = page.getByRole('region', { name: 'Pinned runs side-by-side' });
  for (const decision of decisions) await expectMark(comparison.getByText(decision, { exact: true }));
  await expect(pinnedRuns.getByText('Run artifact missing or invalid', { exact: true })).toHaveCount(0);
  await expect(pinnedRuns.getByText('loading…', { exact: true })).toHaveCount(0);
  await expect(page.locator(meta)).toHaveCount(1);
  await page.getByRole('button', { name: 'Close compare' }).click();
  await expect(page.locator(meta)).toHaveCount(0);
});

test('Viz marks the model decision in the current turn narrative', async ({ page }) => {
  await openPair(page, 'dark');
  await openTab(page, 'viz');
  const narrative = page.getByRole('status', { name: 'Current turn narrative' });
  await page.getByLabel('Scrub timeline').press('Home');
  await expectMark(narrative.getByText(/keep a reserve of water/i));
  await expectQuietPage(page);
});

const fallbackDecision = 'Commander decision unavailable; defer to department consensus.';

async function openLegacyPair(page: Page, secondLeader?: string) {
  await page.route('**/setup', route => {
    const launch = route.request().postDataJSON();
    launch.actors[0].name = 'Legacy leader';
    if (secondLeader) launch.actors[1].name = secondLeader;
    return route.continue({ postData: launch });
  });
  await openPair(page, 'light');
  await expect(page.getByRole('status', { name: /^Simulation status: Complete\./ })).toBeVisible();
  const id = await savedPairId(page, 'Legacy leader');
  await page.unroute('**/setup');
  return id;
}

test('a run saved before field-level source marks its model passages and leaves fallback text unmarked', async ({ page }) => {
  const id = await openLegacyPair(page, 'Legacy fallback leader');
  await page.goto(origin + '/sim?tab=sim&replay=' + encodeURIComponent(id));
  const decision = page.getByText('Keep a reserve of water.', { exact: true }).filter({ visible: true }).first();
  await expectMark(decision);
  const card = decision.locator('xpath=ancestor::*[./details/summary[contains(., "Full reasoning")]][1]');
  await card.locator('summary').click();
  await expectMark(card.getByText('The next harvest needs a cushion.', { exact: true }));
  await expectUnmarked(page.getByText(fallbackDecision, { exact: true }).filter({ visible: true }));

  await openTab(page, 'reports');
  const report = page.getByRole('region', { name: 'Turn-by-turn report' });
  await expectMark(report.getByText('Keep a reserve of water.', { exact: true }).filter({ visible: true }).first());
  await expectMark(report.getByText('Pressure held overnight.', { exact: true }).filter({ visible: true }).first());
  await expectUnmarked(report.getByText(fallbackDecision, { exact: true }).filter({ visible: true }));
  await expectUnmarked(report.getByText('engineering report unavailable this turn.', { exact: true }).filter({ visible: true }));
  await expectQuietPage(page);

  for (const [actor, authored] of [['Legacy leader', true], ['Legacy fallback leader', false]] as const) {
    const runId = await libraryRunId(page, actor);
    await page.goto(origin + '/sim?tab=library&runId=' + encodeURIComponent(runId));
    const dialog = page.getByRole('dialog', { name: 'Run detail' });
    if (authored) {
      await expectMark(dialog.locator('[data-ai-generated="true"]').filter({ hasText: 'Keep a reserve of water.' }));
      await expectMark(dialog.locator('[data-ai-generated="true"]').filter({ hasText: 'The next harvest needs a cushion.' }));
    } else {
      await expectUnmarked(dialog.getByText(fallbackDecision, { exact: false }));
    }
    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Download PDF' }).click(),
    ]);
    const dashboardRequire = createRequire(new URL('../../src/dashboard/package.json', import.meta.url));
    const pdfJs = await import(pathToFileURL(dashboardRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
    const rendering = pdfJs.getDocument({ data: Uint8Array.from(readFileSync(await pdfDownload.path())), disableFontFace: true });
    const pdf = await rendering.promise;
    try {
      const runJson = Array.from(await pdf.getAttachments() ?? []).find(([, file]) => file.filename === 'run.json');
      expect(runJson, 'the report includes the run as a JSON attachment').toBeDefined();
      const json = JSON.parse(new TextDecoder().decode((await pdf.getAttachmentContent(runJson![0]))!));
      // A run saved before field-level source keeps, in run.json, the authorship the report shows.
      if (authored) expect(json.decisions[0].aiWrittenFields).toEqual(expect.arrayContaining(['choice', 'rationale']));
      else {
        expect(json.decisions[0].choice).toBe(fallbackDecision);
        expect(json.decisions[0].aiWrittenFields).toEqual(expect.any(Array));
        expect(json.decisions[0].aiWrittenFields).not.toContain('choice');
      }
    } finally {
      await rendering.destroy();
    }
  }
});

test('a saved run opened in the same page after another run shows every one of its own events', async ({ browser, page }) => {
  // The stored pair: its second leader shares a name with the pair the page plays next.
  const recorder = await browser.newContext();
  const id = await openLegacyPair(await recorder.newPage()).finally(() => recorder.close());
  await openPair(page, 'light');
  await expect(page.getByRole('status', { name: /^Simulation status: Complete\./ })).toBeVisible();
  await expect(page.getByText('Spend the reserve on new wells.', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  // The page opens the stored pair the way its own address changes do.
  await page.evaluate(replay => {
    const url = new URL(window.location.href);
    url.searchParams.set('replay', replay);
    window.history.pushState(window.history.state, '', url.toString());
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  await expectUnmarked(page.getByText(fallbackDecision, { exact: true }).filter({ visible: true }));
  await expectMark(page.getByText('Keep a reserve of water.', { exact: true }).filter({ visible: true }).first());
  await expect(page.getByText('Spend the reserve on new wells.', { exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('the Library marks a generated archetype apart from the name a person gave the leader', async ({ page }) => {
  await page.goto(origin + '/sim');
  const generated = await page.request.post(origin + '/api/quickstart/generate-actors', {
    data: { scenarioId: 'mars-genesis', count: 2 },
  });
  expect(generated.ok()).toBe(true);
  const { actors } = await generated.json();
  actors[0].name = 'Renamed leader';
  actors[0].aiAuthorship.fields = actors[0].aiAuthorship.fields.filter((field: string) => field !== 'name');
  delete actors[1].aiAuthorship;
  await page.route('**/setup', route => route.continue({ postData: { ...route.request().postDataJSON(), actors } }));
  await openPair(page, 'light');
  const runId = await libraryRunId(page, 'Renamed leader');
  await page.goto(origin + '/sim?tab=library&runId=' + encodeURIComponent(runId));
  const summary = page.getByRole('dialog', { name: 'Run detail' }).locator('section', { has: page.locator('h2') }).first();
  await expectUnmarked(summary.getByText('Renamed leader', { exact: true }));
  await expectMark(summary.getByText('Engineer', { exact: true }));
  await expectQuietPage(page);
});
