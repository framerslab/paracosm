/**
 * Lightweight UI announcement that paracosm now ships a pluggable
 * TraitModel registry. Renders a single info-level notice block above
 * the HEXACO sliders in ActorConfig so dashboard users discover the
 * registry without the full slider generalization (deferred to a
 * follow-up phase that will replace HEXACO sliders with model-aware
 * slider grids).
 *
 * Visual treatment: muted card with a small "NEW" badge, two-line
 * copy, and a link to the ai-agent cookbook entry. Matches the
 * dashboard's existing notice / banner aesthetic.
 *
 * @module paracosm/dashboard/components/settings/TraitModelNotice
 */
import styles from './TraitModelNotice.module.scss';

export function TraitModelNotice() {
  return (
    <div className={styles.notice} role="note" aria-label="Pluggable trait models">
      <span className={styles.badge} aria-hidden="true">NEW</span>
      <div className={styles.body}>
        <div className={styles.headline}>
          Leaders accept pluggable trait models.
        </div>
        <p className={styles.copy}>
          The dashboard form below configures HEXACO leaders today. The
          API also accepts <code>ai-agent</code> leaders (six axes for
          AI-system decision-makers: exploration, verification-rigor,
          deference, risk-tolerance, transparency,
          instruction-following). Slider generalization for non-HEXACO
          models is queued; in the meantime, supply a{' '}
          <code>traitProfile</code> field via{' '}
          <code>runSimulation(leader, ...)</code> directly.
        </p>
        <div className={styles.links}>
          <a
            href="https://github.com/framersai/paracosm/blob/master/docs/COOKBOOK.md#pluggable-traits-ai-agent-end-to-end"
            target="_blank"
            rel="noopener"
            className={styles.link}
          >
            Captured ai-agent end-to-end run
          </a>
          <a
            href="https://github.com/framersai/paracosm/blob/master/docs/COOKBOOK.md#pluggable-traits-ai-agent-end-to-end"
            target="_blank"
            rel="noopener"
            className={styles.link}
          >
            Trait-model cookbook
          </a>
        </div>
      </div>
    </div>
  );
}
