import { useEffect, useRef } from 'react';

/**
 * Traps keyboard focus inside a dialog while it is open. On activation
 * the first focusable descendant receives focus (or the container
 * itself when nothing inside is focusable), Tab cycles within the
 * container, and the previously-focused element is restored when the
 * dialog closes.
 *
 * Usage:
 *   const ref = useFocusTrap<HTMLDivElement>(isOpen);
 *   return <div ref={ref} role="dialog" tabIndex={-1}>…</div>;
 *
 * @param active Whether the trap is currently engaged. Toggle with the
 *   dialog's open state.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    if (!container) return;

    const focusables = (): HTMLElement[] => {
      const nodes = container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      return Array.from(nodes).filter(el => !el.hasAttribute('aria-hidden') && el.offsetParent !== null);
    };

    const first = focusables()[0];
    if (first) first.focus();
    else container.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const idx = items.indexOf(document.activeElement as HTMLElement);
      const lastIdx = items.length - 1;
      if (e.shiftKey) {
        if (idx <= 0) {
          e.preventDefault();
          items[lastIdx].focus();
        }
      } else if (idx === lastIdx || idx === -1) {
        e.preventDefault();
        items[0].focus();
      }
    };

    container.addEventListener('keydown', onKey);
    return () => {
      container.removeEventListener('keydown', onKey);
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
    };
  }, [active]);

  return containerRef;
}
