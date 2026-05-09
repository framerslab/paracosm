import type { CSSProperties } from 'react';
import type { TurnSnapshot } from '../viz-types.js';
import { useMediaQuery, NARROW_QUERY } from './useMediaQuery.js';
import { DeptDonut } from './DeptDonut.js';
import { VIZ_TOOLTIPS } from '../viz-tooltips';
import styles from './GridMetricsStrip.module.scss';

/**
 * Full colony metrics strip rendered above the living grid. Same
 * morale bar + mood-mix histogram + age distribution + family counts
 * the legacy SwarmPanel exposed — kept as a standalone component so
 * both viz modes render it consistently. Collapses to 2 columns on
 * narrow screens so nothing overflows on phone widths.
 */
export function GridMetricsStrip({
  snapshot,
  sideColor,
}: {
  snapshot: TurnSnapshot;
  sideColor: string;
}) {
  const narrow = useMediaQuery(NARROW_QUERY);
  const alive = snapshot.cells.filter(c => c.alive);
  const moodCounts = alive.reduce<Record<string, number>>((m, c) => {
    const key = c.mood || 'neutral';
    m[key] = (m[key] ?? 0) + 1;
    return m;
  }, {});
  const moodOrder = ['positive', 'hopeful', 'neutral', 'anxious', 'negative', 'defiant', 'resigned'];
  const moodColors: Record<string, string> = {
    positive: 'var(--green)',
    hopeful: '#9acd60',
    neutral: 'var(--text-4)',
    anxious: 'var(--amber)',
    negative: 'var(--rust)',
    defiant: '#c44a1e',
    resigned: 'var(--text-3)',
  };
  const totalMood = alive.length || 1;
  const ageBuckets = [0, 0, 0, 0];
  for (const c of alive) {
    const a = c.age ?? 30;
    if (a < 20) ageBuckets[0]++;
    else if (a < 40) ageBuckets[1]++;
    else if (a < 60) ageBuckets[2]++;
    else ageBuckets[3]++;
  }
  const ageMax = Math.max(1, ...ageBuckets);
  const partnered = alive.filter(c => !!c.partnerId).length;
  const earthBorn = alive.filter(c => (c.generation ?? 0) === 0).length;
  const morale = Math.round(snapshot.morale * 100);
  const moraleColor =
    morale >= 60 ? 'var(--green)' : morale >= 30 ? 'var(--amber)' : 'var(--rust)';
  const sideStyle = { '--side-color': sideColor } as CSSProperties;
  return (
    <div className={[styles.strip, narrow ? styles.narrow : ''].filter(Boolean).join(' ')}>
      <div className={[styles.col, styles.colNarrow].join(' ')}>
        <div className={styles.rowBaseline}>
          <span className={styles.label} title={VIZ_TOOLTIPS['stat.morale']}>MORALE</span>
          <span
            className={styles.moraleValue}
            style={{ '--morale-color': moraleColor } as CSSProperties}
          >
            {morale}%
          </span>
        </div>
        <div className={styles.bar}>
          <div
            className={styles.moraleFill}
            style={{
              '--morale-pct': `${Math.max(2, morale)}%`,
              '--morale-color': moraleColor,
            } as CSSProperties}
          />
        </div>
        <div className={styles.row}>
          <span>FOOD</span>
          <span className={styles.value2}>{snapshot.foodReserve.toFixed(1)}mo</span>
        </div>
        <div className={styles.row}>
          <span>DEATHS</span>
          <span className={styles.valueRust}>{snapshot.deaths}</span>
        </div>
      </div>
      <div className={styles.col}>
        <div className={styles.moodHeader}>
          <span className={styles.label} title={VIZ_TOOLTIPS['stat.moodMix']}>MOOD MIX</span>
          <span className={styles.value2} title={VIZ_TOOLTIPS['stat.alive']}>{alive.length} alive</span>
        </div>
        {alive.length === 0 ? (
          <div className={styles.moodEmpty}>no survivors</div>
        ) : (
          <>
            <div className={styles.moodBar}>
              {moodOrder.map(m => {
                const c = moodCounts[m] || 0;
                if (c === 0) return null;
                const pct = (c / totalMood) * 100;
                return (
                  <div
                    key={m}
                    title={`${m}: ${c}`}
                    className={styles.moodSegment}
                    style={{
                      '--segment-pct': `${pct}%`,
                      '--segment-bg': moodColors[m] || 'var(--text-4)',
                    } as CSSProperties}
                  />
                );
              })}
            </div>
            <div className={styles.moodLegend}>
              {moodOrder
                .filter(m => (moodCounts[m] || 0) > 0)
                .map(m => `${Math.round(((moodCounts[m] || 0) / totalMood) * 100)}% ${m}`)
                .slice(0, 3)
                .join(' · ')}
            </div>
          </>
        )}
      </div>
      <div className={styles.col}>
        <div className={styles.label} title={VIZ_TOOLTIPS['stat.age']}>AGE</div>
        <div className={styles.ageBars}>
          {ageBuckets.map((n, i) => (
            <div key={i} className={styles.ageBarCol}>
              <div
                title={`${['<20', '20-40', '40-60', '60+'][i]}: ${n} colonists`}
                className={styles.ageBarFill}
                style={{
                  '--age-height': `${(n / ageMax) * 100}%`,
                  '--age-min': n > 0 ? '2px' : '0',
                  '--age-bg': n > 0 ? sideColor : 'transparent',
                } as CSSProperties}
              />
            </div>
          ))}
        </div>
        <div className={styles.ageScale}>
          <span>{'<20'}</span>
          <span>20</span>
          <span>40</span>
          <span>60+</span>
        </div>
      </div>
      <div className={[styles.col, styles.colPaired].join(' ')}>
        <div className={styles.row}>
          <span className={styles.label} title={VIZ_TOOLTIPS['stat.paired']}>PAIRED</span>
          <span className={styles.value2}>
            {partnered}/{alive.length}
          </span>
        </div>
        <div className={styles.row}>
          <span title={VIZ_TOOLTIPS['stat.earth']}>EARTH</span>
          <span className={styles.value2}>{earthBorn}</span>
        </div>
        <div className={styles.row}>
          <span title={VIZ_TOOLTIPS['stat.native']}>NATIVE</span>
          <span className={styles.valueNative} style={sideStyle}>
            {alive.length - earthBorn}
          </span>
        </div>
      </div>
      {!narrow && (
        <div
          className={styles.deptBlock}
          aria-label="Department breakdown"
          title={VIZ_TOOLTIPS['stat.depts']}
        >
          <DeptDonut cells={snapshot.cells} size={44} />
          <span className={styles.deptLabel}>Depts</span>
        </div>
      )}
    </div>
  );
}
