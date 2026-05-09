interface HexacoProfile {
  O: number; C: number; E: number; A: number; Em: number; HH: number;
}

interface HexacoRadarProps {
  profile: HexacoProfile;
  colonyMean?: HexacoProfile;
  size?: number;
}

const AXES: Array<keyof HexacoProfile> = ['O', 'C', 'E', 'A', 'Em', 'HH'];

function pointFor(values: HexacoProfile, size: number): string {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 8;
  return AXES.map((axis, i) => {
    const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
    const v = Math.max(0, Math.min(1, values[axis]));
    const r = radius * v;
    return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
  }).join(' ');
}

function axisLabel(axis: keyof HexacoProfile, size: number, i: number): { x: number; y: number; label: string } {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;
  const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
    label: axis,
  };
}

/**
 * 6-axis HEXACO radar. Filled polygon = colonist, dashed polygon =
 * colony mean (if provided). Pure SVG; no canvas dependency.
 */
export function HexacoRadar({ profile, colonyMean, size = 160 }: HexacoRadarProps) {
  const profilePoints = pointFor(profile, size);
  const meanPoints = colonyMean ? pointFor(colonyMean, size) : null;
  const cx = size / 2;
  const cy = size / 2;
  const gridRadius = size / 2 - 8;
  return (
    <svg width={size} height={size} role="img" aria-label="HEXACO profile radar">
      {[0.25, 0.5, 0.75, 1.0].map(p => (
        <circle
          key={p}
          cx={cx}
          cy={cy}
          r={gridRadius * p}
          fill="none"
          stroke="var(--border)"
          strokeDasharray={p === 1.0 ? undefined : '2 3'}
        />
      ))}
      {AXES.map((axis, i) => {
        const p = axisLabel(axis, size, i);
        return (
          <text
            key={axis}
            x={p.x}
            y={p.y}
            fontSize="9"
            fontFamily="var(--mono)"
            fill="var(--text-3)"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {p.label}
          </text>
        );
      })}
      {meanPoints && (
        <polygon
          points={meanPoints}
          fill="none"
          stroke="var(--text-3)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      )}
      <polygon
        points={profilePoints}
        fill="color-mix(in srgb, var(--amber) 25%, transparent)"
        stroke="var(--amber)"
        strokeWidth="1.5"
      />
    </svg>
  );
}
