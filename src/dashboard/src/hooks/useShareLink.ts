/**
 * Copies a run's share link and keeps what the person needs to see:
 * the link itself and what became of the copy.
 *
 * The link is held from the press, so it shows even when the copy does
 * not happen: the browser can refuse the clipboard (no permission, an
 * insecure page, a document out of focus), and a browser waiting on a
 * permission answer may never settle the write at all. A write that has
 * not answered after {@link COPY_ANSWER_MS} counts as not copied; if it
 * answers later, the later answer wins.
 *
 * @module paracosm/cli/dashboard/hooks/useShareLink
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** What became of the copy. */
export type ShareCopyState = 'copying' | 'copied' | 'refused' | 'unanswered';

/** The note's content: the link the press made and what became of its copy. */
export interface SharedLink {
  /** The link, shown in the note's field whatever became of the copy. */
  url: string;
  /** What became of the copy. */
  state: ShareCopyState;
}

/** How long a clipboard write may take before the note says the link was not copied. */
export const COPY_ANSWER_MS = 3000;

/**
 * The state behind a share note.
 *
 * - `share(url)` holds the link at once and starts the copy; the note
 *   moves from `copying` to `copied` or `refused`, or to `unanswered`
 *   after {@link COPY_ANSWER_MS} with no answer.
 * - `clear()` removes the note; an answer to a copy made before it is
 *   ignored.
 * - `shared` is `null` while no note is shown.
 */
export function useShareLink(): {
  shared: SharedLink | null;
  share: (url: string) => void;
  clear: () => void;
} {
  const [shared, setShared] = useState<SharedLink | null>(null);
  // Each press gets its own number, so an answer to an earlier press
  // never changes the note of a later one.
  const pressRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const stopTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => stopTimer, []);

  const share = useCallback((url: string) => {
    const press = ++pressRef.current;
    stopTimer();
    const settle = (state: ShareCopyState) => {
      if (pressRef.current !== press) return;
      if (state !== 'unanswered') stopTimer();
      setShared({ url, state });
    };
    setShared({ url, state: 'copying' });
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      settle('refused');
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setShared(prev => (pressRef.current === press && prev?.state === 'copying' ? { url, state: 'unanswered' } : prev));
    }, COPY_ANSWER_MS);
    let write: Promise<void>;
    try {
      write = clipboard.writeText(url);
    } catch {
      settle('refused');
      return;
    }
    write.then(() => settle('copied'), () => settle('refused'));
  }, []);

  const clear = useCallback(() => {
    pressRef.current += 1;
    stopTimer();
    setShared(null);
  }, []);

  return { shared, share, clear };
}
