import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import type { ScenarioClientPayload } from '../../hooks/useScenario';
import type { GameState, ActorSideState } from '../../hooks/useGameState';
import type { useSSE } from '../../hooks/useSSE';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { Tooltip } from '../shared/Tooltip';
import { RunMenu } from './RunMenu';
import type { LocalHistoryEntry } from '../../hooks/useLocalHistory.helpers';
import styles from './TopBar.module.scss';

/**
 * Mirror the full useSSE return shape so TopBar can read providerError,
 * abortReason, validationFallbacks etc. without any fields getting
 * silently lost behind a narrower inline literal.
 */
type SseState = ReturnType<typeof useSSE>;

interface TopBarProps {
  scenario: ScenarioClientPayload;
  sse: SseState;
  gameState: GameState;
  onSave?: () => void;
  onLoad?: () => void;
  onClear?: () => void;
  onRun?: () => void;
  onTour?: () => void;
  onCopy?: () => void;
  /**
   * Build + copy a deep link to the current run that opens on the viz
   * tab. Wired only when a `sim_saved` server event has landed during
   * this session (or the dashboard is currently replaying a stored
   * session); the menu item is hidden when no sharable session id
   * exists, so the handler doesn't have to defend against null ids.
   */
  onShareViz?: () => void;
  /** F14 local-history props, forwarded to the RunMenu's history section. */
  history?: LocalHistoryEntry[];
  onRestoreHistory?: (entry: LocalHistoryEntry) => void;
  onClearHistory?: () => void;
  /** True while the /setup request is in flight but the first SSE
   *  event hasn't yet arrived. Hides the RUN button so users can't
   *  double-launch. `gameState.isRunning` already hides it after
   *  the sim starts emitting events; this covers the gap. */
  launching?: boolean;
}

/**
 * Animated Paracosm logo. Exact brand SVG structure with subtle
 * glow/pulse/breathe animations. Node positions never move.
 */
function ParacosmLogo({ size = 20 }: { size?: number }) {
  const { resolved } = useTheme();
  const light = resolved === 'light';
  const src = '/favicon.svg';
  const glowColor = light ? 'rgba(122,82,0,.12)' : 'rgba(232,180,74,.15)';

  return (
    <span
      className={styles.logoSpan}
      style={{ '--logo-size': `${size}px`, '--logo-glow': glowColor } as CSSProperties}
    >
      <img src={src} width={size} height={size} alt="Paracosm" className={styles.logoImg} />
      <span className={`pc-logo-glow ${styles.logoGlow}`} />
    </span>
  );
}

export function TopBar({ scenario, sse, gameState, onSave, onLoad, onClear, onRun, onTour, onCopy, onShareViz, launching = false, history, onRestoreHistory, onClearHistory }: TopBarProps) {
  const { resolved, setTheme } = useTheme();
  const hasEvents = Object.values(gameState.actors).some((s: ActorSideState) => s.events.length > 0);

  // Secondary run actions (Save / Copy / Clear) consolidate behind a
  // single overflow trigger so the right cluster does not carry 9+
  // items at mid-laptop widths. Visible only once a run has events,
  // matching the previous gating on each individual button.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRootRef = useRef<HTMLDivElement | null>(null);
  const overflowMenuRef = useFocusTrap<HTMLDivElement>(overflowOpen);
  useEffect(() => {
    if (!overflowOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOverflowOpen(false);
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      const root = overflowRootRef.current;
      if (!root) return;
      if (!root.contains(e.target as Node)) setOverflowOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [overflowOpen]);

  // Status pill priority (highest first):
  //   1. Interrupted — sim was cancelled (user navigated away, server
  //      pulled the plug, quota exhausted). Hover surfaces the specific
  //      reason captured from the first sim_aborted SSE event.
  //   2. Complete — sim finished all turns, verdict broadcast.
  //   3. Live / Reconnecting / Connecting — SSE connection state.
  const statusColor = sse.isAborted
    ? 'var(--amber)'
    : sse.isComplete
    ? 'var(--green)'
    : sse.status === 'connected'
    ? 'var(--color-success)'
    : 'var(--text-3)';

  const statusText = sse.isAborted
    ? 'Interrupted'
    : sse.isComplete
    ? 'Complete'
    : sse.status === 'connected'
    ? 'Live'
    : sse.status === 'error'
    ? 'Reconnecting'
    : 'Connecting';

  // Human-readable tooltip. Every pill state gets a one-line hint, and
  // an interrupted run additionally names the cause (quota, disconnect,
  // user cancel) so the user knows whether to retry, top up credits,
  // or keep the partial results.
  const abortReasonLabel = (raw: string): string => {
    switch (raw) {
      case 'client_disconnected': return 'browser tab closed before the sim finished';
      case 'quota_exhausted': return 'provider credits exhausted';
      case 'user_aborted': return 'cancelled by the user';
      case 'provider_error': return 'provider returned an unrecoverable error';
      case 'unknown': return 'reason not recorded by the server';
      default: return raw;
    }
  };
  const statusTitle = sse.isAborted
    ? (() => {
        // Provider errors take priority over the generic abort reason
        // because they are always the actionable cause (top up credits,
        // fix the key). The orchestrator does not emit sim_aborted for
        // provider errors, so without this branch the pill would read
        // "reason not recorded" on quota exhaustion.
        if (sse.providerError) {
          return `Run interrupted: ${sse.providerError.message}. Click Clear to reset.`;
        }
        const r = sse.abortReason;
        if (!r) return 'Run was interrupted before finishing all turns. Click Clear to reset.';
        const base = `Run interrupted: ${abortReasonLabel(r.reason)}`;
        const where = typeof r.completedTurns === 'number'
          ? ` after ${r.completedTurns} turn${r.completedTurns === 1 ? '' : 's'}`
          : '';
        return `${base}${where}. Click Clear to reset.`;
      })()
    : sse.isComplete
    ? 'Run finished all turns. Verdict is broadcast in Reports.'
    : sse.status === 'connected'
    ? 'Connected to the simulation server. Press RUN to start.'
    : sse.status === 'error'
    ? 'Reconnecting to the simulation server.'
    : 'Connecting to the simulation server.';

  // Guard against gameState.maxTurns === 0 during the initialization
  // window before /scenario resolves. The outer `turn > 0` check below
  // makes this defensive in practice, but a stray 0 here would render
  // "NaN%" or "Infinity%" and break the progress bar.
  const progressPct = gameState.maxTurns > 0
    ? `${Math.round((gameState.turn / gameState.maxTurns) * 100)}%`
    : '0%';

  return (
    <header
      className={`topbar flex items-center justify-between px-4 gap-3 shrink-0 ${styles.bar}`}
      role="banner"
    >
      {/* Left: Logo + name + scenario */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Single anchor wrapping logo + brand text — both pointed at `/`
            previously, creating two adjacent Tab stops for the same
            navigation. Visible layout is preserved by keeping the
            inline-flex container on .logoLink. */}
        <a href="/" className={`${styles.logoLink} ${styles.brand}`} aria-label="Paracosm home">
          <ParacosmLogo size={20} />
          <span>PARA<span className={styles.brandAccent}>COSM</span></span>
        </a>
        <a
          href="https://agentos.sh/en"
          target="_blank"
          rel="noopener"
          className={`topbar-agentos ${styles.agentosTag}`}
          aria-label="AgentOS Runtime (opens in new tab)"
          title="AgentOS Runtime"
        >
          AGENTOS
        </a>
        <span className={`topbar-agentos ${styles.divider}`} aria-hidden="true">|</span>
        <span className={`topbar-scenario ${styles.scenarioName}`}>
          {scenario.labels.name}
        </span>
      </div>

      {/* Center: Turn info + progress */}
      <div className={`flex items-center gap-3 flex-1 justify-center ${styles.center}`}>
        {gameState.turn > 0 && (
          <div className={`topbar-meta flex items-center gap-2 shrink-0 ${styles.meta}`}>
            {/* Compact T / Y / S tokens wrapped in Tooltip portal so
                viewers can hover for the full meaning. The token stays
                short so the whole topbar meta row fits at mid-laptop
                widths (1024-1440px); the rich explanation lives in the
                popover. */}
            <Tooltip
              content={
                <div>
                  <div className={styles.tooltipTitle}>
                    Turn {gameState.turn} / {gameState.maxTurns}
                  </div>
                  <div>
                    One decision cycle per turn. Departments analyze the
                    situation, the commander picks a policy, the kernel
                    advances in-sim time, colonists age. At turn
                    {' '}{gameState.maxTurns}{' '}the run finishes
                    {gameState.actorIds.length === 2
                      ? ' and the verdict judge compares the two commanders.'
                      : '; cohort runs (3+ commanders) skip the verdict and surface group-median deltas instead.'}
                  </div>
                </div>
              }
            >
              <span className={styles.tokenInline}>
                <span className={styles.tokenLabel}>T</span>
                <strong className={styles.tokenValue}>{gameState.turn}</strong>
                <span className={styles.tokenLabel}>/{gameState.maxTurns}</span>
              </span>
            </Tooltip>
            <Tooltip
              content={
                <div>
                  <div className={styles.tooltipTitle}>
                    In-sim time {gameState.time}
                  </div>
                  <div>
                    The time the colony thinks it's living in. Advances by
                    the scenario's <code>timePerTurn</code> (usually 5-10)
                    each decision cycle. Drives aging, childbirth,
                    retirement, and long-arc narrative. Real wall-clock
                    time doesn't matter — only the in-sim time.
                  </div>
                </div>
              }
            >
              <span className={styles.tokenInline}>
                <span className={styles.tokenLabel}>Y</span>
                <strong className={styles.tokenValue}>{gameState.time}</strong>
              </span>
            </Tooltip>
            <Tooltip
              content={
                <div>
                  <div className={styles.tooltipTitle}>
                    Random seed {gameState.seed}
                  </div>
                  <div>
                    All kernel-side randomness (colonist generation, mood
                    drift, crisis selection) derives from this seed. Same
                    seed + same leaders + same scenario produces identical
                    rosters and identical kernel outcomes — so Leader A
                    and Leader B start from the same colony and diverge
                    only by their personalities, not by luck.
                  </div>
                </div>
              }
            >
              <span className={styles.tokenInline}>
                <span className={styles.tokenLabel}>S</span>
                <strong className={styles.tokenValue}>{gameState.seed}</strong>
              </span>
            </Tooltip>
            <div
              className={`topbar-progress w-20 h-1.5 rounded-full overflow-hidden ${styles.progressTrack}`}
              role="progressbar"
              aria-valuenow={gameState.turn}
              aria-valuemin={0}
              aria-valuemax={gameState.maxTurns}
              aria-label={`Simulation progress, turn ${gameState.turn} of ${gameState.maxTurns}`}
            >
              <div
                className={`h-full rounded-full transition-all ${styles.progressFill}`}
                style={{ '--progress-pct': progressPct } as CSSProperties}
              />
            </div>
            {sse.validationFallbacks.length > 0 && (() => {
              const total = sse.validationFallbacks.reduce((sum, b) => sum + b.count, 0);
              return (
                <Tooltip
                  content={
                    <div>
                      <div className={styles.tooltipTitle}>
                        ⚠ {total} validation fallback{total === 1 ? '' : 's'}
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        An LLM call returned a JSON payload that failed zod
                        schema validation. After retries were exhausted the
                        orchestrator continued with an empty skeleton so the
                        sim wouldn't abort mid-turn. Numbers here let you
                        spot which schema is misbehaving.
                      </div>
                      <div className={styles.fallbackBlock}>
                        {sse.validationFallbacks.map(b => (
                          <div key={b.schemaName} className={styles.fallbackRow}>
                            <span>{b.schemaName}</span>
                            <span className={styles.fallbackRowMeta}>
                              {b.count}× {b.lastSite ? `(last: ${b.lastSite})` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  }
                >
                  <span
                    aria-label={`${total} validation fallback${total === 1 ? '' : 's'}`}
                    className={styles.fallbackPill}
                  >
                    <span aria-hidden="true">⚠</span>
                    {total}
                  </span>
                </Tooltip>
              );
            })()}
          </div>
        )}
        <div className={`topbar-center hidden md:block truncate ${styles.tagline}`}>
          {gameState.turn === 0 ? 'Same input. Different decisions. Emergent divergence.' : ''}
        </div>
      </div>

      {/* Right: Actions + status + theme */}
      <div className="flex items-center gap-2 shrink-0">
        {/* GitHub CTA — :hover inverts to amber. The mouse-event handler
            mutating inline styles was a workaround pre-CSS-module; the
            module's :hover rule does the same job without React state. */}
        <a
          href="https://github.com/framerslab/paracosm"
          target="_blank"
          rel="noopener noreferrer"
          className={`topbar-github ${styles.github}`}
          title="Star Paracosm on GitHub"
          aria-label="Open Paracosm on GitHub"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={styles.githubIcon}>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          <span className="topbar-github-label">GITHUB</span>
        </a>

        {/* Tour button */}
        {onTour && (
          <button
            onClick={onTour}
            className={`topbar-tour ${styles.tourBtn}`}
            title="Interactive guided tour with sample data"
            aria-label="Start guided tour"
          >
            <span className="topbar-tour-label">HOW IT WORKS</span>
            <span className="topbar-tour-icon" aria-hidden="true" style={{ display: 'none' }}>{'?'}</span>
          </button>
        )}
        {/* Run button. Hidden while isRunning OR launching so users
            can't double-fire /setup (which would race against the
            in-flight launch). Swaps to a disabled 'LAUNCHING...' chip
            during the launching window so the UI doesn't appear
            frozen — prior behaviour silently showed nothing. */}
        {onRun && !gameState.isRunning && !launching && (
          <RunMenu
            onRun={onRun}
            onLoadFromFile={onLoad}
            history={history}
            onRestoreHistory={onRestoreHistory}
            onClearHistory={onClearHistory}
            liveStateHasEvents={sse.events.length > 0}
          />
        )}
        {launching && !gameState.isRunning && (
          <span
            className={styles.launchingChip}
            role="status"
            aria-live="polite"
          >
            LAUNCHING…
          </span>
        )}
        {/* Save / Copy / Clear consolidated behind a single overflow
            menu so they don't fight for horizontal space with RUN /
            GITHUB / TOUR / status / theme. Visible only when a run
            has emitted events (same gating the 3 separate buttons
            had before). */}
        {/* Clear always opens the menu so the user can wipe server-
            stored runs + sessions + output files even with an empty
            local buffer. Save/Copy still require an active run; their
            individual buttons inside the menu are gated separately. */}
        {((hasEvents && (onSave || onCopy || onShareViz)) || onClear) && (
          <div ref={overflowRootRef} className={styles.overflowAnchor}>
            <button
              type="button"
              onClick={() => setOverflowOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              aria-label={overflowOpen ? 'Close run actions' : 'Open run actions menu'}
              title="Save · Share · Copy · Wipe"
              className={`${styles.toolBtn} ${styles.overflowTrigger}`}
            >
              ⋯
            </button>
            {overflowOpen && (
              <div
                ref={overflowMenuRef}
                role="menu"
                tabIndex={-1}
                className={styles.overflowMenu}
              >
                {hasEvents && onSave && (
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => { setOverflowOpen(false); onSave(); }}
                    className={styles.overflowItem}
                    title="Export simulation data as .json"
                  >
                    Save
                  </button>
                )}
                {hasEvents && onShareViz && (
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => { setOverflowOpen(false); onShareViz(); }}
                    className={styles.overflowItem}
                    title="Copy a deep link that opens this run on the visualization tab"
                  >
                    Share viz link
                  </button>
                )}
                {hasEvents && onCopy && (
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => { setOverflowOpen(false); onCopy(); }}
                    className={styles.overflowItem}
                    title="Copy simulation summary to clipboard"
                  >
                    Copy
                  </button>
                )}
                {onClear && (
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => { setOverflowOpen(false); onClear(); }}
                    className={styles.overflowItemDanger}
                    title="Clear in-browser simulation buffer + cached events. Server-stored runs are kept."
                  >
                    Clear local data
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <span className={styles.divider} aria-hidden="true">|</span>

        {/* Status. The text label hides under .topbar-status-text at
            narrow viewports (<640px) so the colored dot alone signals
            connection state on phones; the title attribute still
            carries the full explanation for hover, and the aria-label
            keeps screen-reader semantics intact. */}
        <span
          className={styles.statusPill}
          style={{ '--status-color': statusColor } as CSSProperties}
          role="status"
          aria-live="polite"
          aria-label={`${statusText}. ${statusTitle}`}
          title={statusTitle}
        >
          <span aria-hidden="true">{sse.status === 'connected' && !sse.isComplete ? '●' : '○'}</span>
          <span className={`topbar-status-text ${styles.statusText}`}>{statusText}</span>
        </span>

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
          className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${styles.themeBtn}`}
          title={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
          aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
        >
          {resolved === 'dark' ? '☀' : '☽'}
        </button>
      </div>
    </header>
  );
}
