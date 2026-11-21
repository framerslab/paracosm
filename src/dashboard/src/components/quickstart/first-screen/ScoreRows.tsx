/**
 * A leader's six scores, each a bar with its figure to two places, in one
 * order everywhere: Openness, Conscientiousness, Extraversion,
 * Agreeableness, Emotionality, Honesty-humility.
 *
 * A bar's two ticks mark the middle band, 0.35 to 0.65. A score outside the
 * band fills in the accent; one inside it or on its edge fills in the
 * control edge. A leader with no score for a trait keeps the empty track.
 *
 * @module paracosm/dashboard/quickstart/first-screen/ScoreRows
 */
import type { CSSProperties } from 'react';
import { TRAIT_NAMES } from './words';
import styles from './ScoreRows.module.scss';

/** One of the six scores a leader carries. */
export type HexacoTrait = keyof typeof TRAIT_NAMES;

/** The six scores in the order every block draws them. */
export const TRAIT_ORDER: readonly HexacoTrait[] = [
  'openness',
  'conscientiousness',
  'extraversion',
  'agreeableness',
  'emotionality',
  'honestyHumility',
];

/**
 * A score's name as it is drawn: the longest name carries a soft hyphen,
 * which shows only where the name wraps in a narrow column, so the name
 * never sets a column wider than a 320 px window holds and never breaks
 * without a hyphen.
 */
export function traitShown(trait: HexacoTrait): string {
  return trait === 'conscientiousness' ? 'Conscien\u00adtiousness' : TRAIT_NAMES[trait];
}

/** The middle band's two edges, where a bar's ticks stand. */
export const MIDDLE_BAND_EDGES = { low: 0.35, high: 0.65 } as const;

/** True for a score outside the middle band; a score on either edge is inside it. */
export function isOutsideMiddleBand(v: number): boolean {
  return v < MIDDLE_BAND_EDGES.low || v > MIDDLE_BAND_EDGES.high;
}

/** A score to two places: "0.95", "0.30". */
export function scoreFigure(v: number): string {
  return v.toFixed(2);
}

/**
 * A leader's scores as the scenario holds them: each trait that is a number
 * from 0 to 1. Null when the record holds none of the six.
 */
export function readScores(hexaco: Record<string, number> | undefined | null): Partial<Record<HexacoTrait, number>> | null {
  if (!hexaco) return null;
  const out: Partial<Record<HexacoTrait, number>> = {};
  for (const trait of TRAIT_ORDER) {
    const v = hexaco[trait];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) out[trait] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** One score's bar: the track, the fill up to the score, and the two ticks of the middle band. Drawn for the eye; the figure beside it says the same. */
export function ScoreBar({ score, short }: { score?: number; short?: boolean }) {
  return (
    <span className={[styles.track, short ? styles.short : ''].filter(Boolean).join(' ')} data-score-track aria-hidden="true">
      {score !== undefined && (
        <span
          className={styles.fill}
          data-meter-fill
          data-outside={isOutsideMiddleBand(score) ? 'true' : 'false'}
          style={{ '--score': String(Math.round(score * 1000) / 10) } as CSSProperties}
        />
      )}
      <span className={`${styles.tick} ${styles.tickLow}`} data-band-tick />
      <span className={`${styles.tick} ${styles.tickHigh}`} data-band-tick />
    </span>
  );
}

export interface ScoreRowsProps {
  /** The leader's six scores, or null for a leader not written yet: six empty tracks. */
  scores: Partial<Record<HexacoTrait, number>> | null;
  /** The list's spoken name. */
  label: string;
  /** From the wide width, each bar stands under its score's name and figure, for a narrow column. */
  stackWide?: boolean;
}

/** The six scores as a list: each item reads as "Openness, 0.95". */
export function ScoreRows({ scores, label, stackWide }: ScoreRowsProps) {
  return (
    <ul className={styles.rows} aria-label={label} data-testid="score-rows" data-stack-wide={stackWide ? 'true' : undefined}>
      {TRAIT_ORDER.map((trait) => {
        const score = scores?.[trait];
        return (
          <li key={trait} className={styles.row} data-score={trait}>
            <span className={styles.name} data-testid="score-name">{traitShown(trait)}</span>
            {score !== undefined && <span className="sr-only">, </span>}
            <ScoreBar score={score} />
            {score !== undefined && <span className={styles.figure} data-testid="score-figure">{scoreFigure(score)}</span>}
          </li>
        );
      })}
    </ul>
  );
}
