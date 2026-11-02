import test from 'node:test';
import assert from 'node:assert/strict';

import { estimateQuickstartCostUSD } from './SeedInput.helpers.js';

test('estimateQuickstartCostUSD: a pair is priced within what measured pairs cost', () => {
  // The hosted demo's pairs cost 0.7397 USD on 1 November 2026 and 1.6138
  // USD on 30 October 2026. The form said ~$0.70 for one, under both.
  const pair = estimateQuickstartCostUSD(2);
  assert.ok(pair >= 0.7397 && pair <= 1.6138, `a pair priced at ${pair}`);
});
