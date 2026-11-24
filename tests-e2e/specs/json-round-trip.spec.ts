import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { RunArtifact } from '../../src/engine/schema/index.js';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The writable Library runs on a local fixture server.');
test.use({ baseURL: 'http://127.0.0.1:3460' });

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), 'utf8')) as T;
}

const single = fixture<RunArtifact>('runArtifact-v0.8-turn-loop.json');
const bundle = fixture<RunArtifact[]>('runArtifact-v0.8-bundle.json');

async function retrieve(request: APIRequestContext, runId: string): Promise<RunArtifact> {
  const response = await request.get(`/api/v1/runs/${encodeURIComponent(runId)}`);
  expect(response.status()).toBe(200);
  return (await response.json()).artifact as RunArtifact;
}

test('a legacy turn-loop file opens its recorded decisions after a reload', async ({ page }) => {
  await page.goto('/sim?tab=library');
  const response = await page.request.post('/api/v1/library/import', { data: { artifact: single } });
  expect(response.status()).toBe(201);
  const { runId } = await response.json();
  expect(runId).toBe(single.metadata.runId);
  const imported = await retrieve(page.request, runId);
  expect(imported.decisions).toEqual(single.decisions);
  expect(imported).not.toHaveProperty('provenance');

  await page.goto(`/sim?tab=library&runId=${encodeURIComponent(runId)}`);
  const decision = page.getByRole('dialog', { name: 'Run detail' }).getByText('Conserve power', { exact: false });
  await expect(decision).toBeVisible();
  await page.reload();
  await expect(decision).toBeVisible();
});

test('each member of a legacy bundle keeps its recorded metrics', async ({ page }) => {
  await page.goto('/sim?tab=library');
  const response = await page.request.post('/api/v1/library/import', { data: { artifacts: bundle } });
  expect(response.status()).toBe(201);
  const { runIds } = await response.json();
  expect(runIds).toEqual(bundle.map(artifact => artifact.metadata.runId));
  for (const [index, source] of bundle.entries()) {
    const imported = await retrieve(page.request, runIds[index]);
    expect(imported.trajectory?.timepoints?.map(point => point.worldSnapshot?.metrics))
      .toEqual(source.trajectory?.timepoints?.map(point => point.worldSnapshot?.metrics));
    expect(imported).not.toHaveProperty('provenance');
  }
});

test('a marked file keeps its provenance and rejects invalid markers', async ({ page }) => {
  await page.goto('/sim?tab=library');
  const provenance = { aiGenerated: true, generator: 'paracosm', models: { commander: 'gpt-4o' } };
  const artifact = { ...single, metadata: { ...single.metadata, runId: 'run_studio_fixture_marked' }, provenance };
  const response = await page.request.post('/api/v1/library/import', { data: { artifact } });
  expect(response.status()).toBe(201);
  const { runId } = await response.json();
  expect((await retrieve(page.request, runId)).provenance).toEqual(provenance);

  for (const invalid of [
    { ...provenance, aiGenerated: false },
    { ...provenance, generator: 'other' },
    { ...provenance, models: { commander: 42 } },
    { ...provenance, models: { commander: '' } },
  ]) {
    const rejected = await page.request.post('/api/v1/library/import', {
      data: { artifact: { ...artifact, provenance: invalid } },
    });
    expect(rejected.status()).toBe(400);
  }
});
