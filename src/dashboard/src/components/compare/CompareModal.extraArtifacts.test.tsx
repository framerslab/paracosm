import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { CompareModal } from './CompareModal.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '../../../../../tests/fixtures');
const turnLoopArtifact = JSON.parse(readFileSync(resolve(fixtureDir, 'runArtifact-v0.8-turn-loop.json'), 'utf-8')) as RunArtifact;

test('CompareModal: extraArtifacts only (no bundleId) renders without crash + includes uploaded marker', () => {
  const html = renderToString(
    <CompareModal
      bundleId={null}
      extraArtifacts={[turnLoopArtifact]}
      open
      onClose={() => {}}
    />,
  );
  assert.match(html, /Aria Chen/);
  assert.match(html, /uploaded/i);
});

test('CompareModal: existing bundleId-only invocation still works (regression)', () => {
  // Open with a bundleId but no extraArtifacts — modal should render
  // the existing bundle-only flow without throwing.
  const html = renderToString(
    <CompareModal bundleId={'bundle_test'} open onClose={() => {}} />,
  );
  // Loading state (bundle fetch hasn't resolved in SSR) is acceptable.
  assert.ok(typeof html === 'string');
});
