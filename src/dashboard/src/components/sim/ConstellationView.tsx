/**
 * Radial constellation layout for N actors. Each actor is a node on a
 * circle; every pair has an edge whose opacity = (1 - normalized
 * HEXACO distance), so close-personality pairs render bright and
 * divergent pairs fade. Click any node to drill into its full report.
 *
 * Pure SVG, no D3, no canvas. The position table + distance map are
 * memoized on actorIds.length so a 50-actor sim re-rendering at SSE
 * cadence stays under 16ms.
 *
 * @module paracosm/dashboard/sim/ConstellationView
 */
import * as React from 'react';
import { useState, useMemo } from 'react';
import styles from './ConstellationView.module.scss';
import { computeHexacoDistances } from './computeHexacoDistances.js';
import { extractNodeStats } from './constellation-stats.js';
import { getActorColorVar } from '../../hooks/useGameState.js';
import type { GameState } from '../../hooks/useGameState.js';
import { useScenarioContext } from '../../App';
import { projectCohorts } from './cohort.helpers.js';
import { CohortLegend } from './CohortLegend';

export interface ConstellationViewProps {
  state: GameState;
  onActorClick: (name: string) => void;
}

const NODE_RADIUS = 18;
const LABEL_MARGIN = 80;
/** Hide per-edge HEXACO distance labels at this many actors or above.
 *  N=9 → 36 edges; labels start to visually pile up beyond that. */
const EDGE_LABEL_CAP = 9;

/** Polar layout. Actor 0 sits at 12 o'clock; rest fan clockwise. */
function computePositions(actorCount: number): Array<{ cx: number; cy: number; angle: number }> {
  if (actorCount === 0) return [];
  const radius = Math.min(460, Math.max(120, 60 + 12 * actorCount));
  const center = radius + LABEL_MARGIN;
  const positions: Array<{ cx: number; cy: number; angle: number }> = [];
  for (let i = 0; i < actorCount; i += 1) {
    const angle = (i / Math.max(1, actorCount)) * 2 * Math.PI - Math.PI / 2;
    positions.push({
      cx: center + radius * Math.cos(angle),
      cy: center + radius * Math.sin(angle),
      angle,
    });
  }
  return positions;
}

function svgSize(actorCount: number): number {
  if (actorCount === 0) return 0;
  const radius = Math.min(460, Math.max(120, 60 + 12 * actorCount));
  return (radius + LABEL_MARGIN) * 2;
}

export function ConstellationView({ state, onActorClick }: ConstellationViewProps): JSX.Element {
  const actorIds = state.actorIds;

  const positions = React.useMemo(() => computePositions(actorIds.length), [actorIds.length]);

  const traits = React.useMemo(
    () => actorIds.map((id) => {
      const leader = state.actors[id]?.leader;
      return { name: id, hexaco: leader?.hexaco ?? {} };
    }),
    [actorIds, state.actors],
  );
  const traitsSig = traits.map((t) => `${t.name}:${Object.values(t.hexaco).join(',')}`).join('|');
  const distances = React.useMemo(() => computeHexacoDistances(traits), [traitsSig]);

  const pairLookup = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const p of distances.pairs) {
      m.set(`${p.a}|${p.b}`, p.normalized);
      m.set(`${p.b}|${p.a}`, p.normalized);
    }
    return m;
  }, [distances]);

  const scenario = useScenarioContext();
  const nodeStats = React.useMemo(
    () => actorIds.map(id => extractNodeStats(state, id)),
    [actorIds, state],
  );

  // Cohort grouping by leader archetype. The legend renders only when
  // there are 2+ cohorts and ≥3 actors (CohortLegend gates internally);
  // pair runs collapse to nothing. Focus state lives here so clicking
  // a legend pill dims the off-cohort nodes + edges below.
  const cohorts = useMemo(() => projectCohorts(state), [state]);
  const [focusedArchetype, setFocusedArchetype] = useState<string | null>(null);
  // Map of id → cohort archetype, for cheap per-render lookup.
  const archetypeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cohorts) for (const id of c.ids) m.set(id, c.archetype);
    return m;
  }, [cohorts]);
  const isInFocus = (id: string): boolean =>
    focusedArchetype === null || archetypeById.get(id) === focusedArchetype;

  if (actorIds.length === 0) {
    return (
      <div className={styles.empty}>
        Constellation will appear when actors are launched.
      </div>
    );
  }

  const size = svgSize(actorIds.length);

  return (
    <div className={styles.wrap}>
      <CohortLegend
        cohorts={cohorts}
        focusedArchetype={focusedArchetype}
        onFocusChange={setFocusedArchetype}
      />
      <svg
        className={styles.svg}
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={`Constellation of ${actorIds.length} actors`}
      >
        {actorIds.map((idA, i) => actorIds.slice(i + 1).map((idB) => {
          const pa = positions[i];
          const pb = positions[actorIds.indexOf(idB)];
          if (!pa || !pb) return null;
          const norm = pairLookup.get(`${idA}|${idB}`) ?? 0;
          // Dim edges that connect actors outside the focused cohort —
          // either endpoint outside is enough to fade. Cross-cohort
          // edges are inherently mixed, so we treat them as off-focus.
          const edgeInFocus = isInFocus(idA) && isInFocus(idB);
          const focusMul = focusedArchetype === null ? 1 : (edgeInFocus ? 1 : 0.12);
          const opacity = Math.max(0.06, Math.min(0.95, 1 - norm)) * focusMul;
          // Suppress per-edge labels when there's no HEXACO spread —
          // either every actor has an empty hexaco map (status frame
          // in flight, or replayed sessions where it was never
          // recorded) or every actor really has the same trait vector.
          // Either way, "0.00" on every edge reads as a bug; cleaner
          // to render the edges plain and let the absence speak.
          const showLabel = distances.hasSpread
            && actorIds.length < EDGE_LABEL_CAP
            && (focusedArchetype === null || edgeInFocus);
          const mx = (pa.cx + pb.cx) / 2;
          const my = (pa.cy + pb.cy) / 2;
          return (
            <React.Fragment key={`${idA}|${idB}`}>
              <line
                data-edge={`${idA}|${idB}`}
                className={styles.edge}
                x1={pa.cx}
                y1={pa.cy}
                x2={pb.cx}
                y2={pb.cy}
                strokeOpacity={opacity}
                strokeWidth={1.5}
              />
              {showLabel && (
                <text
                  className={styles.edgeLabel}
                  x={mx}
                  y={my}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  aria-hidden="true"
                >
                  {norm.toFixed(2)}
                </text>
              )}
            </React.Fragment>
          );
        }))}

        {actorIds.map((id, i) => {
          const pos = positions[i];
          if (!pos) return null;
          const color = getActorColorVar(i);
          const leader = state.actors[id]?.leader;
          const archetype = leader?.archetype ?? '';
          const labelDistance = NODE_RADIUS + 14;
          const lx = pos.cx + Math.cos(pos.angle) * labelDistance;
          const ly = pos.cy + Math.sin(pos.angle) * labelDistance;
          const anchor = pos.angle > -Math.PI / 2 && pos.angle < Math.PI / 2 ? 'start' : 'end';
          // Cohort focus: when a legend pill is active, fade nodes
          // outside that cohort to ~25% opacity. Click-through still
          // works on dimmed nodes so users can drill in if curious.
          const dimmed = focusedArchetype !== null && !isInFocus(id);
          const groupOpacity = dimmed ? 0.25 : 1;
          return (
            <g key={id} opacity={groupOpacity}>
              <circle
                data-actor={id}
                className={styles.node}
                cx={pos.cx}
                cy={pos.cy}
                r={NODE_RADIUS}
                fill={color}
                onClick={() => onActorClick(id)}
                onKeyDown={(e) => {
                  // Mirror native button semantics: Enter or Space
                  // activates the node. preventDefault stops Space
                  // from page-scrolling the SVG container.
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onActorClick(id);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Open report for ${id}`}
              >
                <title>{`${id}${archetype ? ` · ${archetype}` : ''}`}</title>
              </circle>
              <text
                className={styles.label}
                x={lx}
                y={ly}
                textAnchor={anchor}
                dominantBaseline="middle"
              >
                {id}
              </text>
              {(() => {
                const stats = nodeStats[i];
                if (!stats) return null;
                const lineGap = 14;
                // stats.morale is sourced from actor.moraleHistory[last]
                // (constellation-stats.ts:47), which useGameState already
                // pre-scales to 0-100. Don't multiply by 100 a second
                // time — same bug as ActorBar's compact branch had.
                const popMoraleText = stats.pop !== null && stats.morale !== null
                  ? `POP ${Math.round(stats.pop)} · MORALE ${Math.round(stats.morale)}%`
                  : '';
                const glyph = stats.latestOutcome === 'success' ? '✓' : stats.latestOutcome === 'failure' ? '⚠' : '…';
                const glyphClass =
                  stats.latestOutcome === 'success' ? styles.outcomeSuccess
                  : stats.latestOutcome === 'failure' ? styles.outcomeFailure
                  : styles.outcomePending;
                const showMortality = stats.deaths >= 5;
                return (
                  <>
                    {popMoraleText && (
                      <text
                        className={styles.statLine}
                        x={lx}
                        y={ly + lineGap}
                        textAnchor={anchor}
                        dominantBaseline="middle"
                      >
                        {popMoraleText}
                      </text>
                    )}
                    <text
                      className={styles.statBadge}
                      x={lx}
                      y={ly + lineGap * 2}
                      textAnchor={anchor}
                      dominantBaseline="middle"
                    >
                      {`D${stats.decisions} · F${stats.tools} `}
                      <tspan className={`${styles.outcomeGlyph} ${glyphClass}`}>{glyph}</tspan>
                      {showMortality && (
                        <tspan className={styles.statBadgeMortality}>{` · ${stats.deaths}†`}</tspan>
                      )}
                    </text>
                  </>
                );
              })()}
            </g>
          );
        })}
        {(() => {
          const cx = size / 2;
          const cy = size / 2;
          const actorNoun = scenario.labels.actorNounPlural ?? 'actors';
          return (
            <g className={styles.centerChip} role="presentation">
              <text
                className={styles.centerChipTurn}
                x={cx}
                y={cy - 6}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                T{state.turn}/{state.maxTurns}
              </text>
              <text
                className={styles.centerChipScenario}
                x={cx}
                y={cy + 10}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {scenario.labels.shortName} · {actorIds.length} {actorNoun}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
