import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import styles from './ExportMenu.module.scss';

/** The menu's least width (ExportMenu.module.scss), its least gap to the window's edge, and its gap to its key. */
const MENU_WIDTH = 180;
const EDGE = 8;
const GAP = 4;

/** Where the menu stands while it is measured, before its first placing. */
const UNPLACED: CSSProperties = { top: 0, left: 0, visibility: 'hidden' };

/** Every control Tab reaches, for handing focus on from the menu. */
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Whether the middle of a key stands inside the window and inside every box
 * around it that clips what overflows it: a row that scrolls sideways can
 * carry its key out of view while the key stays on the page.
 */
function inView(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  for (let box = el.parentElement; box && box !== document.body; box = box.parentElement) {
    const style = getComputedStyle(box);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const b = box.getBoundingClientRect();
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) return false;
  }
  return true;
}

interface ExportMenuProps {
  recording: boolean;
  onExportPng: () => void;
  onExportJson: () => void;
  onToggleRecording: () => void;
}

/**
 * Collapsed export toolbar — single button opens a small menu with
 * PNG / REC / JSON. Replaces three separate toolbar buttons so the
 * top row stays readable on narrow screens. Recording state still
 * shows as a pulsing indicator on the trigger button.
 *
 * The menu is drawn on the page's body, fixed by its key, so a row of keys
 * that scrolls sideways or fades at its edge neither clips nor fades it. It
 * stands under its key, or above it when it does not fit under it and there
 * is more room above, and is never taller than its room. It follows its key
 * while the page or the row scrolls, and closes once the key is out of view.
 *
 * Opened, it holds focus on its first action. The arrow keys, Home and End
 * move through its actions; Escape and Shift+Tab close it and give focus back
 * to its key; Tab closes it and goes on to the control after its key.
 */
export function ExportMenu({
  recording,
  onExportPng,
  onExportJson,
  onToggleRecording,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Focus goes into the menu once each time it opens, after it is placed.
  const focusOnOpen = useRef(false);

  const actions = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  /** Closes the menu; with `refocus`, focus goes back to the Export key. */
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const placeMenu = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      if (!inView(trigger)) {
        setOpen(false);
        return;
      }
      const key = trigger.getBoundingClientRect();
      const below = window.innerHeight - key.bottom - GAP - EDGE;
      const above = key.top - GAP - EDGE;
      const needed = menuRef.current?.scrollHeight ?? 0;
      const up = needed > below && above > below;
      setPlace({
        ...(up
          ? { bottom: window.innerHeight - key.top + GAP, maxHeight: Math.max(0, above) }
          : { top: key.bottom + GAP, maxHeight: Math.max(0, below) }),
        // Its right edge on the key's; from the key's left when the key
        // stands too near the window's left edge for the menu's width.
        ...(key.right >= MENU_WIDTH + EDGE
          ? { right: Math.max(EDGE, window.innerWidth - key.right) }
          : { left: Math.max(EDGE, key.left) }),
      });
    };
    placeMenu();
    window.addEventListener('resize', placeMenu);
    document.addEventListener('scroll', placeMenu, true);
    return () => {
      window.removeEventListener('resize', placeMenu);
      document.removeEventListener('scroll', placeMenu, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !place || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = actions();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
      list[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const trigger = triggerRef.current;
      close(true);
      if (!e.shiftKey && trigger) {
        // On to the control after the Export key, as Tab goes from the key.
        const reachable = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE))
          .filter(el => !menuRef.current?.contains(el) && el.getClientRects().length > 0);
        reachable[reachable.indexOf(trigger) + 1]?.focus();
      }
    }
  };

  /** Runs one action: the menu closes and focus goes back to the Export key. */
  const run = (action: () => void) => () => {
    close(true);
    action();
  };

  return (
    <div ref={rootRef} className={styles.anchor}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!open) focusOnOpen.current = true;
          setOpen(v => !v);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Export options"
        title={recording ? 'Recording in progress — click for options' : 'Export options'}
        className={[styles.trigger, open ? styles.triggerOpen : ''].filter(Boolean).join(' ')}
      >
        {recording && <span aria-hidden="true" className={styles.recDot} />}
        EXPORT ▼
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" className={styles.menu} style={place ?? UNPLACED} onKeyDown={onMenuKey}>
          <button
            type="button"
            role="menuitem"
            onClick={run(onExportPng)}
            className={styles.item}
          >
            <span className={styles.itemKey}>PNG</span>
            <span className={styles.itemDesc}>Current frame</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(onToggleRecording)}
            className={[styles.item, recording ? styles.itemRecording : ''].filter(Boolean).join(' ')}
          >
            <span className={[styles.itemKey, recording ? styles.itemKeyRecording : ''].filter(Boolean).join(' ')}>
              {recording ? 'STOP' : 'REC'}
            </span>
            <span className={styles.itemDesc}>
              {recording ? 'End recording & download' : 'Timelapse to webm'}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(onExportJson)}
            className={styles.item}
          >
            <span className={styles.itemKey}>JSON</span>
            <span className={styles.itemDesc}>Replay snapshot</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
