import { useEffect, useState } from 'react';

/**
 * Reactive matchMedia hook. Safe for SSR (returns the initial fallback
 * on first render, then syncs on mount). Used to drive responsive
 * layout decisions in the living-colony grid — swap between side-by-
 * side and stacked leaders, collapse the metrics strip, shrink popover.
 */
export function useMediaQuery(query: string, initial = false): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return initial;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** Breakpoints used across the grid viz. Kept in one place so layers
 *  stay in sync about what "narrow" means. */
export const NARROW_QUERY = '(max-width: 768px)';
export const PHONE_QUERY = '(max-width: 480px)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
