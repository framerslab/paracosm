interface BadgeProps {
  outcome: string;
  neutral?: boolean;
}

const OUTCOME_STYLES: Record<string, { bg: string; color: string; border: string; label: string }> = {
  risky_success:        { bg: 'rgba(232,180,74,.12)', color: 'var(--vis)',   border: 'var(--amber-dim)', label: 'RISKY WIN' },
  risky_failure:        { bg: 'rgba(224,101,48,.12)', color: 'var(--rust)',  border: 'var(--rust-dim)',  label: 'RISKY LOSS' },
  conservative_success: { bg: 'rgba(106,173,72,.12)', color: 'var(--green)', border: 'rgba(106,173,72,.25)', label: 'SAFE WIN' },
  conservative_failure: { bg: 'rgba(224,101,48,.08)', color: 'var(--rust)',  border: 'var(--rust-dim)',  label: 'SAFE LOSS' },
};

export function outcomeLabel(outcome: string): string {
  return OUTCOME_STYLES[outcome]?.label ?? outcome.replace(/_/g, ' ').toUpperCase();
}

export function Badge({ outcome, neutral = false }: BadgeProps) {
  if (neutral) {
    const label = outcomeLabel(outcome);
    return <span aria-label={label.toLowerCase().replace(' ', ', ')} role="img" style={{
      padding: 'calc(var(--frame-gap) / 4) var(--frame-gap)',
      borderRadius: 'var(--radius-sm)',
      font: '600 var(--font-read)/1.4 var(--mono)',
      display: 'inline-block',
      background: 'var(--bg-deep)',
      color: 'var(--text-1)',
      border: 'var(--frame-rule-width) solid var(--edge-control)',
    }}>{label}</span>;
  }
  const s = OUTCOME_STYLES[outcome] || { bg: 'var(--bg-card)', color: 'var(--text-3)', border: 'var(--border)', label: outcome.replace(/_/g, ' ').toUpperCase() };

  return (
    <span style={{
      padding: '3px 10px', borderRadius: '4px', fontSize: 'var(--font-xs)', fontWeight: 800,
      fontFamily: 'var(--mono)', display: 'inline-block', whiteSpace: 'nowrap',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {s.label}
    </span>
  );
}
