import { useMemo, useRef, useEffect } from 'react';
import type { ActorSideState } from '../../hooks/useGameState';
import { getActorColorVar } from '../../hooks/useGameState';
import type { ToolRegistry } from '../../hooks/useToolRegistry';
import { useScenarioContext } from '../../App';
import { formatBagTooltip } from './StatsBar.helpers';
import styles from './StatsBar.module.scss';

export interface StatsBarLeader {
  id: string;
  state: ActorSideState;
}

interface StatsBarProps {
  /** Ordered actor list. Index 0 renders with vis palette, index 1 with eng.
   *  F2/F3 will extend beyond two columns; today only the first two render
   *  in the pills row. */
  actors: StatsBarLeader[];
  crisisText?: string;
  /** Per-simulation forged-tool registry. Used to surface per-actor reuse
   *  counts so users can see how much each actor leaned on emergent tools
   *  across the run. */
  toolRegistry?: ToolRegistry;
}

function fmtVal(value: number, format: string): string {
  if (format === 'percent') return `${Math.round(value * 100)}%`;
  if (format === 'number') {
    const r = Math.round(value * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }
  return String(value);
}

function fmtSuffix(id: string): string {
  if (id === 'foodMonthsReserve') return 'mo';
  return '';
}

/** Short labels that fit the dense stats bar (desktop + tablet). */
const SHORT_LABELS: Record<string, string> = {
  population: 'POP',
  morale: 'MORALE',
  foodMonthsReserve: 'FOOD',
  powerKw: 'POWER',
  infrastructureModules: 'MODULES',
  scienceOutput: 'SCIENCE',
  hullIntegrity: 'HULL',
  oxygenReserveHours: 'O2',
};

/** Single-character icon labels for phone width (<480px). */
const ICON_LABELS: Record<string, string> = {
  population: 'P',
  morale: 'M',
  foodMonthsReserve: 'F',
  powerKw: 'W',
  infrastructureModules: 'I',
  scienceOutput: 'S',
  hullIntegrity: 'H',
  oxygenReserveHours: 'O₂',
};

function delta(curr: number, prev: number | undefined): string {
  if (prev == null) return '';
  const d = Math.round((curr - prev) * 100) / 100;
  if (d === 0) return '';
  return d > 0 ? `+${d}` : `${d}`;
}

function deltaClass(d: string, tone: 'gain' | 'lossIsRed' | 'neutral'): string {
  if (!d) return '';
  if (tone === 'neutral') return styles.deltaNeutral;
  // `lossIsRed` inverts the usual sign→color mapping: for a metric
  // where growth is bad (deaths), positive deltas read red and
  // negative deltas read green. Deaths only accumulate in paracosm
  // today, so the negative-delta branch is defensive for future use.
  if (tone === 'lossIsRed') {
    return d.startsWith('-') ? styles.deltaPositive : styles.deltaNegative;
  }
  return d.startsWith('+') ? styles.deltaPositive : styles.deltaNegative;
}

function formatCauses(causes: Record<string, number> | undefined): string {
  if (!causes) return '';
  const sorted = Object.entries(causes).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return '';
  const top = sorted.slice(0, 3).map(([cause, n]) => {
    const short = cause.replace('radiation cancer', 'radiation').replace('natural causes', 'age').replace('age-related complications', 'age').replace('fatal fracture', 'fracture').replace('accident: ', '').replace('accident', 'accident');
    return `${n} ${short}`;
  });
  const rest = sorted.length - top.length;
  return rest > 0 ? `${top.join(' \u00b7 ')} +${rest}` : top.join(' \u00b7 ');
}

export function StatsBar({ actors, crisisText, toolRegistry }: StatsBarProps) {
  const scenario = useScenarioContext();

  const aLeader = actors[0];
  const bLeader = actors[1];
  const aState = aLeader?.state;
  const bState = bLeader?.state;
  const metricsA = aState?.metrics ?? null;
  const metricsB = bState?.metrics ?? null;
  const prevMetricsA = aState?.prevMetrics ?? null;
  const prevMetricsB = bState?.prevMetrics ?? null;
  const deathsA = aState?.deaths ?? 0;
  const deathsB = bState?.deaths ?? 0;
  const deathCausesA = aState?.deathCauses;
  const deathCausesB = bState?.deathCauses;
  const toolsA = aState?.tools ?? 0;
  const toolsB = bState?.tools ?? 0;
  const citationsA = aState?.citations ?? 0;
  const citationsB = bState?.citations ?? 0;
  const aLeaderName = aLeader?.id ?? '';
  const bLeaderName = bLeader?.id ?? '';

  // Scenario-declared statuses + environment bags, threaded through
  // from the orchestrator's `turn_done` event via useGameState. When a
  // scenario declares no bags (Mars heritage), these stay undefined
  // and the pill group below renders nothing. When it declares them
  // (corporate, submarine, medieval, game-world), we surface one
  // compact pill per bag with a tooltip that lists the key/value
  // pairs so the dense bar stays scannable but no information hides.
  const statusesA = aState?.statuses;
  const statusesB = bState?.statuses;
  const environmentA = aState?.environment;
  const environmentB = bState?.environment;

  // Per-leader reuse counts derived from the forged-tool ledger. A
  // reuse is any tool-use event after the first forge, counted per
  // leader (by name) from the authoritative orchestrator history.
  // Rejected re-forges are excluded so the pill reflects useful reuse only.
  const { reuseA, reuseB } = useMemo(() => {
    let a = 0; let b = 0;
    for (const entry of toolRegistry?.list ?? []) {
      for (let i = 1; i < entry.history.length; i++) {
        const h = entry.history[i];
        if (h.rejected) continue;
        if (h.actorName === aLeaderName) a++;
        else if (h.actorName === bLeaderName) b++;
      }
    }
    return { reuseA: a, reuseB: b };
  }, [toolRegistry, aLeaderName, bLeaderName]);

  const prevCountersRef = useRef({ toolsA, toolsB, reuseA, reuseB, citationsA, citationsB, deathsA, deathsB });
  const prev = prevCountersRef.current;
  const deltaToolsA = delta(toolsA, prev.toolsA);
  const deltaToolsB = delta(toolsB, prev.toolsB);
  const deltaReuseA = delta(reuseA, prev.reuseA);
  const deltaReuseB = delta(reuseB, prev.reuseB);
  const deltaCitesA = delta(citationsA, prev.citationsA);
  const deltaCitesB = delta(citationsB, prev.citationsB);
  const deltaDeathsA = delta(deathsA, prev.deathsA);
  const deltaDeathsB = delta(deathsB, prev.deathsB);
  useEffect(() => {
    prevCountersRef.current = { toolsA, toolsB, reuseA, reuseB, citationsA, citationsB, deathsA, deathsB };
  }, [toolsA, toolsB, reuseA, reuseB, citationsA, citationsB, deathsA, deathsB]);

  if (!metricsA && !metricsB) {
    return null;
  }

  // POP/MORALE moved to the sticky compact ActorBar at the top of the
  // SIM TurnGrid. The shared StatsBar now carries only the genuinely
  // comparative cross-leader stats (deaths, tools, reuse, cites,
  // statuses, env).
  const metrics = scenario.ui.headerMetrics
    .filter(m => m.id !== 'population' && m.id !== 'morale')
    .slice(0, 4);
  const colorA = getActorColorVar(0);
  const colorB = getActorColorVar(1);

  return (
    <div
      className={`stats-bar ${styles.bar}`}
      role="region"
      aria-label="Leader statistics"
      // tabIndex=0 so keyboard users can focus + horizontally scroll
      // the stats row. The bar overflows on narrow viewports when many
      // metric pills are present (axe `scrollable-region-focusable`).
      tabIndex={0}
      style={{
        ['--actor-color-a' as string]: colorA,
        ['--actor-color-b' as string]: colorB,
      }}
    >
      {crisisText && <span className={styles.crisis}>{crisisText}</span>}

      {metrics.map(metric => {
        const valA = metricsA?.[metric.id] ?? 0;
        const valB = metricsB?.[metric.id] ?? 0;
        const dA = delta(valA, prevMetricsA?.[metric.id]);
        const dB = delta(valB, prevMetricsB?.[metric.id]);
        const fA = fmtVal(valA, metric.format);
        const fB = fmtVal(valB, metric.format);
        const suffix = fmtSuffix(metric.id);
        const label = SHORT_LABELS[metric.id] || metric.id.replace(/([A-Z])/g, ' $1').trim().toUpperCase();
        const icon = ICON_LABELS[metric.id] || label.charAt(0);
        return (
          <span key={metric.id} className={styles.pill}>
            <span className={styles.label} title={label}>
              <span className="pill-label-full">{label}</span>
              <span className="pill-label-short">{icon}</span>
            </span>
            <span className={styles.valueA}>{fA}{suffix}</span>
            {dA && <span className={deltaClass(dA, 'gain')}>{dA}</span>}
            <span className={styles.sep}>vs</span>
            <span className={styles.valueB}>{fB}{suffix}</span>
            {dB && <span className={deltaClass(dB, 'gain')}>{dB}</span>}
          </span>
        );
      })}

      <span className={styles.pill}>
        <span className={styles.label} title="Deaths">
          <span className="pill-label-full">DEATHS</span>
          <span className="pill-label-short">†</span>
        </span>
        <span
          className={styles.valueA}
          title={deathCausesA && Object.keys(deathCausesA).length > 0
            ? `Leader A deaths by cause: ${Object.entries(deathCausesA).map(([k, v]) => `${v} ${k}`).join(', ')}`
            : undefined}
        >
          {deathsA}
        </span>
        {deltaDeathsA && <span className={deltaClass(deltaDeathsA, 'lossIsRed')}>{deltaDeathsA}</span>}
        <span className={styles.sep}>vs</span>
        <span
          className={styles.valueB}
          title={deathCausesB && Object.keys(deathCausesB).length > 0
            ? `Leader B deaths by cause: ${Object.entries(deathCausesB).map(([k, v]) => `${v} ${k}`).join(', ')}`
            : undefined}
        >
          {deathsB}
        </span>
        {deltaDeathsB && <span className={deltaClass(deltaDeathsB, 'lossIsRed')}>{deltaDeathsB}</span>}
        {(() => {
          const chipA = formatCauses(deathCausesA);
          const chipB = formatCauses(deathCausesB);
          if (!chipA && !chipB) return null;
          return (
            <span className={styles.causesChip}>
              ({chipA || '0'} / {chipB || '0'})
            </span>
          );
        })()}
      </span>

      <span className={styles.pill}>
        <span className={styles.label} title="Tools forged">
          <span className="pill-label-full">TOOLS</span>
          <span className="pill-label-short">T</span>
        </span>
        <span className={styles.valueA}>{toolsA}</span>
        {deltaToolsA && <span className={styles.deltaPositive}>{deltaToolsA}</span>}
        <span className={styles.sep}>/</span>
        <span className={styles.valueB}>{toolsB}</span>
        {deltaToolsB && <span className={styles.deltaPositive}>{deltaToolsB}</span>}
      </span>

      {toolRegistry && toolRegistry.list.length > 0 && (
        <span
          className={styles.pill}
          title="Forged-tool reuse count per leader. Reuses amortize forge cost across multiple events."
        >
          <span className={styles.label} title="Reuse count">
            <span className="pill-label-full">REUSE</span>
            <span className="pill-label-short">R</span>
          </span>
          <span className={styles.valueA}>{reuseA}</span>
          {deltaReuseA && <span className={styles.deltaPositive}>{deltaReuseA}</span>}
          <span className={styles.sep}>/</span>
          <span className={styles.valueB}>{reuseB}</span>
          {deltaReuseB && <span className={styles.deltaPositive}>{deltaReuseB}</span>}
        </span>
      )}

      <span className={styles.pill}>
        <span className={styles.label} title="Citations">
          <span className="pill-label-full">CITES</span>
          <span className="pill-label-short">C</span>
        </span>
        <span className={styles.valueA}>{citationsA}</span>
        {deltaCitesA && <span className={deltaClass(deltaCitesA, 'neutral')}>{deltaCitesA}</span>}
        <span className={styles.sep}>/</span>
        <span className={styles.valueB}>{citationsB}</span>
        {deltaCitesB && <span className={deltaClass(deltaCitesB, 'neutral')}>{deltaCitesB}</span>}
      </span>

      {(statusesA || statusesB) && (
        <span
          className={styles.pill}
          title={`Categorical scenario-declared statuses (world.statuses).\n\nLeader A:\n${formatBagTooltip(statusesA) || '(none)'}\n\nLeader B:\n${formatBagTooltip(statusesB) || '(none)'}`}
        >
          <span className={styles.label}>
            <span className="pill-label-full">STATUSES</span>
            <span className="pill-label-short">§</span>
          </span>
          <span className={styles.valueA}>{statusesA ? Object.keys(statusesA).length : 0}</span>
          <span className={styles.sep}>/</span>
          <span className={styles.valueB}>{statusesB ? Object.keys(statusesB).length : 0}</span>
        </span>
      )}

      {(environmentA || environmentB) && (
        <span
          className={styles.pill}
          title={`Environment bag (world.environment), external conditions.\n\nLeader A:\n${formatBagTooltip(environmentA) || '(none)'}\n\nLeader B:\n${formatBagTooltip(environmentB) || '(none)'}`}
        >
          <span className={styles.label}>
            <span className="pill-label-full">ENV</span>
            <span className="pill-label-short">E</span>
          </span>
          <span className={styles.valueA}>{environmentA ? Object.keys(environmentA).length : 0}</span>
          <span className={styles.sep}>/</span>
          <span className={styles.valueB}>{environmentB ? Object.keys(environmentB).length : 0}</span>
        </span>
      )}
    </div>
  );
}
