import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import type { ScenarioClientPayload } from '../../hooks/useScenario';
import type { DashboardTab } from '../../tab-routing';
import { TabBar } from './TabBar';
import { useTheme } from '../../theme/ThemeProvider';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { HOME_NAME, HOW_IT_WORKS, NO_FREE_RUNS, SWITCH_TO_DARK, SWITCH_TO_LIGHT } from './frameWords';
import { useRowFit } from './useRowFit';
import { useVisitorState } from './visitorState';
import styles from './TopBar.module.scss';

interface TopBarProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  scenario: ScenarioClientPayload;
  hasEvents: boolean;
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
  onHowItWorks: () => void;
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

function LookMark({ dark }: { dark: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.glyph}
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      {dark ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19" />
        </>
      ) : <path d="M21 13.2A9.1 9.1 0 0 1 10.8 3a9.1 9.1 0 1 0 10.2 10.2Z" />}
    </svg>
  );
}

/** Shows the shared dashboard controls and the visitor's payer or quota. */
export function TopBar({
  activeTab, onTabChange, scenario, hasEvents, onSave, onClear, onWipeServer, onRunActionsOpen,
  onHowItWorks, howItWorksOpen = false, howItWorksKeyRef, onCopy, onShareViz, runExists,
}: TopBarProps) {
  const { resolved, setTheme } = useTheme();
  const dark = resolved === 'dark';
  const visitor = useVisitorState();
  const row = useRef<HTMLDivElement>(null);
  const fold = useRowFit(row, 4);

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

  /** The menu's arrow keys, Home and End move between its actions, as a menu's keys do. */
  function moveInRunActions(event: ReactKeyboardEvent<HTMLDivElement>) {
    const actions = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (!actions.length) return;
    const at = actions.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = (at + 1) % actions.length; break;
      case 'ArrowUp': next = at < 0 ? actions.length - 1 : (at + actions.length - 1) % actions.length; break;
      case 'Home': next = 0; break;
      case 'End': next = actions.length - 1; break;
      default: return;
    }
    event.preventDefault();
    actions[next]?.focus();
  }

  return (
    <header role="banner" className={styles.bar}>
      <div ref={row} data-row="Header" data-row-fold={fold} className={styles.row}>
        <a href="/" aria-label={HOME_NAME} className={styles.home}>
          <span className={styles.logo}>
            <img src="/favicon.svg" alt="" width="24" height="24" className={styles.glyph} />
            <span className={`pc-logo-glow ${styles.logoGlow}`} aria-hidden="true" />
          </span>
          <span className={styles.wordmark} translate="no">
            PARA<span data-read-exception="wordmark" className={styles.accent}>COSM</span>
          </span>
        </a>
        <div className={styles.sections}>
          <TabBar active={activeTab} onTabChange={onTabChange} scenario={scenario}
            moreFirstLine={visitor?.long ?? null} headerFold={fold} />
        </div>
        <div className={styles.visitor} role="status" aria-live="polite" aria-atomic="true"
          data-reserve-long={NO_FREE_RUNS.long} data-reserve-short={NO_FREE_RUNS.short}>
          <span className={styles.shortState}>{visitor?.short}</span>
          <span className={styles.longState}>{visitor?.long}</span>
        </div>
        <div className={styles.actions}>
          <button
            ref={howItWorksKeyRef}
            type="button"
            onClick={onHowItWorks}
            className={`${styles.button} ${styles.help}`}
            aria-label={HOW_IT_WORKS}
            aria-expanded={howItWorksOpen}
            aria-haspopup="dialog"
          >
            <span className={styles.helpLabel}>{HOW_IT_WORKS}</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" className={`${styles.helpIcon} ${styles.glyph}`}
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M9 8a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.3-1.5 2.4v1m0 4h.01" />
            </svg>
          </button>
          {runExists && (
            <div ref={overflowRootRef} className={styles.overflowAnchor}>
              <button
                type="button"
                onClick={() => setOverflowOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={overflowOpen}
                aria-label={overflowOpen ? 'Close run actions' : 'Open run actions menu'}
                title="Save · Share · Copy · Wipe"
                className={styles.iconButton}
              >
                ⋯
              </button>
              {overflowOpen && (
                <div
                  ref={overflowMenuRef}
                  role="menu"
                  tabIndex={-1}
                  className={styles.overflowMenu}
                  onKeyDown={moveInRunActions}
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
                      className={styles.overflowItem}
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
                      className={styles.overflowItem}
                      title="Delete the server's stored runs, saved sessions and run output files, for every visitor. Pages showing a finished run this server holds, this one included, empty their view of it."
                    >
                      Delete server data
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setTheme(dark ? 'light' : 'dark')}
            className={`${styles.button} ${styles.iconButton}`}
            aria-label={dark ? SWITCH_TO_LIGHT : SWITCH_TO_DARK}
          >
            <LookMark dark={dark} />
          </button>
        </div>
      </div>
    </header>
  );
}
