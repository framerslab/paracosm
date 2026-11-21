import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import styles from './ExportMenu.module.scss';

/** The menu's least width (ExportMenu.module.scss), and its least gap to the window's edge. */
const MENU_WIDTH = 180;
const EDGE = 8;

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
 * The menu is drawn on the page's body, fixed under its key, so a row of
 * keys that scrolls sideways or fades at its edge neither clips nor fades it.
 * It follows its key while the page or the row scrolls.
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

  // Under the key, its right edge on the key's; from the key's left when the
  // key stands too near the window's left edge for the menu's width.
  useEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const placeMenu = () => {
      const key = triggerRef.current?.getBoundingClientRect();
      if (!key) return;
      setPlace(key.right >= MENU_WIDTH + EDGE
        ? { top: key.bottom + 4, right: Math.max(EDGE, window.innerWidth - key.right) }
        : { top: key.bottom + 4, left: Math.max(EDGE, key.left) });
    };
    placeMenu();
    window.addEventListener('resize', placeMenu);
    document.addEventListener('scroll', placeMenu, true);
    return () => {
      window.removeEventListener('resize', placeMenu);
      document.removeEventListener('scroll', placeMenu, true);
    };
  }, [open]);

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

  return (
    <div ref={rootRef} className={styles.anchor}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Export options"
        title={recording ? 'Recording in progress — click for options' : 'Export options'}
        className={[styles.trigger, open ? styles.triggerOpen : ''].filter(Boolean).join(' ')}
      >
        {recording && <span aria-hidden="true" className={styles.recDot} />}
        EXPORT ▼
      </button>
      {open && place && createPortal(
        <div ref={menuRef} role="menu" className={styles.menu} style={place}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onExportPng();
            }}
            className={styles.item}
          >
            <span className={styles.itemKey}>PNG</span>
            <span className={styles.itemDesc}>Current frame</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onToggleRecording();
            }}
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
            onClick={() => {
              setOpen(false);
              onExportJson();
            }}
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
