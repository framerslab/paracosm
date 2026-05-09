import { useMemo } from 'react';
import type { CellSnapshot } from '../viz-types.js';

const DEPT_COLORS: Record<string, string> = {
  medical: '#4ecdc4',
  engineering: '#e8b44a',
  agriculture: '#6aad48',
  psychology: '#9b6b9e',
  governance: '#e06530',
  research: '#956bd8',
  science: '#956bd8',
  ops: '#c87a3a',
  operations: '#c87a3a',
};

function deptColor(dept: string): string {
  const key = (dept || '').toLowerCase();
  return DEPT_COLORS[key] ?? '#a89878';
}

/**
 * Compact SVG donut chart showing per-department live population
 * breakdown for one leader. Rendered inside the metrics strip so
 * viewers see composition at a glance without hunting dept labels.
 */
export function DeptDonut({
  cells,
  size = 44,
}: {
  cells: CellSnapshot[];
  size?: number;
}) {
  const { slices, alive } = useMemo(() => {
    const counts = new Map<string, number>();
    let n = 0;
    for (const c of cells) {
      if (!c.alive) continue;
      const key = (c.department || 'unknown').toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
      n += 1;
    }
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const slicesOut: { dept: string; count: number; frac: number; color: string }[] = [];
    for (const [dept, count] of entries) {
      slicesOut.push({ dept, count, frac: count / Math.max(1, n), color: deptColor(dept) });
    }
    return { slices: slicesOut, alive: n };
  }, [cells]);

  if (alive === 0) {
    return (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-4)',
          fontSize: 'var(--font-3xs)',
          fontFamily: 'var(--mono)',
        }}
        aria-label="No live members"
      >
        —
      </div>
    );
  }

  const radius = size / 2;
  const inner = radius - 6;
  const cx = radius;
  const cy = radius;
  let theta = -Math.PI / 2; // start at 12 o'clock

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Department breakdown: ${slices.map(s => `${s.dept} ${s.count}`).join(', ')}`}
    >
      {slices.map((s, i) => {
        const angle = s.frac * Math.PI * 2;
        const t0 = theta;
        const t1 = theta + angle;
        theta = t1;
        const x0 = cx + Math.cos(t0) * radius;
        const y0 = cy + Math.sin(t0) * radius;
        const x1 = cx + Math.cos(t1) * radius;
        const y1 = cy + Math.sin(t1) * radius;
        const xi0 = cx + Math.cos(t0) * inner;
        const yi0 = cy + Math.sin(t0) * inner;
        const xi1 = cx + Math.cos(t1) * inner;
        const yi1 = cy + Math.sin(t1) * inner;
        const largeArc = angle > Math.PI ? 1 : 0;
        const d = [
          `M ${x0.toFixed(2)} ${y0.toFixed(2)}`,
          `A ${radius} ${radius} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
          `L ${xi1.toFixed(2)} ${yi1.toFixed(2)}`,
          `A ${inner} ${inner} 0 ${largeArc} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)}`,
          'Z',
        ].join(' ');
        return (
          <path
            key={`${s.dept}-${i}`}
            d={d}
            fill={s.color}
            opacity={0.85}
          >
            <title>{`${s.dept}: ${s.count} (${Math.round(s.frac * 100)}%)`}</title>
          </path>
        );
      })}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        fontFamily="ui-monospace, monospace"
        fontWeight={800}
        fill="var(--text-1)"
      >
        {alive}
      </text>
    </svg>
  );
}
