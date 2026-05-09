import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { VizLegendBar } from './VizLegendBar';

void React;

const fakeDepts = [
  { id: 'medical', label: 'Medical', color: '#dc2626' },
  { id: 'engineering', label: 'Engineering', color: '#f97316' },
];

describe('VizLegendBar', () => {
  it('renders the four glyphs + Show full legend trigger', () => {
    const html = renderToString(<VizLegendBar departments={fakeDepts} />);
    assert.match(html, /Department band/);
    assert.match(html, /Agent/);
    assert.match(html, /Featured agent/);
    assert.match(html, /Turn marker/);
    assert.match(html, /Show full legend/);
  });

  it('does not render the popover until clicked (initial state)', () => {
    const html = renderToString(<VizLegendBar departments={fakeDepts} />);
    assert.ok(!/role="dialog"/.test(html), 'popover should be closed by default');
  });
});
