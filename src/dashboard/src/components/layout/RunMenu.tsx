/**
 * Unified RUN dropdown: new-sim launcher + saved-run picker + file
 * loader in a single popover. Replaces the three separate TopBar
 * buttons (REPLAY / RUN / LOAD) that previously competed for
 * horizontal space.
 *
 * Menu items, in order:
 *   1. ▶ Run New Simulation — fires onRun (spends credits).
 *   2. ↻ Run Saved Simulation — expands into a scrollable grid of
 *      server-cached runs (same card layout the old LoadMenu used).
 *      Disabled when the /sessions catalog is empty.
 *   3. 📁 Load from file — delegates to onLoadFromFile (pulls a
 *      previously-Saved JSON off the user's disk).
 *
 * @module paracosm/cli/dashboard/components/layout/RunMenu
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessions, type StoredSessionMeta } from '../../hooks/useSessions';
import { resolveSetupRedirectHref } from '../../tab-routing';
import { buildReplayHref, cacheExpandedBody } from './LoadMenu.helpers';
import type { LocalHistoryEntry } from '../../hooks/useLocalHistory.helpers';
import { Tooltip } from '../shared/Tooltip';
import styles from './RunMenu.module.scss';

// Alias kept for minimal-diff readability within the history section
// that landed earlier in F14; all classes live in the same module.
const historyStyles = styles;

export interface RunMenuProps {
  /** Fires when the user picks "Run New Simulation". */
  onRun?: () => void;
  /** Fires when the user picks "Load from file". */
  onLoadFromFile?: () => void;
  /**
   * Client-side local-history ring (F14). When non-empty, RunMenu
   * shows a collapsible "Local history" section below the saved-run
   * cards. Omit or pass an empty array + no-op handlers to hide.
   */
  history?: LocalHistoryEntry[];
  onRestoreHistory?: (entry: LocalHistoryEntry) => void;
  onClearHistory?: () => void;
  /**
   * True when the live SSE state has events. When true, restoring a
   * history entry fires a native `confirm()` before dispatch to avoid
   * silently replacing an in-flight run.
   */
  liveStateHasEvents?: boolean;
}

function formatRelative(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '·';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatCost(usd: number | undefined): string {
  if (usd == null) return '·';
  if (usd < 0.005) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function SessionCard({ s, onPick }: { s: StoredSessionMeta; onPick: () => void }) {
  const deterministicTitle = s.leaderA && s.leaderB
    ? `${s.leaderA} vs ${s.leaderB}${s.scenarioName ? ` · ${s.scenarioName}` : ''}`
    : s.scenarioName || 'Simulation Run';
  const title = s.title || s.scenarioName || deterministicTitle;
  const actors = s.leaderA && s.leaderB ? `${s.leaderA} vs ${s.leaderB}` : '';
  const scenarioSub = s.title && s.scenarioName ? s.scenarioName : '';
  const turns = s.turnCount != null ? `${s.turnCount} turn${s.turnCount === 1 ? '' : 's'}` : '';
  const line2 = [actors, scenarioSub, turns].filter(Boolean).join(' · ');
  const line3 = `${new Date(s.createdAt).toLocaleString()} (${formatRelative(s.createdAt)}) · ${formatDuration(s.durationMs)} · ${formatCost(s.totalCostUSD)}`;
  return (
    <button type="button" onClick={onPick} className={styles.sessionCard}>
      <div className={styles.sessionCardTitle}>{title}</div>
      {line2 && <div className={styles.sessionCardLine2}>{line2}</div>}
      <div className={styles.sessionCardLine3}>{line3}</div>
    </button>
  );
}

export function RunMenu({
  onRun,
  onLoadFromFile,
  history = [],
  onRestoreHistory,
  onClearHistory,
  liveStateHasEvents = false,
}: RunMenuProps) {
  const [open, setOpen] = useState(false);
  const [savedExpanded, setSavedExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const { sessions, status, refresh } = useSessions();
  const cacheAvailable = sessions.length > 0;

  // Refresh the catalog each time the dropdown opens so a run that
  // finished since last open shows up without a full reload.
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const close = useCallback(() => {
    setOpen(false);
    setSavedExpanded(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const handleRunNew = () => {
    close();
    onRun?.();
  };

  const handlePickSession = (id: string) => {
    const href = buildReplayHref(window.location.href, id);
    window.location.assign(resolveSetupRedirectHref(href, 'sim'));
  };

  const handleFile = () => {
    close();
    onLoadFromFile?.();
  };

  const body = cacheExpandedBody(status, sessions);

  return (
    <div ref={rootRef} className={styles.root}>
      <Tooltip
        content={
          <div>
            <div className={styles.tooltipHeading}>Run</div>
            <div>
              Launches a fresh simulation, replays a cached one, or
              loads a saved JSON from disk. Click to open the menu.
            </div>
          </div>
        }
      >
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={styles.triggerButton}
        >
          <span aria-hidden="true">▶</span>
          RUN
          <span aria-hidden="true" className={styles.triggerCaret}>▾</span>
        </button>
      </Tooltip>
      {open && (
        <div role="menu" aria-label="Run actions" className={styles.menuPopover}>
          {/* Run New Simulation — primary action, loudest styling.
              Hardcoded near-black text on the rust gradient so the
              label stays high-contrast in both dark and light
              themes regardless of which --text-* token we pick. */}
          <button
            type="button"
            role="menuitem"
            onClick={handleRunNew}
            className={styles.runNewButton}
          >
            <span className={styles.menuButtonInnerLeft}>
              <span aria-hidden="true" className={styles.menuButtonIcon}>▶</span>
              <span>Run New Simulation</span>
            </span>
            <span className={styles.runNewBadge}>spends credits</span>
          </button>

          {/* Run Saved Simulation — expandable row, disabled when empty.
              Same near-black-on-amber treatment so contrast holds in
              both themes. */}
          <button
            type="button"
            role="menuitem"
            onClick={() => cacheAvailable && setSavedExpanded(e => !e)}
            disabled={!cacheAvailable}
            className={[styles.runSavedButton, cacheAvailable ? '' : styles.disabled].filter(Boolean).join(' ')}
          >
            <span className={styles.menuButtonInnerLeft}>
              <span aria-hidden="true" className={styles.menuButtonIcon}>↻</span>
              <span>Run Saved Simulation</span>
            </span>
            <span className={[styles.runSavedBadge, cacheAvailable ? '' : styles.disabled].filter(Boolean).join(' ')}>
              {cacheAvailable
                ? `${sessions.length} cached · ${savedExpanded ? 'hide' : 'pick'}`
                : 'no cache yet'}
            </span>
          </button>

          {/* Expanded saved-run cards. Reuses the old LoadMenu cache
              body states so loading / empty / error render consistently. */}
          {savedExpanded && cacheAvailable && (
            <div className={styles.savedCardsWrap}>
              {body === 'cards' && sessions.map(s => (
                <SessionCard key={s.id} s={s} onPick={() => handlePickSession(s.id)} />
              ))}
              {body === 'loading' && (
                <div className={styles.savedStatus}>Loading cached runs…</div>
              )}
              {body === 'error' && (
                <div className={styles.savedError}>
                  Could not reach /sessions. Try again in a moment.
                </div>
              )}
              {body === 'unavailable' && (
                <div className={styles.savedStatus}>
                  Session cache is disabled on this server.
                </div>
              )}
            </div>
          )}

          {/* Local history (F14). Collapsible list of runs cached in
              this browser. Hidden entirely when the ring is empty so
              the menu stays tidy before the user's first save. */}
          {history.length > 0 && (
            <>
              <button
                type="button"
                role="menuitem"
                className={historyStyles.historyRow}
                onClick={() => setHistoryExpanded((v) => !v)}
                aria-expanded={historyExpanded}
              >
                <span className={historyStyles.historyRowLabel}>
                  <span aria-hidden="true">🕘</span>
                  <span>Local history</span>
                </span>
                <span className={historyStyles.historyRowBadge}>
                  {history.length} recent · {historyExpanded ? 'hide' : 'show'}
                </span>
              </button>
              {historyExpanded && (
                <div className={historyStyles.historyList}>
                  {history.map((entry) => {
                    const ts = Date.parse(entry.createdAt) || entry.id;
                    // Defensive: legacy entries (pre-0.8.0 storage key
                    // bump) carry `leaderNames` instead of `actorNames`.
                    // The HISTORY_STORAGE_KEY bump orphans those, but
                    // belt-and-suspenders with `?? []` so a future
                    // schema drift can't crash the run-menu render.
                    const actors =
                      (entry.summary.actorNames ?? []).join(' vs ') ||
                      entry.scenarioShortName;
                    const turns = entry.summary.turnCount
                      ? `${entry.summary.turnCount} turn${entry.summary.turnCount === 1 ? '' : 's'}`
                      : '';
                    // Dedup: when actorNames is empty we already fell
                    // back to scenarioShortName for `actors`; don't
                    // repeat it in line2.
                    const line2 = [
                      actors,
                      actors !== entry.scenarioShortName ? entry.scenarioShortName : '',
                      turns,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    const line3 = `${formatRelative(ts)} · ${entry.summary.eventCount} ev · ${formatCost(entry.summary.totalCostUSD)}`;
                    return (
                      <div
                        key={entry.id}
                        className={historyStyles.historyCardWrap}
                      >
                        <button
                          type="button"
                          className={historyStyles.historyCard}
                          onClick={() => {
                            if (
                              liveStateHasEvents &&
                              !window.confirm(
                                'Replace current simulation with this history entry?',
                              )
                            ) {
                              return;
                            }
                            onRestoreHistory?.(entry);
                            close();
                          }}
                        >
                          <div className={historyStyles.historyCardTitle}>
                            {actors}
                          </div>
                          <div className={historyStyles.historyCardLine2}>
                            {line2}
                          </div>
                          <div className={historyStyles.historyCardLine3}>
                            {line3}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                  {onClearHistory && (
                    <button
                      type="button"
                      className={historyStyles.historyClearAll}
                      title="Wipe everything in this browser: saved-runs ring, event cache, current sim state. Server data untouched — use Wipe All in the ⋯ menu for that."
                      onClick={() => {
                        if (
                          window.confirm(
                            'Clear all local browser state?\n\n' +
                            '  • Saved-runs ring (this dropdown)\n' +
                            '  • Event cache (Sim / Constellation / Log)\n' +
                            '  • Current SSE state\n\n' +
                            'Server-stored runs are NOT affected (use Wipe All in the ⋯ menu for that).\n\nCannot be undone.',
                          )
                        ) {
                          onClearHistory();
                        }
                      }}
                    >
                      Clear local data
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Load from file — tertiary action, muted but still
              high-contrast. Uses text-1 so the label reads clearly
              against bg-card in both themes. */}
          {onLoadFromFile && (
            <button
              type="button"
              role="menuitem"
              onClick={handleFile}
              className={styles.loadFileButton}
            >
              <span className={styles.menuButtonInnerLeft}>
                <span aria-hidden="true" className={styles.menuButtonIcon}>📁</span>
                <span>Load from file…</span>
              </span>
              <span className={styles.loadFileBadge}>json export</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
