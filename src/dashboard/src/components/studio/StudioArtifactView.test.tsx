import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { StudioArtifactView } from './StudioArtifactView.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '../../../../../tests/fixtures');
const turnLoopArtifact = JSON.parse(readFileSync(resolve(fixtureDir, 'runArtifact-v0.8-turn-loop.json'), 'utf-8')) as RunArtifact;
const batchArtifact = JSON.parse(readFileSync(resolve(fixtureDir, 'runArtifact-v0.8-batch.json'), 'utf-8')) as RunArtifact;

test('StudioArtifactView: turn-loop artifact renders the per-turn list', () => {
  const html = renderToString(<StudioArtifactView artifact={turnLoopArtifact} onPromote={() => {}} onCompare={() => {}} />);
  // ReportViewAdapter renders "Turn N" headers per timepoint. React's
  // SSR splits adjacent text nodes with HTML comments, so the literal
  // string contains "Turn <!-- -->1" — match across the comment.
  assert.match(html, /Turn (<!-- -->)?1/);
  assert.match(html, /Turn (<!-- -->)?3/);
  // Metric values from the fixture appear inside the metrics <pre>.
  // Quotes in the SSR'd JSON.stringify output are HTML-escaped to &quot;.
  assert.match(html, /morale/);
  assert.match(html, /0\.85/);
});

test('StudioArtifactView: batch-trajectory artifact renders the BatchArtifactView path', () => {
  const html = renderToString(<StudioArtifactView artifact={batchArtifact} onPromote={() => {}} onCompare={() => {}} />);
  // BatchArtifactView's distinctive output: "Batch trajectory (N timepoints)".
  assert.match(html, /Batch trajectory/i);
  // Time-unit label from the fixture should appear (singular Q1/Q2 columns).
  assert.match(html, /Q1/);
});

test('StudioArtifactView: header surfaces actor name + scenario name', () => {
  const html = renderToString(<StudioArtifactView artifact={turnLoopArtifact} onPromote={() => {}} onCompare={() => {}} />);
  assert.match(html, /Aria Chen/);
  assert.match(html, /Mars Genesis/);
});

test('StudioArtifactView: inline mode hides Promote and Compare buttons', () => {
  const html = renderToString(<StudioArtifactView artifact={turnLoopArtifact} inline onPromote={() => {}} onCompare={() => {}} />);
  assert.ok(!html.includes('>Promote to Library<'));
  assert.ok(!html.includes('>Compare<'));
});
