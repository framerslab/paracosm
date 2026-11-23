import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import type { ScenarioClientPayload } from '../../hooks/useScenario.js';
import { TabBar } from './TabBar.js';

const scenario = { policies: { characterChat: true } } as ScenarioClientPayload;

test('TabBar: renders three section links and a menu button without browser globals', () => {
  assert.equal(typeof window, 'undefined');
  assert.equal(typeof document, 'undefined');
  const html = renderToString(
    <TabBar active="sim" onTabChange={() => {}} scenario={scenario} moreFirstLine={null} />,
  );
  const links = html.match(/<a\b[^>]*>/g) ?? [];
  const buttons = html.match(/<button\b[^>]*>/g) ?? [];
  assert.equal(links.length, 3);
  assert.equal(buttons.length, 1);
  assert.match(html, /<nav\b[^>]*aria-label="Sections"/);
  assert.match(links[0]!, /href="\/sim\?tab=quickstart"/);
  assert.match(links[1]!, /href="\/sim\?tab=sim"/);
  assert.match(links[1]!, /aria-current="page"/);
  assert.match(links[2]!, /href="\/sim\?tab=reports"/);
  assert.match(buttons[0]!, /aria-haspopup="menu"/);
  assert.match(buttons[0]!, /aria-expanded="false"/);
  assert.doesNotMatch(html, /role="tab(list)?"/);
});
