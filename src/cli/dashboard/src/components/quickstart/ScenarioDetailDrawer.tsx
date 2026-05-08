/**
 * Right-side drawer that opens when the user clicks a scenario card
 * body in {@link ScenarioCatalogGrid}. Shows full meta, complete seed
 * text (no 140-char truncation), department + run-count stats, and
 * the most recent runs of this scenario from the run-history store.
 * The Run-with-N-actors action lives at the bottom so users can browse
 * details and launch without leaving the drawer.
 *
 * Pattern mirrors {@link RunDetailDrawer} in the Library tab — same
 * keyboard handling (Esc to close, Tab traps inside), backdrop click
 * to dismiss, focus restoration on close.
 *
 * @module paracosm/dashboard/quickstart/ScenarioDetailDrawer
 */
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { CatalogScenario } from './ScenarioCatalogGrid';
import styles from './ScenarioDetailDrawer.module.scss';

void React;

/**
 * Per-run summary the drawer renders in the recent-runs section.
 * Field set is the public projection from /api/v1/runs — id +
 * createdAt for the row title, optional actorName / archetype /
 * costUSD / durationMs / mode for the inline detail line. We don't
 * link to the run drawer in the Library tab; the drawer here is
 * purely a "what other people ran on this scenario" preview.
 */
interface RecentRunRow {
  runId: string;
  createdAt: string;
  actorName?: string;
  actorArchetype?: string;
  costUSD?: number;
  durationMs?: number;
  mode?: string;
}

export interface ScenarioDetailDrawerProps {
  /** Scenario to render. When null, the drawer is closed. */
  scenario: CatalogScenario | null;
  /** Disabled flag from the parent — prevents the Run button click
   *  during a running compile / setup. */
  disabled?: boolean;
  /** Initial actor count for the in-drawer slider. Defaults to 2. */
  initialActorCount?: number;
  /** Fired when the user clicks the drawer's Run button. The parent
   *  is responsible for routing through /scenario/switch + /setup
   *  the same way the catalog card's Run button does. */
  onRunScenario: (id: string, actorCount: number) => void;
  /** Fired on Esc, backdrop click, or close-button click. */
  onClose: () => void;
}

function formatAge(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return new Date(iso).getFullYear().toString();
}

function formatCost(usd?: number): string {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return '—';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatDuration(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  return remS > 0 ? `${m}m ${remS}s` : `${m}m`;
}

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}

export function ScenarioDetailDrawer(props: ScenarioDetailDrawerProps): JSX.Element | null {
  const { scenario, disabled = false, initialActorCount = 2, onRunScenario, onClose } = props;
  const open = scenario !== null;
  const [actorCount, setActorCount] = useState<number>(initialActorCount);
  const [recentRuns, setRecentRuns] = useState<RecentRunRow[]>([]);
  const [recentLoading, setRecentLoading] = useState<boolean>(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Pull recent runs whenever the drawer opens against a new scenario.
  // Cap at 5 — drawer real estate is finite and the Library tab is
  // the canonical browse-all-runs surface.
  useEffect(() => {
    if (!scenario) {
      setRecentRuns([]);
      setRecentError(null);
      return;
    }
    let cancelled = false;
    setRecentLoading(true);
    setRecentError(null);
    fetch(`/api/v1/runs?scenario=${encodeURIComponent(scenario.id)}&limit=5`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as { runs?: RecentRunRow[] };
        if (cancelled) return;
        setRecentRuns(body.runs ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setRecentError(err instanceof Error ? err.message : String(err));
        setRecentRuns([]);
      })
      .finally(() => {
        if (!cancelled) setRecentLoading(false);
      });
    return () => { cancelled = true; };
  }, [scenario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open / close focus management. Mirrors RunDetailDrawer in Library.
  useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => {
        const target = drawerRef.current?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        target?.focus();
      });
    } else {
      lastFocusedRef.current?.focus();
    }
  }, [open]);

  // Keyboard: Esc closes; Tab keeps focus inside the drawer.
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const focusables = getFocusableElements(drawerRef.current);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !drawerRef.current?.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!scenario) return null;

  const sliderId = 'scenario-detail-actor-count';

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} role="presentation" />
      <aside
        ref={drawerRef}
        className={`${styles.drawer} ${open ? styles.open : ''}`}
        role="dialog"
        aria-label={`Scenario detail: ${scenario.name}`}
        aria-modal="true"
      >
        <header className={styles.header}>
          <button
            type="button"
            onClick={onClose}
            className={styles.closeBtn}
            aria-label="Close scenario detail"
          >
            ×
          </button>
          <span className={styles.sourceBadge} data-source={scenario.source ?? 'other'}>
            {sourceLabel(scenario.source)}
          </span>
        </header>

        <section className={styles.summary}>
          <h2 className={styles.name}>{scenario.name}</h2>
          {scenario.description && (
            <p className={styles.description}>{scenario.description}</p>
          )}
          <dl className={styles.metaGrid}>
            {typeof scenario.runCount === 'number' && (
              <div className={styles.meta}>
                <dt>Total runs</dt>
                <dd>{scenario.runCount.toLocaleString()}</dd>
              </div>
            )}
            {typeof scenario.departments === 'number' && (
              <div className={styles.meta}>
                <dt>Departments</dt>
                <dd>{scenario.departments}</dd>
              </div>
            )}
            {scenario.compiledAt && (
              <div className={styles.meta}>
                <dt>Compiled</dt>
                <dd title={scenario.compiledAt}>{formatAge(scenario.compiledAt)}</dd>
              </div>
            )}
            <div className={styles.meta}>
              <dt>Source</dt>
              <dd>{sourceLabel(scenario.source)}</dd>
            </div>
          </dl>
        </section>

        {scenario.seedText && (
          <section className={styles.seedSection} aria-labelledby="scenario-detail-seed-heading">
            <h3 className={styles.sectionHeading} id="scenario-detail-seed-heading">
              Seed prompt
            </h3>
            <p className={styles.seedHint}>
              Original brief that compile-from-seed turned into this scenario. Truncated to 1KB at
              persist time so very long sources read as their leading section.
            </p>
            <pre className={styles.seedBody}>{scenario.seedText}</pre>
          </section>
        )}

        <section className={styles.recentSection} aria-labelledby="scenario-detail-recent-heading">
          <h3 className={styles.sectionHeading} id="scenario-detail-recent-heading">
            Recent runs
          </h3>
          {recentLoading && <p className={styles.statusLine}>Loading recent runs…</p>}
          {recentError && !recentLoading && (
            <p className={`${styles.statusLine} ${styles.error}`} role="alert">
              Failed to load recent runs: {recentError}
            </p>
          )}
          {!recentLoading && !recentError && recentRuns.length === 0 && (
            <p className={styles.statusLine}>No runs yet on this scenario.</p>
          )}
          {recentRuns.length > 0 && (
            <ul className={styles.recentList} role="list">
              {recentRuns.map((r) => (
                <li key={r.runId} className={styles.recentRow}>
                  <span className={styles.recentTitle}>
                    {r.actorName ?? 'Unknown leader'}
                    {r.actorArchetype && (
                      <span className={styles.recentArchetype}> · {r.actorArchetype}</span>
                    )}
                  </span>
                  <span className={styles.recentMeta}>
                    {formatAge(r.createdAt)} · {formatCost(r.costUSD)} · {formatDuration(r.durationMs)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className={styles.footer}>
          <div className={styles.actorRow}>
            <label htmlFor={sliderId} className={styles.actorLabel}>
              Actors
            </label>
            <input
              id={sliderId}
              type="range"
              min={1}
              max={300}
              value={actorCount}
              onChange={(e) => setActorCount(parseInt(e.target.value, 10))}
              disabled={disabled}
              className={styles.actorSlider}
              aria-label="Number of parallel actors"
            />
            <span className={styles.actorValue}>{actorCount}</span>
          </div>
          <button
            type="button"
            className={styles.runButton}
            onClick={() => onRunScenario(scenario.id, actorCount)}
            disabled={disabled}
            aria-label={`Run ${actorCount} actor${actorCount === 1 ? '' : 's'} against ${scenario.name}`}
          >
            Run {actorCount} {actorCount === 1 ? 'actor' : 'actors'} →
          </button>
        </footer>
      </aside>
    </>
  );
}

function sourceLabel(source?: string): string {
  if (source === 'builtin') return 'Built-in';
  if (source === 'disk') return 'Saved';
  if (source === 'compiled') return 'Custom';
  if (source === 'memory') return 'Memory';
  return source ?? 'Unknown';
}
