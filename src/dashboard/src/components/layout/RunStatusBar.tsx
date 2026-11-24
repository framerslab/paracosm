import type { ComponentProps, CSSProperties } from 'react';
import { useMediaQuery, PHONE_QUERY } from '../viz/grid/useMediaQuery';
import { RunProgress } from './RunProgress';
import styles from './RunStatusBar.module.scss';

interface RunStatusBarAbortReason {
  reason: string;
  completedTurns?: number;
}

interface RunStatusBarProviderError {
  message: string;
}

interface RunStatusBarProps {
  progress: ComponentProps<typeof RunProgress>;
  cost?: { totalTokens: number; totalCostUSD: number; llmCalls: number };
  /**
   * Optional per-source split of the cost total. When provided, the
   * RunStatusBar's cost span gains a hover tooltip that breaks down the
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
    abortReason?: RunStatusBarAbortReason | null;
    providerError?: RunStatusBarProviderError | null;
  };
}

function abortReasonLabel(raw: string): string {
  switch (raw) {
    case 'client_disconnected': return 'browser tab closed before the sim finished';
    case 'quota_exhausted': return 'provider credits exhausted';
    case 'user_aborted': return 'cancelled by the user';
    case 'provider_error': return 'provider returned an unrecoverable error';
    case 'another_run_started': return 'you started another run';
    case 'server_restarted': return 'the server restarted before the run finished';
    case 'unknown': return 'reason not recorded by the server';
    default: return raw;
  }
}

function StatusChip({ s }: { s: NonNullable<RunStatusBarProps['simStatus']> }) {
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
    ? 'Connected to the simulation server. No run in progress.'
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
  cost: NonNullable<RunStatusBarProps['cost']>,
  breakdown: RunStatusBarProps['costBreakdown'],
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

/** Shows the status, progress and cost of the open run. */
export function RunStatusBar({ cost, costBreakdown, progress, simStatus }: RunStatusBarProps) {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const cls = ['shrink-0', styles.bar, isPhone ? styles.phone : ''].filter(Boolean).join(' ');
  return (
    <section className={cls} aria-label="Run status">
      {simStatus && <StatusChip s={simStatus} />}
      <RunProgress {...progress} />

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

    </section>
  );
}
