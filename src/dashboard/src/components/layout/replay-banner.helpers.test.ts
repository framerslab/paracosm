import test from 'node:test';
import assert from 'node:assert/strict';

import { formatRoster } from './ReplayBanner';

test('formatRoster: 3+ actors under headLimit → comma list, no "+N more"', () => {
  assert.equal(
    formatRoster({ leaders: ['Aria', 'Maria', 'Atlas'] }, 4),
    'Aria, Maria, Atlas',
  );
});

test('formatRoster: 3+ actors over headLimit → first N + "+rest more"', () => {
  assert.equal(
    formatRoster({ leaders: ['Aria', 'Maria', 'Atlas', 'Reyes', 'Sato', 'Yu', 'Khan', 'Vega', 'Roe'] }, 4),
    'Aria, Maria, Atlas, Reyes, +5 more',
  );
});

test('formatRoster: pair run (no leaders array) → "A vs B"', () => {
  assert.equal(
    formatRoster({ leaderA: 'Aria', leaderB: 'Maria' }),
    'Aria vs Maria',
  );
});

test('formatRoster: leaders array with only 2 entries falls back to leaderA/B', () => {
  // Defensive — should never happen because deriveMetadata only stamps
  // leaders for n>=3, but if a future migration writes a 2-element array,
  // we want the legacy behaviour rather than rendering a tiny "Aria,
  // Maria" without "vs" between them.
  assert.equal(
    formatRoster({ leaders: ['Aria', 'Maria'], leaderA: 'Aria', leaderB: 'Maria' }),
    'Aria vs Maria',
  );
});

test('formatRoster: solo leaderA renders just the name', () => {
  assert.equal(formatRoster({ leaderA: 'Aria' }), 'Aria');
});

test('formatRoster: solo leaderB renders just the name', () => {
  assert.equal(formatRoster({ leaderB: 'Maria' }), 'Maria');
});

test('formatRoster: empty meta → empty string (caller skips the slot)', () => {
  assert.equal(formatRoster({}), '');
  assert.equal(formatRoster(null), '');
  assert.equal(formatRoster(undefined), '');
});

test('formatRoster: leaders array with exactly headLimit names → no "+0 more"', () => {
  // Boundary: 4 names with headLimit=4 should render "A, B, C, D"
  // not "A, B, C, D, +0 more".
  assert.equal(
    formatRoster({ leaders: ['A', 'B', 'C', 'D'] }, 4),
    'A, B, C, D',
  );
});
