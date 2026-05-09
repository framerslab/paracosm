/**
 * Per-turn quantile-band chart for an N-actor SIM run. Replaces the
 * pairwise A-vs-B story (DivergenceRail / TurnGrid) with a "where
 * does the variance live across actors over time" story. Shows
 * min-max envelope, IQR (Q1-Q3), and median line for each turn.
 *
 * Pure SVG, no D3. Renders inline below the constellation when the
 * run has 3+ actors and at least one turn of recorded history.
 *
 * @module paracosm/dashboard/sim/DistributionPanel
 */
import * as React from 'react';
import { useMemo } from 'react';
import type { GameState } from '../../hooks/useGameState';
import {
  projectQuantileBands,
  bandRange,
  normalizeBand,
  popSeries,
  moraleSeries,
  type SeriesPicker,
  type QuantileBand,
} from './distribution.helpers';
import styles from './DistributionPanel.module.scss';

void React;

interface SeriesDef {
  id: 'morale' | 'population';
  label: string;
  unitSuffix: string;
  pick: SeriesPicker;
  /** Override the y-axis lo/hi so single-domain series (morale 0-100)
   *  render against a stable scale instead of recomputed-each-turn. */
  fixedRange?: { lo: number; hi: number };
}

const SERIES: SeriesDef[] = [
  // morale histories are recorded as 0-100 ints in useGameState
  // (see line 406 of hooks/useGameState.ts), so pin the range to
  // [0, 100] for visual stability across turns.
  { id: 'morale',     label: 'Morale',     unitSuffix: '%', pick: moraleSeries, fixedRange: { lo: 0, hi: 100 } },
  { id: 'population', label: 'Population', unitSuffix: '',  pick: popSeries },
];

const CHART_W = 360;
const CHART_H = 90;
const PAD_X = 8;
const PAD_Y = 6;

interface ChartProps {
  bands: QuantileBand[];
  fixedRange?: { lo: number; hi: number };
  unitSuffix: string;
}

function QuantileChart({ bands, fixedRange, unitSuffix }: ChartProps): JSX.Element {
  if (bands.length === 0) {
    return (
      <div className={styles.empty} role="status">
        No turns recorded yet.
      </div>
    );
  }
  const range = fixedRange ?? bandRange(bands);
  const normalized = bands.map(b => normalizeBand(b, range.lo, range.hi));
  const innerW = CHART_W - 2 * PAD_X;
  const innerH = CHART_H - 2 * PAD_Y;

  const xFor = (i: number): number => {
    if (bands.length === 1) return PAD_X + innerW / 2;
    return PAD_X + (i / (bands.length - 1)) * innerW;
  };
  // Invert y so higher values render at the TOP of the chart. (SVG y
  // grows downward; values grow upward.)
  const yFor = (frac: number): number => PAD_Y + (1 - frac) * innerH;

  // Min-max envelope path (filled, faint) — closed polygon top→bottom.
  const envelopeTop = normalized.map((b, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(b.max)}`).join(' ');
  const envelopeBot = [...normalized].reverse()
    .map((b) => {
      const idx = normalized.indexOf(b);
      return `L ${xFor(idx)} ${yFor(b.min)}`;
    })
    .join(' ');
  const envelope = `${envelopeTop} ${envelopeBot} Z`;

  // IQR band (Q1-Q3, slightly more saturated)
  const iqrTop = normalized.map((b, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(b.q3)}`).join(' ');
  const iqrBot = [...normalized].reverse()
    .map((b) => {
      const idx = normalized.indexOf(b);
      return `L ${xFor(idx)} ${yFor(b.q1)}`;
    })
    .join(' ');
  const iqr = `${iqrTop} ${iqrBot} Z`;

  // Median line
  const median = normalized.map((b, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(b.median)}`).join(' ');

  const lastBand = bands[bands.length - 1];
  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      width={CHART_W}
      height={CHART_H}
      role="img"
      aria-label={`Quantile distribution across turns. Latest turn ${lastBand.turn}: median ${lastBand.median.toFixed(0)}${unitSuffix}, range ${lastBand.min.toFixed(0)}-${lastBand.max.toFixed(0)}${unitSuffix} across ${lastBand.n} actor${lastBand.n === 1 ? '' : 's'}.`}
    >
      <path className={styles.envelope} d={envelope} />
      <path className={styles.iqr} d={iqr} />
      <path className={styles.median} d={median} />
    </svg>
  );
}

export interface DistributionPanelProps {
  state: GameState;
}

export function DistributionPanel({ state }: DistributionPanelProps): JSX.Element | null {
  // Pre-project once per render; cheap (O(N × turns)) and stable.
  const projected = useMemo(() => {
    return SERIES.map(s => ({
      def: s,
      bands: projectQuantileBands(state, s.pick),
    }));
  }, [state]);

  // Hide the panel if there's no data yet — cleaner empty state than
  // showing two empty charts.
  const haveAny = projected.some(p => p.bands.length > 0);
  if (!haveAny) return null;

  return (
    <div className={styles.panel} aria-label="Distribution across actors">
      <div className={styles.heading}>
        <span className={styles.headingLabel}>DISTRIBUTION</span>
        <span className={styles.headingHint}>median · IQR · min-max envelope</span>
      </div>
      <div className={styles.charts}>
        {projected.map(({ def, bands }) => {
          const last = bands[bands.length - 1];
          return (
            <div key={def.id} className={styles.chartWrap}>
              <div className={styles.chartHeader}>
                <span className={styles.chartTitle}>{def.label}</span>
                {last && (
                  <span className={styles.chartLatest}>
                    T{last.turn} · median {Math.round(last.median)}{def.unitSuffix} · {last.min.toFixed(0)}-{last.max.toFixed(0)}{def.unitSuffix} · n={last.n}
                  </span>
                )}
              </div>
              <QuantileChart bands={bands} fixedRange={def.fixedRange} unitSuffix={def.unitSuffix} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
