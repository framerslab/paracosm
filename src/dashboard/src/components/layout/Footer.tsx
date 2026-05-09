import type { CSSProperties } from 'react';
import { useMediaQuery, PHONE_QUERY } from '../viz/grid/useMediaQuery';
import styles from './Footer.module.scss';

interface FooterAbortReason {
  reason: string;
  completedTurns?: number;
}

interface FooterProviderError {
  message: string;
}

interface FooterProps {
  cost?: { totalTokens: number; totalCostUSD: number; llmCalls: number };
  /**
   * Optional per-source split of the cost total. When provided, the
   * Footer's cost span gains a hover tooltip that breaks down the
   * number into sim vs chat components so users can debug where
   * spend is coming from. Keys are USD; any key <= 0 is omitted
   * from the tooltip line.
   */
  costBreakdown?: {
    simUSD?: number;
    simCalls?: number;
    chatUSD?: number;
    chatCalls?: number;
  };
  simStatus?: {
    isRunning: boolean;
    isComplete: boolean;
    isAborted: boolean;
    connectionStatus: 'connecting' | 'connected' | 'error' | 'replay_not_found';
    abortReason?: FooterAbortReason | null;
    providerError?: FooterProviderError | null;
  };
}

function abortReasonLabel(raw: string): string {
  switch (raw) {
    case 'client_disconnected': return 'browser tab closed before the sim finished';
    case 'quota_exhausted': return 'provider credits exhausted';
    case 'user_aborted': return 'cancelled by the user';
    case 'provider_error': return 'provider returned an unrecoverable error';
    case 'unknown': return 'reason not recorded by the server';
    default: return raw;
  }
}

function StatusChip({ s }: { s: NonNullable<FooterProps['simStatus']> }) {
  const color = s.isAborted
    ? 'var(--amber)'
    : s.isComplete
    ? 'var(--green)'
    : s.isRunning
    ? 'var(--color-success, var(--green))'
    : s.connectionStatus === 'connected'
    ? 'var(--text-3)'
    : 'var(--text-3)';
  const text = s.isAborted
    ? 'Interrupted'
    : s.isComplete
    ? 'Complete'
    : s.isRunning
    ? 'Running'
    : s.connectionStatus === 'connected'
    ? 'Idle'
    : s.connectionStatus === 'error'
    ? 'Reconnecting'
    : 'Connecting';
  const glyph = s.isRunning && !s.isComplete && !s.isAborted ? '●' : '○';
  const title = s.isAborted
    ? (() => {
        if (s.providerError) {
          return `Run interrupted: ${s.providerError.message}. Click Clear to reset.`;
        }
        const r = s.abortReason;
        if (!r) return 'Run was interrupted before finishing all turns. Click Clear to reset.';
        const where = typeof r.completedTurns === 'number'
          ? ` after ${r.completedTurns} turn${r.completedTurns === 1 ? '' : 's'}`
          : '';
        return `Run interrupted: ${abortReasonLabel(r.reason)}${where}. Click Clear to reset.`;
      })()
    : s.isComplete
    ? 'Run finished all turns. Verdict is broadcast in Reports.'
    : s.isRunning
    ? 'Simulation in progress.'
    : s.connectionStatus === 'connected'
    ? 'Connected to the simulation server. Press RUN to start.'
    : s.connectionStatus === 'error'
    ? 'Reconnecting to the simulation server.'
    : 'Connecting to the simulation server.';
  return (
    <span
      className={styles.statusChip}
      style={{ '--status-color': color } as CSSProperties}
      role="status"
      aria-live="polite"
      aria-label={`Simulation status: ${text}. ${title}`}
      title={title}
    >
      {glyph} {text}
    </span>
  );
}

function formatUsdShort(u: number): string {
  if (u < 0.01) return `$${u.toFixed(4)}`;
  return `$${u.toFixed(2)}`;
}

function buildCostTooltip(
  cost: NonNullable<FooterProps['cost']>,
  breakdown: FooterProps['costBreakdown'],
): string {
  const lines: string[] = [
    `Total: ${formatUsdShort(cost.totalCostUSD)} · ${cost.totalTokens.toLocaleString()} tokens · ${cost.llmCalls} calls`,
  ];
  if (breakdown) {
    const sim = breakdown.simUSD ?? 0;
    const chat = breakdown.chatUSD ?? 0;
    if (sim > 0) lines.push(`• Simulation: ${formatUsdShort(sim)}${breakdown.simCalls != null ? ` (${breakdown.simCalls} calls)` : ''}`);
    if (chat > 0) lines.push(`• Chat: ${formatUsdShort(chat)}${breakdown.chatCalls != null ? ` (${breakdown.chatCalls} calls)` : ''}`);
  }
  return lines.join('\n');
}

export function Footer({ cost, costBreakdown, simStatus }: FooterProps) {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const cls = ['shrink-0', styles.footer, isPhone ? styles.phone : ''].filter(Boolean).join(' ');
  return (
    <footer className={cls} role="contentinfo">
      {!isPhone && (
        <nav aria-label="Footer links" className={styles.nav}>
          <a href="https://agentos.sh/en" target="_blank" rel="noopener" className={styles.navLink}>agentos.sh</a>
          <a href="https://github.com/framersai/paracosm" target="_blank" rel="noopener" className={styles.navLink}>github</a>
          <a href="https://www.npmjs.com/package/paracosm" target="_blank" rel="noopener" className={styles.navLink}>npm</a>
          <a href="/docs" className={styles.navLink}>docs</a>
          <a href="https://agentos.sh/blog" target="_blank" rel="noopener" className={styles.navLink}>blog</a>
        </nav>
      )}

      {simStatus && <StatusChip s={simStatus} />}

      {cost && (cost.totalTokens > 0 || cost.llmCalls > 0) && (
        <span className={styles.cost} title={buildCostTooltip(cost, costBreakdown)}>
          <span className={styles.costAmount}>
            ${cost.totalCostUSD < 0.01 ? cost.totalCostUSD.toFixed(4) : cost.totalCostUSD.toFixed(2)}
          </span>
          <span className={styles.costMuted}>
            {(cost.totalTokens / 1000).toFixed(0)}k tokens
          </span>
          {cost.llmCalls > 0 && (
            <span className={styles.costMuted}>
              {cost.llmCalls} calls
            </span>
          )}
        </span>
      )}

      {!isPhone && (
        <span>
          <span className={styles.brand}>PARA<span className={styles.brandAccent}>COSM</span></span>
          {' '}&middot; Apache-2.0 &middot; <a href="https://manic.agency" target="_blank" rel="noopener" className={styles.brandLink}>Manic Agency</a> / <a href="https://frame.dev" target="_blank" rel="noopener" className={styles.brandLink}>Frame.dev</a>
        </span>
      )}
    </footer>
  );
}
