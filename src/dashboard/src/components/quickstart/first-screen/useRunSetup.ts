/**
 * The run's setup that the page's address holds, so a reload or a shared
 * link opens the same run: its size, in ?size=. A size the address cannot
 * hold (out of range, or not a whole number) reads as a pair, with no error.
 *
 * @module paracosm/dashboard/quickstart/first-screen/useRunSetup
 */
import { useCallback, useEffect, useState } from 'react';
import { searchWithSize, sizeFromSearch, stepSize, type SizeBounds } from './runSize.helpers';

const readSearch = (): string => typeof window === 'undefined' ? '' : window.location.search;

/** Resolve the same address again whenever the server supplies new bounds. */
export function useRunSetup({ min, max }: SizeBounds): { size: number; setSize(n: number): void } {
  const [search, setSearch] = useState(readSearch);

  const setSize = useCallback((n: number) => {
    const next = stepSize(Math.round(n), 0, { min, max });
    const nextSearch = searchWithSize(readSearch(), next, min);
    setSearch(nextSearch);
    try {
      const url = new URL(window.location.href);
      url.search = nextSearch;
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      // An address that cannot be written keeps the size in the page.
    }
  }, [min, max]);

  useEffect(() => {
    const onPop = () => setSearch(readSearch());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return { size: sizeFromSearch(search, { min, max }, min), setSize };
}
