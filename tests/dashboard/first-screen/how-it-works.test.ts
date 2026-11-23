/**
 * The How it works card's six lines: the fourth names the run's turns and
 * the scenario's word for a settlement, or neither until the scenario has
 * loaded, and the sixth says how many leaders run at a time only when that
 * figure is given.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAWING_ALT, howItWorksLines } from '../../../src/dashboard/src/components/quickstart/first-screen/words.js';

/** A line as it reads, its no-break spaces as plain ones. */
const plain = (line: string): string => line.replace(/ /g, ' ');

test('the fourth line names the run’s turns and the scenario’s settlement', () => {
  const lines = howItWorksLines({ turns: 8, settlement: 'outpost' });
  assert.equal(lines.length, 6);
  assert.equal(plain(lines[3]), 'After turn 8 a verdict names the winner or a tie, says why, and scores each outpost 0 to 10 for survival, prosperity, morale and innovation.');
  // The turn number stays with its word, and the score range on one line.
  assert.ok(lines[3].includes('turn 8'));
  assert.ok(lines[3].includes('0 to 10'));
});

test('before the scenario has loaded the fourth line names neither', () => {
  const expected = 'After the last turn a verdict names the winner or a tie, says why, and scores each side 0 to 10 for survival, prosperity, morale and innovation.';
  assert.equal(plain(howItWorksLines()[3]), expected);
  // A settlement word that is blank reads as none.
  assert.equal(plain(howItWorksLines({ settlement: '  ' })[3]), expected);
  // A scenario's word is written in lower case, inside the sentence.
  assert.ok(plain(howItWorksLines({ turns: 6, settlement: 'Colony' })[3]).includes('scores each colony 0 to 10'));
});

test('the sixth line says how many run at a time only when the figure is given', () => {
  assert.equal(
    plain(howItWorksLines({ turns: 6, settlement: 'colony' })[5]),
    'With 3 or more leaders, each runs the scenario on its own. The report ranks them in quarters on morale, population and deaths, with no single winner.',
  );
  assert.equal(
    plain(howItWorksLines({ turns: 6, settlement: 'colony', batch: 8 })[5]),
    'With 3 or more leaders, each runs the scenario on its own, 8 at a time. The report ranks them in quarters on morale, population and deaths, with no single winner.',
  );
});

test('each drawing’s text alternative says the sample turn’s own figures', () => {
  assert.equal(DRAWING_ALT.bar, 'A sample turn: a bar set at 36 with a chance of 80, which reaches it');
  assert.equal(DRAWING_ALT.stamp, 'The stamp that turn earns: RISKY WIN, the bold option taken, and it paid off');
  assert.equal(DRAWING_ALT.scores, 'Four sample scores out of 10: survival 7, prosperity 6, morale 8, innovation 5');
});
