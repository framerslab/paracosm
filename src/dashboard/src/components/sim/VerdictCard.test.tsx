import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';

import { VerdictDetails } from './VerdictCard.js';
import { HeroScoreboard } from '../reports/HeroScoreboard.js';

/** A pair verdict as the server broadcasts it, carrying these score rows. */
function verdict(metrics: unknown[]): any {
  return {
    winner: 'B',
    winnerName: 'Noor',
    headline: 'Noor leads',
    summary: 'Stub.',
    keyDivergence: 'Stub.',
    scores: {
      a: { survival: 5, prosperity: 5, morale: 5, innovation: 5 },
      b: { survival: 6, prosperity: 6, morale: 6, innovation: 6 },
    },
    leaderA: { name: 'Lee', archetype: 'The Planner', unit: 'Alpha' },
    leaderB: { name: 'Noor', archetype: 'The Gambler', unit: 'Beta' },
    settlementNoun: 'clinic',
    finalStats: {
      a: { tools: 1 },
      b: { tools: 1 },
      metrics,
    },
  };
}

const card = (metrics: unknown[]) => renderToString(<VerdictDetails v={verdict(metrics)} />);
const hero = (metrics: unknown[]) =>
  renderToString(<HeroScoreboard verdict={verdict(metrics)} leaderAName="Lee" leaderBName="Noor" />);

/** The text and style of the value span for one side of a card row. */
function cardValues(html: string): string[] {
  return [...html.matchAll(/--stat-color:([^;"]+)[^>]*>([^<]*)</g)].map(m => `${m[1]} ${m[2]}`);
}

test('a score no run holds on one side reads n/a and names no leader', () => {
  const rows = [{ id: 'x', label: 'Throughput', format: 'number', a: 5 }];
  const values = cardValues(card(rows)).slice(0, 2);
  assert.deepEqual(values, ['var(--text-2) 5', 'var(--text-2) n/a']);

  const scoreboard = hero(rows);
  assert.match(scoreboard, />n\/a</);
  assert.doesNotMatch(scoreboard, />0</);
  assert.doesNotMatch(scoreboard, /--val-weight:700/);
});

test('a lower-is-better score colours the lower side as the leader', () => {
  const rows = [{ id: 'hba1c', label: 'HbA1c', format: 'number', better: 'lower', a: 7.8, b: 6.9 }];
  assert.deepEqual(cardValues(card(rows)).slice(0, 2), ['var(--text-2) 7.80', 'var(--eng) 6.90']);
});

test('the card and the scoreboard show a score with its unit and currency', () => {
  const rows = [
    { id: 'powerKw', label: 'Power', format: 'number', unit: 'kW', a: 400, b: 380 },
    { id: 'arr', label: 'ARR', format: 'currency', currency: 'USD', a: 1200, b: 1500 },
  ];
  for (const html of [card(rows), hero(rows)]) {
    assert.match(html, /Power \(kW\)/);
    assert.match(html, /1200 USD/);
    assert.match(html, /1500 USD/);
  }
});

test('the scoreboard stays out of a finished cohort, which has its own view', () => {
  const html = renderToString(
    <HeroScoreboard
      verdict={{ mode: 'cohort', winner: 'Noor', finalStats: [{ actorName: 'Noor', actorIndex: 0, metrics: [] }] }}
      leaderAName="Lee"
      leaderBName="Noor"
    />,
  );
  assert.equal(html, '');
});
