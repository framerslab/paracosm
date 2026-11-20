import { useEffect } from 'react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import {
  SETTINGS_LABEL_STYLE,
  SETTINGS_SECTION_HEADER_STYLE,
  SETTINGS_RESET_BUTTON_STYLE,
} from '../../settings/shared/settingsStyles';
import styles from './GridSettingsDrawer.module.scss';

/**
 * The Viz settings a visitor can change. Each one is read: dept labels by
 * the HUD, the crosshair by the canvas, alerts by the toast effects and
 * sound by the sound cues. Animation speed, dept rings, family lines, star
 * dust and ghost trails drew layers removed on 20 April 2026 and are gone
 * with them.
 */
export interface GridSettings {
  /**
   * Whether to render the per-dept labeled boxes (e.g. "SCIENCE 1",
   * "ENGINEERING 2") near each cluster's centroid. Off by default
   * because users reported them as visually noisy — "diamond-ish
   * boxes that make no sense" — when a dept only has 1-2 colonists,
   * which is the norm in the demo-capped population of 30. Still
   * available for users who want the spatial-dept readout on top
   * of the colonist glyphs.
   */
  deptLabels: boolean;
  /** Draw crosshair + nearest-colonist hint when cursor is between glyphs. */
  crosshair: boolean;
  /** Enable crash/crisis toast banners. */
  alerts: boolean;
  /** Enable audio cues on birth / death / forge / crisis. */
  sound: boolean;
}

export const DEFAULT_GRID_SETTINGS: GridSettings = {
  deptLabels: false,
  crosshair: true,
  alerts: true,
  sound: false,
};

/**
 * Settings read back from storage, keeping only the keys GridSettings has
 * and only values of their type, over the defaults. A blob saved before a
 * switch was removed keeps the visitor's other choices and drops the rest.
 */
export function storedGridSettings(stored: Record<string, unknown>): GridSettings {
  const out: GridSettings = { ...DEFAULT_GRID_SETTINGS };
  for (const key of Object.keys(DEFAULT_GRID_SETTINGS) as Array<keyof GridSettings>) {
    if (typeof stored[key] === 'boolean') out[key] = stored[key] as boolean;
  }
  return out;
}

interface DrawerProps {
  open: boolean;
  settings: GridSettings;
  onChange: (next: GridSettings) => void;
  onClose: () => void;
}

/** Floating settings drawer anchored near the trigger button. Small
 *  set of tweaks — keeps the UI skimmable, persistence lives at the
 *  SwarmViz level via localStorage. */
export function GridSettingsDrawer({ open, settings, onChange, onClose }: DrawerProps) {
  const rootRef = useFocusTrap<HTMLDivElement>(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = <K extends keyof GridSettings>(key: K, value: GridSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <>
      <div onClick={onClose} className={styles.backdrop} />
      <div
        ref={rootRef}
        role="dialog"
        aria-label="Grid viz settings"
        tabIndex={-1}
        className={styles.drawer}
      >
        <div className={styles.header}>
          <span style={SETTINGS_SECTION_HEADER_STYLE}>Viz Settings</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className={styles.closeBtn}
          >
            ×
          </button>
        </div>

        <Row label="Dept labels">
          <Pill active={settings.deptLabels} onClick={() => toggle('deptLabels', true)} label="on" />
          <Pill active={!settings.deptLabels} onClick={() => toggle('deptLabels', false)} label="off" />
        </Row>

        <Row label="Crosshair">
          <Pill active={settings.crosshair} onClick={() => toggle('crosshair', true)} label="on" />
          <Pill active={!settings.crosshair} onClick={() => toggle('crosshair', false)} label="off" />
        </Row>

        <Row label="Alert toasts">
          <Pill active={settings.alerts} onClick={() => toggle('alerts', true)} label="on" />
          <Pill active={!settings.alerts} onClick={() => toggle('alerts', false)} label="off" />
        </Row>

        <Row label="Sound cues">
          <Pill active={settings.sound} onClick={() => toggle('sound', true)} label="on" />
          <Pill active={!settings.sound} onClick={() => toggle('sound', false)} label="off" />
        </Row>

        <button
          type="button"
          onClick={() => onChange(DEFAULT_GRID_SETTINGS)}
          style={SETTINGS_RESET_BUTTON_STYLE}
          className={styles.resetBtn}
        >
          Reset defaults
        </button>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <span style={SETTINGS_LABEL_STYLE} className={styles.rowLabel}>{label}</span>
      <div className={styles.pillRow}>{children}</div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[styles.pill, active ? styles.pillActive : ''].filter(Boolean).join(' ')}
    >
      {label}
    </button>
  );
}
