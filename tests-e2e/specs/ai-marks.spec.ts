import { readFileSync } from 'node:fs';
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
  await expect(block.getByText('AI-written', { exact: true })).toBeVisible();
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

  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  const pdf = await PDFDocument.load(readFileSync(await pdfDownload.path()));
  const stream = pdf.catalog.lookup(PDFName.of('Metadata'), PDFRawStream);
  const xmp = new TextDecoder().decode(stream.getContents());
  const embedded = await page.evaluate(source => {
    const xml = new DOMParser().parseFromString(source, 'application/xml');
    return JSON.parse(xml.getElementsByTagNameNS('https://paracosm.agentos.sh/ns/provenance/1.0/', 'provenance')[0].textContent!);
  }, xmp);
  expect(embedded).toEqual(provenance);
});
