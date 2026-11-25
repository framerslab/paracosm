import { useLayoutEffect, useRef } from 'react';

/** Whether the server supplied the consent bar for this page. */
export function hasConsentBar(): boolean {
  return typeof document !== 'undefined' && document.getElementById('paracosm-consent-config') !== null;
}

/** Moves the page's consent control into the foot while it is mounted. */
export function useConsentControl() {
  const slot = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const control = document.getElementById('pcc-reopen');
    const home = control?.parentElement;
    if (!control || !home || !slot.current) return;
    slot.current.appendChild(control);
    return () => { home.appendChild(control); };
  }, []);
  return slot;
}
