/**
 * The run's setup that the page's address holds, so a reload or a shared
 * link opens the same run: its size, in ?size=. A size the address cannot
 * hold (out of range, or not a whole number) reads as a pair, with no error.
 *
 * @module paracosm/dashboard/quickstart/first-screen/useRunSetup
 */
import { useCallback, useEffect, useState } from 'react';
import { FREE_SIZE, RUN_SIZE_BOUNDS, searchWithSize, sizeFromSearch, stepSize } from './runSize.helpers';

const readSize = (): number => (typeof window === 'undefined' ? FREE_SIZE : sizeFromSearch(window.location.search));

export function useRunSetup(): { size: number; setSize(n: number): void } {
  const [size, setSizeState] = useState(readSize);

  const setSize = useCallback((n: number) => {
    const next = stepSize(Math.round(n), 0, RUN_SIZE_BOUNDS);
    setSizeState(next);
    try {
      const url = new URL(window.location.href);
      url.search = searchWithSize(url.search, next);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      // An address that cannot be written keeps the size in the page.
    }
  }, []);

  // The browser's back and forward keys may bring another address.
  useEffect(() => {
    const onPop = () => setSizeState(readSize());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return { size, setSize };
}
