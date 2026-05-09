import type { CSSProperties } from 'react';
import { useMediaQuery, PHONE_QUERY } from './useMediaQuery.js';
import { useScenarioLabels } from '../../../hooks/useScenarioLabels.js';
import styles from './GridHelpOverlay.module.scss';

interface GridHelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Legend + keyboard shortcuts modal. Opens via `?`. Explains what the
 * colors/flares/rings mean so a first-time viewer isn't staring at
 * unlabeled blobs. Dismisses via Esc or backdrop click.
 */
export function GridHelpOverlay({ open, onClose }: GridHelpOverlayProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const labels = useScenarioLabels();
  if (!open) return null;

  const dialogCls = [styles.dialog, phone ? styles.phone : ''].filter(Boolean).join(' ');

  return (
    <div role="dialog" aria-modal="true" aria-label="Grid viz help" onClick={onClose} className={styles.backdrop}>
      <div onClick={e => e.stopPropagation()} className={dialogCls}>
        <div className={styles.header}>
          <h2 className={styles.title}>Living {labels.Place} Grid — Legend</h2>
          <button type="button" onClick={onClose} aria-label="Close help" className={styles.closeBtn}>
            ×
          </button>
        </div>

        <Section title="Modes">
          <Row k="LIVING" v={`Full chemistry + ${labels.person} glyphs + family lines + event flares`} />
          <Row k="MOOD" v={`Emphasizes ${labels.person} seeds + mood-coded chemistry clouds`} />
          <Row k="FORGE" v="Dims field, highlights forge attempts + reuse arcs" />
          <Row k="ECOLOGY" v="Hides glyphs; metrics strip + crisis flares lead" />
          <Row k="DIVERGENCE" v={`Only shows ${labels.people} alive here but dead on the other side`} />
        </Section>

        <Section title="Grid elements">
          <Row k={<Swatch color="rgba(232, 180, 74, 0.9)" />} v={`Warm amber = high vitality (${labels.place} thriving)`} />
          <Row k={<Swatch color="rgba(196, 74, 30, 0.9)" />} v="Rust red = stress concentration (decay / anxiety)" />
          <Row k="○ small ring" v={`Alive ${labels.person}, hover for identity`} />
          <Row k="◎ thick ring" v={`Featured ${labels.person} (drives narrative this turn)`} />
          <Row k="○ amber halo" v={`Diverged ${labels.person} — alive here but dead on the other side`} />
          <Row k="DEPT label" v="Cluster centroid label showing dept + live count" />
        </Section>

        <Section title="Event flares">
          <Row k={<Swatch color="rgba(154, 205, 96, 0.8)" />} v="Green bloom — birth" />
          <Row k={<Swatch color="rgba(168, 152, 120, 0.7)" />} v="Grey wave — death" />
          <Row k={<Swatch color="rgba(232, 180, 74, 0.8)" />} v="Amber dot — forge approved" />
          <Row k={<Swatch color="rgba(224, 101, 48, 0.7)" />} v="Red flash — forge rejected" />
          <Row k={<Swatch color="rgba(232, 180, 74, 0.6)" />} v="Amber arc — tool reuse across departments" />
          <Row k={<Swatch color="rgba(196, 74, 30, 0.8)" />} v="Red ring — crisis shockwave (category-gated)" />
        </Section>

        <Section title="Family lines">
          <Row k="— side color, bowed" v="Partner link" />
          <Row k="– teal, dashed" v="Parent → child link" />
        </Section>

        <Section title="Keyboard">
          <Row k="1 / 2 / 3 / 4 / 5" v="Switch mode (Living / Mood / Forge / Ecology / Divergence)" />
          <Row k="← / →" v="Step turn back / forward" />
          <Row k="Space" v="Play / pause timeline" />
          <Row k="?" v="Toggle this help overlay" />
          <Row k="Esc" v="Close popover / this overlay" />
          <Row k="click glyph" v={`Open ${labels.person} drilldown (HEXACO radar, memory, chat)`} />
        </Section>

        <div className={styles.footer}>
          Press <kbd className={styles.kbd}>?</kbd> anytime to reopen.
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{title}</div>
      <div className={styles.rows}>{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowKey}>{k}</span>
      <span className={styles.rowVal}>{v}</span>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span className={styles.swatchWrap}>
      <span
        className={styles.swatch}
        style={{ '--swatch-color': color } as CSSProperties}
      />
    </span>
  );
}
