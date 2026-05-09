import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';

import { TabBar } from './TabBar.js';

const baseScenario: any = {
  policies: { characterChat: true },
};

// Per-tab attribute-extraction helper. SSR HTML attribute order is
// determined by React; using `<button[^>]*>` between attribute checks
// avoids relying on whatever order React happens to emit them in.
function extractTabAttrs(html: string, tabId: string): Record<string, string | undefined> {
  const re = new RegExp(`<button[^>]*id="tab-${tabId}"[^>]*>`);
  const match = html.match(re);
  if (!match) return {};
  const attrs: Record<string, string> = {};
  // Grab key="value" pairs from the matched <button ...> tag.
  for (const m of match[0].matchAll(/([a-z-]+)="([^"]*)"/gi)) {
    attrs[m[1]!] = m[2]!;
  }
  return attrs;
}

test('TabBar: only the active tab has tabindex=0 (roving tabindex per ARIA APG)', () => {
  const html = renderToString(
    <TabBar active="sim" onTabChange={() => {}} scenario={baseScenario} />,
  );
  assert.equal(extractTabAttrs(html, 'sim').tabindex, '0', 'active tab has tabindex=0');
  assert.equal(extractTabAttrs(html, 'quickstart').tabindex, '-1', 'inactive tab has tabindex=-1');
});

test('TabBar: aria-controls links each tab to its panel', () => {
  const html = renderToString(
    <TabBar active="sim" onTabChange={() => {}} scenario={baseScenario} />,
  );
  assert.equal(extractTabAttrs(html, 'sim')['aria-controls'], 'tabpanel-sim');
  assert.equal(extractTabAttrs(html, 'viz')['aria-controls'], 'tabpanel-viz');
});

test('TabBar: server render does not depend on browser viewport globals', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
  try {
    const html = renderToString(
      <TabBar active="sim" onTabChange={() => {}} scenario={baseScenario} />,
    );
    assert.ok(html.includes('id="tab-sim"'), 'tab rendered without window/document');
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
  }
});

test('TabBar: every tab has one accessible name while visible labels stay present', () => {
  const html = renderToString(
    <TabBar active="sim" onTabChange={() => {}} scenario={baseScenario} />,
  );
  const attrs = extractTabAttrs(html, 'quickstart');
  assert.equal(attrs['aria-label'], 'QUICKSTART');
  assert.ok(html.includes('>QUICKSTART<'), 'visible label still rendered for CSS desktop layout');
});

test('TabBar: respects scenario policy gating (chat tab hidden when characterChat is off)', () => {
  const noChatScenario: any = { policies: { characterChat: false } };
  const html = renderToString(
    <TabBar active="sim" onTabChange={() => {}} scenario={noChatScenario} />,
  );
  assert.ok(!html.includes('id="tab-chat"'), 'chat tab gated off');
  assert.ok(html.includes('id="tab-sim"'), 'other tabs unaffected');
});
