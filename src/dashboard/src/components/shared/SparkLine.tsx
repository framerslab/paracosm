import * as React from 'react';

const CHARS = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';

interface SparkLineProps {
  data: number[];
  label?: string;
  suffix?: string;
  color?: string;
}

export function SparkLine({ data, label, suffix = '', color }: SparkLineProps) {
  if (!data.length) return <span style={{ color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 'var(--font-2xs)' }}>&mdash;</span>;

  const max = Math.max(...data) || 1;
  const spark = data.map(v => CHARS[Math.min(7, Math.floor((v / max) * 7.99))]).join('');
  const current = data[data.length - 1];

  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--font-2xs)', whiteSpace: 'nowrap' }}>
      {label && <span style={{ color: 'var(--text-3)', fontSize: 'var(--font-3xs)', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 600 }}>{label} </span>}
      <span style={{ color: color || 'var(--amber)', letterSpacing: '-0.5px' }}>{spark}</span>
      {' '}<span style={{ color: color || 'var(--text-1)' }}>{current}{suffix}</span>
    </span>
  );
}
