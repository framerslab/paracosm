import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import type { ScenarioClientPayload } from '../../hooks/useScenario';
import type { GameState, ActorSideState } from '../../hooks/useGameState';
import type { useSSE } from '../../hooks/useSSE';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { Tooltip } from '../shared/Tooltip';
import { HOW_IT_WORKS } from '../quickstart/first-screen/words';
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
  onClear?: () => void;
  /**
   * Asks the server to delete its stored runs, saved sessions and run
   * output files, for every visitor. Passed only where the server takes
   * admin writes and this browser holds an admin token; the menu shows
   * Delete server data only then.
   */
  onWipeServer?: () => void;
  /**
   * Called each time the run actions menu opens, so the page can ask again
   * for what decides the menu's items (GET /admin-config) after a failed
   * request.
   */
  onRunActionsOpen?: () => void;
  /**
   * Opens and closes the How it works card. The key shows where this is
   * given, says whether the card is open, and is reached through
   * `howItWorksKeyRef`, which the card stands under and returns focus to.
   */
  onHowItWorks?: () => void;
  howItWorksOpen?: boolean;
  howItWorksKeyRef?: RefObject<HTMLButtonElement | null>;
  onCopy?: () => void;
  /**
   * Build + copy a deep link to the current run that opens on the viz
   * tab. Wired only when a `sim_saved` server event has landed during
   * this session (or the dashboard is currently replaying a stored
   * session); the menu item is hidden when no sharable session id
   * exists, so the handler doesn't have to defend against null ids.
   */
  onShareViz?: () => void;
  runExists: boolean;
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

export function TopBar({ scenario, sse, gameState, onSave, onClear, onWipeServer, onRunActionsOpen, onHowItWorks, howItWorksOpen = false, howItWorksKeyRef, onCopy, onShareViz, runExists }: TopBarProps) {
  const { resolved, setTheme } = useTheme();
  const hasEvents = Object.values(gameState.actors).some((s: ActorSideState) => s.events.length > 0);

  // Secondary run actions (Save / Copy / Clear) consolidate behind a
  // single overflow trigger so the right cluster does not carry 9+
  // items at mid-laptop widths. Visible only once a run has events,
  // matching the previous gating on each individual button.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRootRef = useRef<HTMLDivElement | null>(null);
  const overflowMenuRef = useFocusTrap<HTMLDivElement>(overflowOpen && runExists);
  useEffect(() => {
    if (!runExists) setOverflowOpen(false);
  }, [runExists]);
  useEffect(() => {
    if (overflowOpen) onRunActionsOpen?.();
  }, [overflowOpen, onRunActionsOpen]);
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
      case 'another_run_started': return 'you started another run';
      case 'server_restarted': return 'the server restarted before the run finished';
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
    ? 'Connected to the simulation server. No run in progress.'
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
              // A fallback replaced a reply with the empty skeleton; a
              // salvage kept the model's own reply without the effect keys
              // the run does not hold. The pill counts both and names each.
              const fallbacks = sse.validationFallbacks.filter(b => !b.salvaged);
              const salvages = sse.validationFallbacks.filter(b => b.salvaged);
              const fellBack = fallbacks.reduce((sum, b) => sum + b.count, 0);
              const kept = salvages.reduce((sum, b) => sum + b.count, 0);
              const total = fellBack + kept;
              const fellBackLabel = `${fellBack} validation fallback${fellBack === 1 ? '' : 's'}`;
              const keptLabel = `${kept} ${kept === 1 ? 'reply' : 'replies'} kept without the keys the run does not hold`;
              const label = [fellBack > 0 ? fellBackLabel : '', kept > 0 ? keptLabel : ''].filter(Boolean).join(', ');
              const rows = (buckets: typeof fallbacks) => (
                <div className={styles.fallbackBlock}>
                  {buckets.map(b => (
                    <div key={b.schemaName} className={styles.fallbackRow}>
                      <span>{b.schemaName}</span>
                      <span className={styles.fallbackRowMeta}>
                        {b.count}× {b.lastSite ? `(last: ${b.lastSite})` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              );
              return (
                <Tooltip
                  content={
                    <div>
                      {fellBack > 0 && (
                        <div style={{ marginBottom: kept > 0 ? 8 : 0 }}>
                          <div className={styles.tooltipTitle}>⚠ {fellBackLabel}</div>
                          <div style={{ marginBottom: 8 }}>
                            An LLM call returned a JSON payload that failed zod
                            schema validation. After retries were exhausted the
                            orchestrator continued with an empty skeleton so the
                            sim wouldn't abort mid-turn. Numbers here let you
                            spot which schema is misbehaving.
                          </div>
                          {rows(fallbacks)}
                        </div>
                      )}
                      {kept > 0 && (
                        <div>
                          <div className={styles.tooltipTitle}>⚠ {keptLabel}</div>
                          <div style={{ marginBottom: 8 }}>
                            A reply failed schema validation only on effect keys
                            the run does not hold. After retries the run kept the
                            model's own reply with those keys dropped; nothing
                            was replaced with a skeleton.
                          </div>
                          {rows(salvages)}
                        </div>
                      )}
                    </div>
                  }
                >
                  <span
                    aria-label={label}
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
        {/* How it works: opens the one card that states the rules of a
            run, and closes it. Its words name it; where the row has no
            room for them they give way to the question mark and stay as
            the key's name. */}
        {onHowItWorks && (
          <button
            ref={howItWorksKeyRef}
            type="button"
            onClick={onHowItWorks}
            className={styles.tourBtn}
            aria-expanded={howItWorksOpen}
            aria-haspopup="dialog"
          >
            <span className={styles.helpLabel}>{HOW_IT_WORKS}</span>
            <span className={styles.helpIcon} aria-hidden="true">{'?'}</span>
          </button>
        )}
        {runExists && (
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
                    title="Clear in-browser simulation buffer + cached events, and let go of this browser's run on the server, stopping it if it is running. Run history, saved sessions and output files are kept."
                  >
                    Clear local data
                  </button>
                )}
                {onWipeServer && (
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => { setOverflowOpen(false); onWipeServer(); }}
                    className={styles.overflowItemDanger}
                    title="Delete the server's stored runs, saved sessions and run output files, for every visitor. Pages showing a finished run this server holds, this one included, empty their view of it."
                  >
                    Delete server data
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <span className={styles.divider} aria-hidden="true">|</span>

        {/* The compact connection status keeps its accessible name on phones. */}
        <span
          className={styles.statusPill}
          style={{ '--status-color': statusColor } as CSSProperties}
          role="status"
          aria-live="polite"
          aria-label={`${statusText}. ${statusTitle}`}
          title={statusTitle}
        >
          <span aria-hidden="true">{sse.status === 'connected' && !sse.isComplete ? '●' : '○'}</span>
          <span className={styles.statusText}>{statusText}</span>
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
