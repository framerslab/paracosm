import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';

import { DiffBadge } from './DiffBadge.js';

test('DiffBadge: same → ✓ SAME with `same` class and aria-label', () => {
  const html = renderToString(<DiffBadge classification="same" />);
  assert.match(html, /✓ SAME/);
  assert.match(html, /aria-label="Same event, same outcome"/);
});

test('DiffBadge: different-outcome → ⚠ DIFFERENT OUTCOME', () => {
  const html = renderToString(<DiffBadge classification="different-outcome" />);
  assert.match(html, /⚠ DIFFERENT OUTCOME/);
  assert.match(html, /aria-label="Same event, different outcome"/);
});

test('DiffBadge: different-event → ⚠ DIFFERENT EVENT', () => {
  const html = renderToString(<DiffBadge classification="different-event" />);
  assert.match(html, /⚠ DIFFERENT EVENT/);
});

test('DiffBadge: pending → … running', () => {
  const html = renderToString(<DiffBadge classification="pending" />);
  assert.match(html, /… running/);
});

test('DiffBadge: one-sided → · · · waiting', () => {
  const html = renderToString(<DiffBadge classification="one-sided" />);
  assert.match(html, /· · · waiting/);
});
