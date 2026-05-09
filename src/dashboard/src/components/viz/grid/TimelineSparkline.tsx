import type { CSSProperties } from 'react';
import type { TurnSnapshot } from '../viz-types.js';
import styles from './TimelineSparkline.module.scss';

interface TimelineSparklineProps {
  snapsA: TurnSnapshot[];
  snapsB: TurnSnapshot[];
  currentTurn: number;
  onJumpToTurn: (turn: number) => void;
  /** Lifted hover turn so the chronicle can highlight in sync. */
  hoveredTurn?: number | null;
  onHoverTurnChange?: (turn: number | null) => void;
}

/**
 * Two-line sparkline showing morale trajectory for both leaders across
 * turns. Current-turn vertical marker keeps the timeline oriented.
 * Clicking a point jumps the playhead to that turn.
 */
export function TimelineSparkline({
  snapsA,
  snapsB,
  currentTurn,
  onJumpToTurn,
  hoveredTurn,
  onHoverTurnChange,
}: TimelineSparklineProps) {
  const maxTurns = Math.max(snapsA.length, snapsB.length);
  if (maxTurns < 2) return null;

  const W = 600;
  const H = 28;
  const padX = 6;
  const padY = 3;
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;

  const buildPath = (
    snaps: TurnSnapshot[],
    valueOf: (s: TurnSnapshot) => number,
  ): string => {
    if (snaps.length === 0) return '';
    const stepX = plotW / Math.max(1, maxTurns - 1);
    return snaps
      .map((s, i) => {
        const x = padX + i * stepX;
        const y = padY + (1 - valueOf(s)) * plotH;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  // Normalize food + pop against their per-run maxima so all three
  // metrics share a 0..1 axis. Morale is already 0..1.
  const maxFood = Math.max(
    18,
    ...snapsA.map(s => s.foodReserve),
    ...snapsB.map(s => s.foodReserve),
  );
  const maxPop = Math.max(
    1,
    ...snapsA.map(s => s.population),
    ...snapsB.map(s => s.population),
  );
  const normFood = (s: TurnSnapshot) => Math.max(0, Math.min(1, s.foodReserve / maxFood));
  const normPop = (s: TurnSnapshot) => Math.max(0, Math.min(1, s.population / maxPop));
  const normMorale = (s: TurnSnapshot) => Math.max(0, Math.min(1, s.morale));

  const cursorX = padX + currentTurn * (plotW / Math.max(1, maxTurns - 1));
  const hoverX =
    typeof hoveredTurn === 'number'
      ? padX + hoveredTurn * (plotW / Math.max(1, maxTurns - 1))
      : null;

  const turnFromEvent = (clientX: number, rect: DOMRect): number => {
    const xInSvg = ((clientX - rect.left) / rect.width) * W;
    const turn = Math.round(((xInSvg - padX) / plotW) * (maxTurns - 1));
    return Math.max(0, Math.min(maxTurns - 1, turn));
  };

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onJumpToTurn(turnFromEvent(e.clientX, rect));
  };

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onHoverTurnChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onHoverTurnChange(turnFromEvent(e.clientX, rect));
  };
  const handleLeave = () => {
    onHoverTurnChange?.(null);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.legend}>
        <span>MORALE · POP · FOOD · T1 → T{maxTurns}</span>
        <span className={styles.legendRight}>
          <span className={styles.legendA}>A</span>
          <span className={styles.legendB}>B</span>
          <span className={styles.legendKey}>— morale</span>
          <span className={styles.legendKey}>··· pop</span>
          <span className={styles.legendKey}>- - food</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Timeline sparkline of morale, population, and food across both leaders"
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        className={styles.svg}
        height={H}
      >
        {/* 50% morale grid line */}
        <line
          x1={padX}
          x2={W - padX}
          y1={padY + plotH / 2}
          y2={padY + plotH / 2}
          stroke="var(--border)"
          strokeWidth={0.5}
          strokeDasharray="2 2"
        />
        {/* Food (dashed) + pop (dotted) trace beneath the morale line */}
        <path d={buildPath(snapsA, normFood)} fill="none" stroke="var(--vis)" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.45} />
        <path d={buildPath(snapsB, normFood)} fill="none" stroke="var(--eng)" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.45} />
        <path d={buildPath(snapsA, normPop)} fill="none" stroke="var(--vis)" strokeWidth={0.7} strokeDasharray="1 2" opacity={0.5} />
        <path d={buildPath(snapsB, normPop)} fill="none" stroke="var(--eng)" strokeWidth={0.7} strokeDasharray="1 2" opacity={0.5} />
        <path d={buildPath(snapsA, normMorale)} fill="none" stroke="var(--vis)" strokeWidth={1.3} />
        <path d={buildPath(snapsB, normMorale)} fill="none" stroke="var(--eng)" strokeWidth={1.3} />
        {hoverX !== null && hoveredTurn !== currentTurn && (
          <line x1={hoverX} x2={hoverX} y1={0} y2={H} stroke="var(--text-3)" strokeWidth={0.75} strokeDasharray="2 3" opacity={0.7} />
        )}
        <line x1={cursorX} x2={cursorX} y1={0} y2={H} stroke="var(--amber)" strokeWidth={1} />
      </svg>
      {typeof hoveredTurn === 'number' && (() => {
        const a = snapsA[hoveredTurn];
        const b = snapsB[hoveredTurn];
        if (!a && !b) return null;
        const leftPct = (hoveredTurn / Math.max(1, maxTurns - 1)) * 100;
        const tooltipStyle: CSSProperties = {
          '--hover-left': `calc(${leftPct}% + 8px)`,
          '--hover-translate': leftPct > 75 ? 'translateX(calc(-100% - 16px))' : 'none',
        } as CSSProperties;
        return (
          <div className={styles.tooltip} style={tooltipStyle}>
            <div className={styles.tooltipTurn}>
              T{hoveredTurn + 1}
              {a?.time ? ` · ${a.time}` : ''}
            </div>
            {a && (
              <div className={styles.tooltipRowA}>
                <span className={styles.tooltipBold}>A</span>
                <span>pop {a.population}</span>
                <span>· {Math.round(a.morale * 100)}% mor</span>
                <span>· {a.foodReserve.toFixed(1)}mo</span>
                {(a.births > 0 || a.deaths > 0) && <span>· +{a.births}/-{a.deaths}</span>}
              </div>
            )}
            {b && (
              <div className={styles.tooltipRowB}>
                <span className={styles.tooltipBold}>B</span>
                <span>pop {b.population}</span>
                <span>· {Math.round(b.morale * 100)}% mor</span>
                <span>· {b.foodReserve.toFixed(1)}mo</span>
                {(b.births > 0 || b.deaths > 0) && <span>· +{b.births}/-{b.deaths}</span>}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
