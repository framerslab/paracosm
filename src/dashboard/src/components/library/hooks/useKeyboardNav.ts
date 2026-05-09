import * as React from 'react';

export function useKeyboardNav(opts: {
  enabled: boolean;
  cardSelector: string;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onOpenFocused: (cardEl: HTMLElement) => void;
  onClose: () => void;
}): void {
  const { enabled, cardSelector, searchInputRef, onOpenFocused, onClose } = opts;

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inputlike = !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));

      if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && !inputlike) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (inputlike) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        focusNext(cardSelector, +1);
        return;
      }

      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        focusNext(cardSelector, -1);
        return;
      }

      if (e.key === 'Enter') {
        const focused = document.activeElement as HTMLElement | null;
        if (focused && focused.matches(cardSelector)) {
          e.preventDefault();
          onOpenFocused(focused);
        }
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, cardSelector, searchInputRef, onOpenFocused, onClose]);
}

function focusNext(selector: string, delta: -1 | 1): void {
  const cards = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  if (cards.length === 0) return;
  const current = document.activeElement as HTMLElement | null;
  const idx = current ? cards.indexOf(current) : -1;
  const next = cards[(idx + delta + cards.length) % cards.length] ?? cards[0];
  next.focus();
}
