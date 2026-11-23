/**
 * The page's Analytics choices control (#pcc-reopen in index.html, outside
 * #root, so it is there when the dashboard's script does not load) and the
 * places a footer gives it.
 *
 * The Run tab's foot and the other tabs' footer each hold a slot. The Run
 * tab stays mounted while another tab shows, so both slots can be mounted at
 * once: the control stands in the one mounted last, and goes back to the one
 * before it, or to its place outside #root, when that one leaves.
 *
 * @module paracosm/dashboard/layout/consentControl
 */
import { useEffect, useRef } from 'react';

/** The mounted slots, oldest first. */
const slots: HTMLElement[] = [];

/**
 * The control, kept once it is found. A slot that leaves the page takes the
 * control out of the document with it, and an effect's cleanup runs after
 * that, when a lookup by id no longer finds it.
 */
let kept: HTMLElement | null = null;

/** Puts the control in the newest slot, or back in its own place. */
function placeControl(): void {
  kept = document.getElementById('pcc-reopen') ?? kept;
  const control = kept;
  const home = document.getElementById('pcc-shell');
  const target = slots[slots.length - 1] ?? home;
  if (control && target && control.parentElement !== target) target.appendChild(control);
}

/**
 * Whether the server gave this page the consent bar (the hosted demo, in
 * src/server/site-analytics.ts). Its script opens the choices from any
 * element marked data-consent-open, so a footer offers the control only
 * where the bar exists.
 */
export function hasConsentBar(): boolean {
  return typeof document !== 'undefined' && document.getElementById('paracosm-consent-config') !== null;
}

/** A slot for the control: a ref for the element that holds it while mounted. */
export function useConsentControl() {
  const slot = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = slot.current;
    if (!el) return undefined;
    slots.push(el);
    placeControl();
    return () => {
      const at = slots.lastIndexOf(el);
      if (at >= 0) slots.splice(at, 1);
      placeControl();
    };
  }, []);
  return slot;
}
