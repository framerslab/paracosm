import { useEffect } from 'react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import {
  SETTINGS_LABEL_STYLE,
  SETTINGS_SECTION_HEADER_STYLE,
  SETTINGS_RESET_BUTTON_STYLE,
} from '../../settings/shared/settingsStyles';
import styles from './GridSettingsDrawer.module.scss';

export interface GridSettings {
  /** RD animation speed multiplier applied to stepsPerFrame. */
  animSpeed: 0.5 | 1 | 2;
  /** Whether to render the dept cluster ring outlines. */
  deptRings: boolean;
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
  /** Whether to render partner/child connection arcs (when mode allows). */
  lines: boolean;
  /** Background star-dust pattern in empty field areas. */
  dust: boolean;
  /** Draw crosshair + nearest-colonist hint when cursor is between glyphs. */
  crosshair: boolean;
  /** Draw faded previous-turn positions with movement arrows. */
  ghostTrail: boolean;
  /** Enable crash/crisis toast banners. */
  alerts: boolean;
  /** Enable audio cues on birth / death / forge / crisis. */
  sound: boolean;
}

export const DEFAULT_GRID_SETTINGS: GridSettings = {
  animSpeed: 1,
  // Dept rings default OFF. Dashed arcs at large radii (small colonies
  // give large centroid-to-edge distances) tile together into saw-tooth
  // diagonals that users read as render artifacts. Same rationale as
  // `lines` and `ghostTrail` below: opt-in, not default.
  deptRings: false,
  deptLabels: false,
  // Family lines default OFF. When on, partner arcs (curved) and
  // parent-child lines (dashed) draw between every related colonist
  // on the grid — with 14-30 colonists that's ~15-40 crossing
  // diagonals. Users consistently reported the network of arcs as
  // "weird diamond animations" that appeared on tab open. Keep the
  // setting so users who want to see the relationship graph can
  // enable it from the drawer, but don't fire it by default.
  lines: false,
  dust: true,
  crosshair: true,
  ghostTrail: false,
  alerts: true,
  sound: false,
};

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

        <Row label="Animation speed">
          {([0.5, 1, 2] as const).map(sp => (
            <Pill
              key={sp}
              active={settings.animSpeed === sp}
              onClick={() => toggle('animSpeed', sp)}
              label={`${sp}x`}
            />
          ))}
        </Row>

        <Row label="Dept rings">
          <Pill active={settings.deptRings} onClick={() => toggle('deptRings', true)} label="on" />
          <Pill active={!settings.deptRings} onClick={() => toggle('deptRings', false)} label="off" />
        </Row>

        <Row label="Dept labels">
          <Pill active={settings.deptLabels} onClick={() => toggle('deptLabels', true)} label="on" />
          <Pill active={!settings.deptLabels} onClick={() => toggle('deptLabels', false)} label="off" />
        </Row>

        <Row label="Family lines">
          <Pill active={settings.lines} onClick={() => toggle('lines', true)} label="on" />
          <Pill active={!settings.lines} onClick={() => toggle('lines', false)} label="off" />
        </Row>

        <Row label="Star dust bg">
          <Pill active={settings.dust} onClick={() => toggle('dust', true)} label="on" />
          <Pill active={!settings.dust} onClick={() => toggle('dust', false)} label="off" />
        </Row>

        <Row label="Crosshair">
          <Pill active={settings.crosshair} onClick={() => toggle('crosshair', true)} label="on" />
          <Pill active={!settings.crosshair} onClick={() => toggle('crosshair', false)} label="off" />
        </Row>

        <Row label="Ghost trail">
          <Pill active={settings.ghostTrail} onClick={() => toggle('ghostTrail', true)} label="on" />
          <Pill active={!settings.ghostTrail} onClick={() => toggle('ghostTrail', false)} label="off" />
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
