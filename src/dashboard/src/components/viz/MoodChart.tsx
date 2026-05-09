interface MoodPoint {
  turn: number;
  moodScore: number;
  crisisTitle?: string;
}

interface MoodChartProps {
  points: MoodPoint[];
  onJumpToTurn?: (turn: number) => void;
  width?: number;
  height?: number;
}

/**
 * Line chart of mood score over turns with crisis annotations at each
 * inflection. Click a point to jump the playhead to that turn. SVG so
 * no canvas dependency; max ~12 points per colonist keeps it trivial.
 */
export function MoodChart({ points, onJumpToTurn, width = 380, height = 120 }: MoodChartProps) {
  if (points.length === 0) {
    return (
      <div style={{ fontSize: 'var(--font-2xs)', color: 'var(--text-3)' }}>No mood history yet.</div>
    );
  }

  const padding = { top: 10, right: 10, bottom: 20, left: 24 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxTurn = Math.max(...points.map(p => p.turn), 1);

  const xForTurn = (turn: number) => padding.left + (turn / Math.max(1, maxTurn)) * plotWidth;
  const yForScore = (score: number) => padding.top + (1 - Math.max(0, Math.min(1, score))) * plotHeight;

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xForTurn(p.turn)},${yForScore(p.moodScore)}`)
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label="Mood trajectory over turns"
      style={{ overflow: 'visible' }}
    >
      {[0.25, 0.5, 0.75].map(v => (
        <line
          key={v}
          x1={padding.left}
          x2={padding.left + plotWidth}
          y1={yForScore(v)}
          y2={yForScore(v)}
          stroke="var(--border)"
          strokeDasharray="2 3"
        />
      ))}
      <path d={pathD} stroke="var(--amber)" strokeWidth="2" fill="none" />
      {points.map((p, i) => {
        const prev = i > 0 ? points[i - 1].moodScore : p.moodScore;
        const color = p.moodScore > prev ? 'var(--green)' : p.moodScore < prev ? 'var(--rust)' : 'var(--amber)';
        const x = xForTurn(p.turn);
        const y = yForScore(p.moodScore);
        return (
          <g key={p.turn}>
            <circle
              cx={x}
              cy={y}
              r={4}
              fill={color}
              stroke="var(--bg-card)"
              strokeWidth="2"
              cursor={onJumpToTurn ? 'pointer' : undefined}
              onClick={() => onJumpToTurn?.(p.turn)}
            >
              {p.crisisTitle && <title>{`T${p.turn}: ${p.crisisTitle}`}</title>}
            </circle>
            <text
              x={x}
              y={height - 4}
              fontSize="8"
              fontFamily="var(--mono)"
              fill="var(--text-3)"
              textAnchor="middle"
            >
              T{p.turn}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
