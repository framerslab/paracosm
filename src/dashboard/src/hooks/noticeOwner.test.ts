/**
 * A finish notice is recorded under the run it belongs to, so each shows
 * once. A fork arrives with a run key of its own while the page keeps its
 * parent's finish and verdict: the key the page holds then is not the run
 * that finished. Recorded under the held key, the parent's finish and its
 * winner were announced a second time when a fork started.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { finishSignal, noticeOwner, type NoticeOwner } from './noticeOwner';

/** The run each step's state belongs to, as a page that passes through the steps keeps it. */
function ownersOf<T>(steps: ReadonlyArray<readonly [state: T, heldRunKey: string | null]>): Array<string | null> {
  let owner: NoticeOwner<T> | null = null;
  return steps.map(([state, heldRunKey]) => {
    owner = noticeOwner(owner, state, heldRunKey);
    return owner.runKey;
  });
}

test('a finish stays with the run that finished when a fork brings its key', () => {
  const owners = ownersOf([
    [finishSignal(false, false, 0), null],     // the page opens
    [finishSignal(false, false, 0), 'pair'],   // the pair's run arrives
    [finishSignal(false, false, 2), 'pair'],   // both leaders' results, the run still open
    [finishSignal(true, false, 2), 'pair'],    // the pair finishes
    [finishSignal(true, false, 2), 'fork'],    // a fork starts: the page keeps the pair's finish
    [finishSignal(true, false, 3), 'fork'],    // the fork's result: the fork finishes
  ]);
  assert.equal(owners[3], 'pair');
  assert.equal(owners[4], 'pair', 'a fork that starts has finished nothing');
  assert.equal(owners[5], 'fork', 'the fork has a finish of its own');
});

test('a fork cut short ends under its own key', () => {
  const owners = ownersOf([
    [finishSignal(true, false, 2), 'pair'],   // the pair finished
    [finishSignal(true, false, 2), 'fork'],   // a fork starts
    [finishSignal(true, true, 2), 'fork'],    // and is cut short before its result
  ]);
  assert.deepEqual(owners, ['pair', 'pair', 'fork']);
});

test('a run that is still open holds no finish, whatever results it has', () => {
  assert.equal(finishSignal(false, false, 0), finishSignal(false, false, 2));
  assert.notEqual(finishSignal(true, false, 2), finishSignal(false, false, 2));
});

test('a verdict stays with the run it judged when a fork brings its key', () => {
  const verdict = { mode: 'pair', winner: 'B', winnerName: 'Priya Kapoor', headline: 'Priya ships a cleaner model' };
  const owners = ownersOf<Record<string, unknown> | null>([
    [null, 'pair'],
    [verdict, 'pair'],    // the pair's verdict arrives
    [verdict, 'fork'],    // a fork starts: the page keeps the pair's verdict
  ]);
  assert.deepEqual(owners.slice(1), ['pair', 'pair']);
});

test('the next run owns its verdict, the same words included', () => {
  const words = { mode: 'pair', winner: 'B', winnerName: 'Priya Kapoor', headline: 'Priya ships a cleaner model' };
  const owners = ownersOf<Record<string, unknown> | null>([
    [{ ...words }, 'first'],
    [null, 'second'],         // the second run opens with nothing held
    [{ ...words }, 'second'], // and ends on the same winner and headline
  ]);
  assert.deepEqual(owners, ['first', 'second', 'second']);
});
