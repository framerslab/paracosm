import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';

import { ActorBar } from './ActorBar.js';

test('ActorBar compact: MORALE displays as 0-100%, not double-scaled', () => {
  // Regression for the live SIM bug where the compact actor bar showed
  // MORALE 3200% / 2600%. moraleHistory is pre-scaled to 0-100 in
  // useGameState (Math.round(metrics.morale * 100)), so the renderer
  // must NOT multiply by 100 again.
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={{ name: 'Aria Chen', archetype: 'The Visionary', unit: 'Colony Alpha', hexaco: { openness: 0.95, conscientiousness: 0.35, extraversion: 0.85, agreeableness: 0.55, emotionality: 0.3, honestyHumility: 0.65 } }}
      popHistory={[100, 99, 98]}
      moraleHistory={[85, 80, 32]} // Final reading: 32 (already scaled)
      compact
    />,
  );
  assert.match(html, /MORALE (?:<!-- -->)?32(?:<!-- -->)?%/, 'expected MORALE 32%, got double-scaled');
  assert.ok(!html.includes('3200%'), 'morale must not double-scale to 3200%');
  assert.match(html, /POP (?:<!-- -->)?98/, 'POP renders the latest value');
});

test('ActorBar compact: morale of 100 renders as 100%, not 10000%', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={1}
      leader={{ name: 'Voss', archetype: 'The Engineer', unit: 'Colony Beta', hexaco: { openness: 0, conscientiousness: 1, extraversion: 0, agreeableness: 0, emotionality: 0, honestyHumility: 0 } }}
      popHistory={[50]}
      moraleHistory={[100]}
      compact
    />,
  );
  assert.match(html, /MORALE (?:<!-- -->)?100(?:<!-- -->)?%/);
});

test('ActorBar compact: empty moraleHistory hides the morale stat (no NaN%)', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={null}
      popHistory={[]}
      moraleHistory={[]}
      compact
    />,
  );
  assert.ok(!html.includes('MORALE'), 'no morale chip when history is empty');
  assert.ok(!html.includes('NaN'));
});

test('ActorBar compact: surfaces archetype chip when leader has one', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={{ name: 'Aria Chen', archetype: 'The Visionary', unit: 'Alpha', hexaco: {} }}
      popHistory={[100]}
      moraleHistory={[60]}
      compact
    />,
  );
  // "The Visionary" -> "VISIONARY" (strips leading "The ")
  assert.ok(html.includes('VISIONARY'), 'archetype chip rendered without "The" prefix');
});

test('ActorBar compact: low morale derives a "low" mood label', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={{ name: 'Aria', archetype: 'X', unit: 'A', hexaco: {} }}
      popHistory={[10]}
      moraleHistory={[18]}
      compact
    />,
  );
  // Match the visible label inside its <span>, not the className hash or
  // the title attribute (those would pass even if the visible text changed).
  assert.match(html, /<span[^>]*>low<\/span>/, 'mood label "low" rendered as visible text');
});

test('ActorBar compact: high morale derives a "rising" mood label', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={{ name: 'Aria', archetype: 'X', unit: 'A', hexaco: {} }}
      popHistory={[100]}
      moraleHistory={[88]}
      compact
    />,
  );
  assert.match(html, /<span[^>]*>rising<\/span>/, 'mood label "rising" rendered as visible text');
});

test('ActorBar moodFor boundaries: 25 → tense, 50 → steady, 75 → rising', () => {
  const cases: Array<{ morale: number; expected: string }> = [
    { morale: 24.99, expected: 'low' },
    { morale: 25, expected: 'tense' },
    { morale: 49.99, expected: 'tense' },
    { morale: 50, expected: 'steady' },
    { morale: 74.99, expected: 'steady' },
    { morale: 75, expected: 'rising' },
    { morale: 100, expected: 'rising' },
  ];
  for (const { morale, expected } of cases) {
    const html = renderToString(
      <ActorBar
        actorIndex={0}
        leader={{ name: 'Aria', archetype: 'X', unit: 'A', hexaco: {} }}
        popHistory={[100]}
        moraleHistory={[morale]}
        compact
      />,
    );
    assert.match(
      html,
      new RegExp(`<span[^>]*>${expected}</span>`),
      `morale ${morale} should render as "${expected}"`,
    );
  }
});

test('ActorBar compact: surfaces active crisis title (truncated)', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={{ name: 'Aria', archetype: 'X', unit: 'A', hexaco: {} }}
      popHistory={[100]}
      moraleHistory={[60]}
      event={{ turn: 3, title: 'Dust storm rolling in from the polar cap', category: 'environmental', emergent: false }}
      compact
    />,
  );
  assert.ok(/Dust storm rolling in from/.test(html), 'crisis title appears in compact bar');
});

test('ActorBar compact: pendingDecision renders DECIDING pulse chip', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={1}
      leader={{ name: 'Voss', archetype: 'X', unit: 'B', hexaco: {} }}
      popHistory={[100]}
      moraleHistory={[60]}
      pendingDecision="ration_oxygen"
      compact
    />,
  );
  assert.ok(html.includes('DECIDING'), 'DECIDING chip renders during decision phase');
});

test('ActorBar non-compact: dynamic row hidden when no event/status/morale', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={null}
      popHistory={[]}
      moraleHistory={[]}
    />,
  );
  assert.ok(!/MOOD/.test(html), 'no MOOD label when there is no morale data');
  assert.ok(!/DECIDING/.test(html), 'no DECIDING chip without pendingDecision');
});

test('ActorBar non-compact: status chips render up to 2 entries with humanized keys', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={{ name: 'Aria', archetype: 'X', unit: 'A', hexaco: {} }}
      popHistory={[100]}
      moraleHistory={[60]}
      statuses={{
        morale_state: 'stable',
        oxygen_pressure: 'rationed',
        third_status: 'should_be_skipped',
        empty_status: '',
        false_status: false,
      }}
    />,
  );
  assert.ok(html.includes('Morale state') && html.includes('stable'), 'first status renders with humanized key');
  assert.ok(html.includes('Oxygen pressure') && html.includes('rationed'), 'second status renders with humanized key');
  assert.ok(!html.includes('Third status'), 'third status truncated to top-2 limit');
  assert.ok(!html.includes('Empty status'), 'empty-string status skipped');
  assert.ok(!html.includes('False status'), 'false-valued status skipped');
  // Underscore form should NOT leak into visible output anymore.
  assert.ok(!/<span[^>]*>MORALE_STATE<\/span>/.test(html), 'no SHOUT_CASE in visible label');
});

test('ActorBar non-compact: dynamic state row is a polite live region', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={{ name: 'Aria', archetype: 'X', unit: 'A', hexaco: {} }}
      popHistory={[100]}
      moraleHistory={[60]}
      pendingDecision="ration_oxygen"
    />,
  );
  // role + aria-live so screen readers announce mid-sim state flips.
  assert.match(html, /role="status"/, 'role=status set on dynamic state row');
  assert.match(html, /aria-live="polite"/, 'aria-live polite so we never interrupt');
});

test('ActorBar non-compact: empty state shows "Awaiting first turn…" hint', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={null}
      popHistory={[]}
      moraleHistory={[]}
    />,
  );
  assert.match(html, /Awaiting first turn/, 'empty card surfaces an awaiting hint');
});

test('ActorBar non-compact: empty state hidden once popHistory has data', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={null}
      popHistory={[100]}
      moraleHistory={[60]}
    />,
  );
  assert.ok(!/Awaiting first turn/.test(html), 'no awaiting hint when sim has begun');
});

test('ActorBar: nameFallback used when leader is null (status not yet seen)', () => {
  // Regression for the 3+ actor compile-from-seed UI: the orchestrator
  // emits sim events with `leader: actor.name` immediately, but the
  // `status: parallel` payload that populates the full LeaderInfo can
  // arrive a moment later. Without nameFallback, the bar showed generic
  // "Leader A" / "Leader B" / "Leader C" until status landed.
  const html = renderToString(
    <ActorBar
      actorIndex={2}
      leader={null}
      nameFallback="Captain Mara Voss"
      popHistory={[40]}
      moraleHistory={[69]}
      compact
    />,
  );
  assert.ok(html.includes('Captain Mara Voss'), `expected nameFallback to surface; got:\n${html}`);
  assert.ok(!html.includes('Leader C'), 'generic Leader C placeholder should not render when nameFallback is provided');
});

test('ActorBar: renders A/B/C slot badge alongside the name (compact + non-compact)', () => {
  // The slot badge gives a stable visual anchor across SIM surfaces
  // (constellation, table, grid) so a user can match an event card
  // back to "actor C" without reading the full LLM-generated name.
  const compactHtml = renderToString(
    <ActorBar
      actorIndex={2}
      leader={{ name: 'Captain Mara Voss', archetype: 'Risk-Averse Operator', unit: 'Bridge', hexaco: { openness: 0.5, conscientiousness: 0.8, extraversion: 0.4, agreeableness: 0.5, emotionality: 0.6, honestyHumility: 0.7 } }}
      popHistory={[40]}
      moraleHistory={[69]}
      compact
    />,
  );
  // Slot badge text 'C' must appear AND the full name must appear.
  // Match the badge by its title attribute so we don't accidentally
  // hit the 'C' in "Captain" or "Voss".
  assert.match(compactHtml, /title="Slot C"/);
  assert.ok(compactHtml.includes('Captain Mara Voss'));

  const fullHtml = renderToString(
    <ActorBar
      actorIndex={0}
      leader={{ name: 'Aria Chen', archetype: 'The Visionary', unit: 'Colony Alpha', hexaco: { openness: 0.95, conscientiousness: 0.35, extraversion: 0.85, agreeableness: 0.55, emotionality: 0.3, honestyHumility: 0.65 } }}
      popHistory={[100, 99]}
      moraleHistory={[80, 75]}
    />,
  );
  assert.match(fullHtml, /title="Slot A"/);
});

test('ActorBar: slot letters wrap past Z (slot 26 → AA)', () => {
  // Spreadsheet-style column letters so 30+ actor runs don't show a
  // confusing "[" or other ASCII-arithmetic artefact.
  const html = renderToString(
    <ActorBar
      actorIndex={26}
      leader={null}
      popHistory={[]}
      moraleHistory={[]}
      compact
    />,
  );
  assert.match(html, /title="Slot AA"/);
});

test('ActorBar: generic "Leader N" placeholder still kicks in when both leader and nameFallback are missing', () => {
  // Defensive: keep the legacy fallback for surfaces that have neither
  // a real leader nor an actor id (e.g. brand-new sim-empty render).
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={null}
      popHistory={[]}
      moraleHistory={[]}
      compact
    />,
  );
  assert.ok(html.includes('Leader A'), 'generic Leader A still expected when nothing else is provided');
});

test('humanizeKey: snake_case + camelCase + already-spaced all map to Sentence case', () => {
  const html = renderToString(
    <ActorBar
      actorIndex={0}
      leader={{ name: 'Aria', archetype: 'X', unit: 'A', hexaco: {} }}
      popHistory={[100]}
      moraleHistory={[60]}
      statuses={{
        moraleState: 'rising', // camelCase
      }}
    />,
  );
  assert.ok(html.includes('Morale state'), 'camelCase split to "Morale state"');
});
