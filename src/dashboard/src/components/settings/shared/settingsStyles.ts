import type { CSSProperties } from 'react';

/**
 * Uppercase monospace label applied above every form control across
 * the settings surfaces. One source of truth so future panels don't
 * invent their own 11px/12px/13px variants. Font size is a compromise
 * between the SettingsPanel tab (previously 12px) and the compact
 * GridSettingsDrawer (previously 9px).
 */
export const SETTINGS_LABEL_STYLE: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--mono)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
  marginBottom: 4,
};

/**
 * Section header — larger than a label, functions as a visual chunk
 * break. Used inside <legend> elements in fieldset groups and on
 * standalone header divs in drawers.
 */
export const SETTINGS_SECTION_HEADER_STYLE: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-2)',
};

/**
 * Small-print description placed under a section header or between a
 * label and its control. Subdued so it reads as meta rather than
 * content.
 */
export const SETTINGS_DESCRIPTION_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-3)',
  lineHeight: 1.6,
};

/**
 * Reset-to-defaults button. Full-width, muted, monospace — matches
 * the GridSettingsDrawer reset affordance and available for any
 * future panel with a reset.
 */
export const SETTINGS_RESET_BUTTON_STYLE: CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--bg-card)',
  color: 'var(--text-3)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  cursor: 'pointer',
  fontFamily: 'var(--mono)',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};
