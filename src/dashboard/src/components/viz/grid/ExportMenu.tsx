import { useEffect, useRef, useState } from 'react';
import styles from './ExportMenu.module.scss';

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
 */
export function ExportMenu({
  recording,
  onExportPng,
  onExportJson,
  onToggleRecording,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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
      {open && (
        <div role="menu" className={styles.menu}>
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
        </div>
      )}
    </div>
  );
}
