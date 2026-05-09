import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { HighlightStrip } from './HighlightStrip';

void React;

describe('HighlightStrip', () => {
  it('renders the text and an aria-live status role', () => {
    const html = renderToString(
      <HighlightStrip text="Turn 3: Leader B lost 4 colonists." turn={3} />,
    );
    assert.match(html, /Leader B lost 4/);
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
  });

  it('shows a More toggle when text exceeds 120 chars', () => {
    const long = 'x'.repeat(200);
    const html = renderToString(<HighlightStrip text={long} turn={1} />);
    assert.match(html, />More</);
    assert.match(html, /aria-expanded="false"/);
  });

  it('does not render the toggle for short text', () => {
    const html = renderToString(
      <HighlightStrip text="Turn 1: identical first event." turn={1} />,
    );
    assert.ok(!/>More</.test(html), 'no More toggle for short text');
  });
});
