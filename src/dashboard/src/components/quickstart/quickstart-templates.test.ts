import test from 'node:test';
import assert from 'node:assert/strict';

import { QUICKSTART_TEMPLATES } from './quickstart-templates.js';

test('quickstart templates: ids are unique (React keys + telemetry)', () => {
  const ids = QUICKSTART_TEMPLATES.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id would break React reconciliation in the dropdown');
});

test('quickstart templates: every seed clears the 200-char compile-from-seed schema floor', () => {
  for (const t of QUICKSTART_TEMPLATES) {
    assert.ok(
      t.seedText.trim().length >= 200,
      `template ${t.id} seedText is ${t.seedText.trim().length} chars; CompileFromSeedSchema floor is 200`,
    );
  }
});

test('quickstart templates: seeds stay under the 50000-char schema ceiling', () => {
  for (const t of QUICKSTART_TEMPLATES) {
    assert.ok(
      t.seedText.length <= 50_000,
      `template ${t.id} seedText is ${t.seedText.length} chars; CompileFromSeedSchema ceiling is 50000`,
    );
  }
});

test('quickstart templates: every label looks like a "What if …?" question (matches landing chips)', () => {
  for (const t of QUICKSTART_TEMPLATES) {
    assert.match(t.label, /^What if /, `template ${t.id} label "${t.label}" should start with "What if "`);
    assert.match(t.label, /\?$/, `template ${t.id} label "${t.label}" should end with a question mark`);
  }
});

test('quickstart templates: list has at least 5 entries (matches landing-page chip count)', () => {
  assert.ok(QUICKSTART_TEMPLATES.length >= 5, `expected ≥5 templates, got ${QUICKSTART_TEMPLATES.length}`);
});
