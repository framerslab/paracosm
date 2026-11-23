import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Finds the first fold at which the row fits. A row can expose intrinsic
 * widths in inert probes marked data-fit-step. Otherwise it can fold its
 * keys with CSS selectors for data-row-fold on the row.
 */
export function useRowFit(row: RefObject<HTMLElement | null>, steps: number): number {
  const [fold, setFold] = useState(0);

  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const probes = [...element.querySelectorAll<HTMLElement>('[data-fit-step]')];
    const measure = () => {
      const room = element.clientWidth;
      let step = 0;
      while (step < steps) {
        const probe = probes.find(candidate => candidate.dataset.fitStep === String(step));
        element.dataset.rowFold = String(step);
        const width = probe?.getBoundingClientRect().width ?? element.scrollWidth;
        if (width <= room + 1) break;
        step++;
      }
      element.dataset.rowFold = String(step);
      setFold(step);
    };
    const sizes = new ResizeObserver(measure);
    const observe = () => {
      sizes.disconnect();
      sizes.observe(element);
      for (const key of probes.length ? probes : [...element.children]) sizes.observe(key);
    };
    const keys = new MutationObserver(() => {
      observe();
      measure();
    });
    if (!probes.length) keys.observe(element, { childList: true, subtree: true, characterData: true });
    document.fonts?.addEventListener('loadingdone', measure);
    observe();
    measure();
    return () => {
      sizes.disconnect();
      keys.disconnect();
      document.fonts?.removeEventListener('loadingdone', measure);
    };
  }, [row, steps]);

  return fold;
}
