interface HexacoProfile {
  O: number; C: number; E: number; A: number; Em: number; HH: number;
}

interface HexacoRadarProps {
  profile: HexacoProfile;
  colonyMean?: HexacoProfile;
  size?: number;
}

const AXES: Array<keyof HexacoProfile> = ['O', 'C', 'E', 'A', 'Em', 'HH'];

const LABEL_SIZE = 15;
const LABEL_INSET = 12;
const LABEL_CLEARANCE = 14;

function polarPoint(center: number, radius: number, i: number) {
  const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
  return { x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius };
}

function polygonPoints(values: HexacoProfile, center: number, radius: number): string {
  return AXES.map((axis, i) => {
    const value = Math.max(0, Math.min(1, values[axis]));
    const { x, y } = polarPoint(center, radius * value, i);
    return `${x},${y}`;
  }).join(' ');
}

/**
 * 6-axis HEXACO radar. Filled polygon = colonist, dashed polygon =
 * colony mean (if provided). Pure SVG; no canvas dependency.
 */
export function HexacoRadar({ profile, colonyMean, size = 160 }: HexacoRadarProps) {
  const center = size / 2;
  const labelRadius = center - LABEL_INSET;
  const gridRadius = labelRadius - LABEL_CLEARANCE;
  const profilePoints = polygonPoints(profile, center, gridRadius);
  const meanPoints = colonyMean ? polygonPoints(colonyMean, center, gridRadius) : null;
  return (
    <svg width={size} height={size} role="img" aria-label="HEXACO profile radar">
      {[0.25, 0.5, 0.75, 1.0].map(p => (
        <circle
          key={p}
          cx={center}
          cy={center}
          r={gridRadius * p}
          fill="none"
          stroke="var(--border)"
          strokeDasharray={p === 1.0 ? undefined : '2 3'}
        />
      ))}
      {AXES.map((axis, i) => {
        const { x, y } = polarPoint(center, labelRadius, i);
        return (
          <text
            key={axis}
            x={x}
            y={y}
            fontSize={LABEL_SIZE}
            fontFamily="var(--mono)"
            fill="var(--text-3)"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {axis}
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
