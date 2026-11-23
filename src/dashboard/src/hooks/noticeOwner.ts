/**
 * Which run a finish notice belongs to.
 *
 * The page records each notice it shows under the key of a run, so a run's
 * finish and its verdict are announced once. That run is the one the page
 * held when the finish, or the verdict, arrived. It is not always the run
 * the page holds now: a fork arrives with a key of its own while the page
 * keeps its parent's finish and verdict, and a key that changes under a
 * state the page already holds announces nothing.
 */

/** A state the page holds and the key of the run it held when that state arrived. */
export interface NoticeOwner<T> {
  state: T;
  runKey: string | null;
}

/**
 * The owner of the state the page holds now. A state the page already held
 * keeps its owner, whatever key the page moved to since. A new state takes
 * the key the page holds.
 */
export function noticeOwner<T>(prev: NoticeOwner<T> | null, state: T, heldRunKey: string | null): NoticeOwner<T> {
  return prev !== null && Object.is(prev.state, state) ? prev : { state, runKey: heldRunKey };
}

/**
 * What tells one finish from the next: nothing while the run is open, then
 * how the run ended and the count of results the page holds. A fork ends
 * with a result of its own, or cut short, on a page that never left its
 * parent's finish.
 */
export function finishSignal(isComplete: boolean, isAborted: boolean, resultsCount: number): string {
  if (!isComplete && !isAborted) return '';
  return `${isAborted ? 'aborted' : 'complete'}:${resultsCount}`;
}
