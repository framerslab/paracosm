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

/**
 * Trimmed scenario detail returned by `GET /scenarios/:id`. The
 * drawer only renders the fields it actually shows (presets +
 * departments). Server-side projection drops hooks + knowledge
 * topics + the full names registry to keep the response small.
 */
interface ScenarioDetail {
  id: string;
  name: string;
  shortName?: string;
  description?: string;
  source?: string;
  compiledAt?: string;
  seedText?: string | null;
  runCount?: number;
  defaultTurns?: number;
  defaultPopulation?: number;
  presets: Array<{
    id: string;
    label?: string;
    leaders: Array<{
      name: string;
      archetype: string;
      unit?: string;
      hexaco?: Record<string, number>;
      instructions?: string;
    }>;
  }>;
  departments: Array<{
    id: string;
    label: string;
    role?: string;
    icon?: string;
  }>;
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
  /** Optional: fires after a successful admin delete so the parent
   *  can remove the scenario from its in-memory catalog list and
   *  close the drawer without a full /scenarios refetch. */
  onDeleted?: (id: string) => void;
  /** Optional: fires after a successful rename so the parent can
   *  patch the in-memory catalog list with the new label.name and
   *  every card / dropdown immediately reflects the change. */
  onRenamed?: (id: string, newName: string) => void;
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
  const { scenario, disabled = false, initialActorCount = 2, onRunScenario, onClose, onDeleted, onRenamed } = props;
  const open = scenario !== null;
  const [actorCount, setActorCount] = useState<number>(initialActorCount);
  const [recentRuns, setRecentRuns] = useState<RecentRunRow[]>([]);
  const [recentLoading, setRecentLoading] = useState<boolean>(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  // Per-scenario detail (presets + departments) loaded lazily via
  // GET /scenarios/:id. Kept separate from the catalog summary so
  // the drawer doesn't block on a heavy fetch when it opens — it
  // shows the summary fields immediately and renders presets +
  // departments as they arrive.
  const [detail, setDetail] = useState<ScenarioDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Inline rename state. Shows the editable form on the name row
  // when the user clicks the pencil affordance. `editingName` holds
  // the in-progress text; commit on Enter / Save, revert on Esc /
  // Cancel. `renaming` covers the in-flight POST so the UI can
  // gate Save during the round-trip.
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [editingName, setEditingName] = useState<string>('');
  const [renaming, setRenaming] = useState<boolean>(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  // Local override of the displayed name so the rename is reflected
  // immediately, before the catalog 30s poll refreshes upstream
  // state. Resets when the drawer reopens against a different id.
  const [displayName, setDisplayName] = useState<string | null>(null);
  useEffect(() => {
    setDisplayName(null);
    setIsEditingName(false);
    setRenameError(null);
  }, [scenario?.id]);
  // Rename is only allowed for compile-from-seed scenarios server-
  // side; reflect that in the UI so users don't see a broken pencil
  // affordance on builtins / curated drafts.
  const canRename = scenario?.source === 'compiled';
  // Admin delete affordance. Visible only when the operator has an
  // admin token in localStorage AND the scenario is a 'compiled'
  // source (auto-persisted from compile-from-seed). Builtins + disk-
  // tracked scenarios are protected server-side too, but hiding the
  // button up front keeps the drawer chrome clean for anonymous
  // public visitors who'd never have a working delete path anyway.
  const [adminToken, setAdminToken] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    try {
      const t = localStorage.getItem('paracosm:adminToken');
      setAdminToken(t && t.length > 0 ? t : null);
    } catch {
      setAdminToken(null);
    }
  }, [open]);
  const canDelete = !!adminToken && scenario?.source === 'compiled';
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Pull recent runs + scenario detail whenever the drawer opens
  // against a new scenario. Recent runs cap at 5; detail comes from
  // /scenarios/:id which projects only the fields the drawer renders
  // (presets + departments). Both run in parallel because they're
  // independent — recent runs may finish first while detail is still
  // in flight, both render their loading states distinctly.
  useEffect(() => {
    if (!scenario) {
      setRecentRuns([]);
      setRecentError(null);
      setDetail(null);
      return;
    }
    let cancelled = false;
    setRecentLoading(true);
    setRecentError(null);
    setDetailLoading(true);
    setDetail(null);
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
    fetch(`/scenarios/${encodeURIComponent(scenario.id)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ScenarioDetail>;
      })
      .then((body) => {
        if (cancelled) return;
        setDetail(body);
      })
      .catch(() => {
        if (cancelled) return;
        // Silent: drawer still shows summary + recent runs from props.
        // The detail section just doesn't render when the fetch fails.
        setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
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

  const handleStartRename = () => {
    if (!scenario || !canRename) return;
    setEditingName(displayName ?? scenario.name);
    setIsEditingName(true);
    setRenameError(null);
  };

  const handleCancelRename = () => {
    setIsEditingName(false);
    setEditingName('');
    setRenameError(null);
  };

  const handleSaveRename = async () => {
    if (!scenario || renaming) return;
    const trimmed = editingName.trim();
    if (trimmed.length === 0) {
      setRenameError('Name cannot be empty.');
      return;
    }
    if (trimmed === (displayName ?? scenario.name)) {
      // No-op rename — collapse to a successful close.
      setIsEditingName(false);
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      const res = await fetch(`/scenarios/${encodeURIComponent(scenario.id)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string; message?: string }));
        setRenameError(body.message ?? body.error ?? `Rename failed: HTTP ${res.status}`);
        return;
      }
      const body = await res.json() as { id?: string; name?: string };
      const newName = body.name ?? trimmed;
      setDisplayName(newName);
      setIsEditingName(false);
      setEditingName('');
      onRenamed?.(scenario.id, newName);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    if (!scenario || !adminToken || deleting) return;
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(
          `Delete this scenario?\n\n"${scenario.name}"\n\n` +
          'Removes the scenario from disk + the live catalog. Past runs ' +
          'are kept (they live in run-history). Cannot be undone.',
        )
      : false;
    if (!confirmed) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/admin/scenarios/${encodeURIComponent(scenario.id)}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Token': adminToken },
      });
      if (res.status === 401) {
        try { localStorage.removeItem('paracosm:adminToken'); } catch { /* silent */ }
        setDeleteError('Admin token rejected. The stored token has been cleared; re-paste it via dev-tools localStorage to retry.');
        setAdminToken(null);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string; message?: string }));
        setDeleteError(body.message ?? body.error ?? `Delete failed: HTTP ${res.status}`);
        return;
      }
      onDeleted?.(scenario.id);
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

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
          {isEditingName ? (
            <form
              className={styles.nameEditForm}
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveRename();
              }}
            >
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    // stopPropagation: the drawer-level keydown
                    // listener also handles Esc and would otherwise
                    // close the whole drawer when the user just
                    // wanted to cancel the rename. Local-first wins.
                    e.preventDefault();
                    e.stopPropagation();
                    handleCancelRename();
                  }
                }}
                disabled={renaming}
                maxLength={100}
                autoFocus
                className={styles.nameEditInput}
                aria-label="New scenario name"
              />
              <div className={styles.nameEditActions}>
                <button
                  type="submit"
                  className={styles.nameEditSave}
                  disabled={renaming || editingName.trim().length === 0}
                >
                  {renaming ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className={styles.nameEditCancel}
                  onClick={handleCancelRename}
                  disabled={renaming}
                >
                  Cancel
                </button>
              </div>
              {renameError && (
                <p className={styles.nameEditError} role="alert">{renameError}</p>
              )}
            </form>
          ) : (
            <div className={styles.nameRow}>
              <h2 className={styles.name}>{displayName ?? scenario.name}</h2>
              {canRename && (
                <button
                  type="button"
                  className={styles.nameEditBtn}
                  onClick={handleStartRename}
                  aria-label={`Rename ${displayName ?? scenario.name}`}
                  title="Rename scenario"
                >
                  ✎
                </button>
              )}
            </div>
          )}
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

        {/* Leader presets — only renders when the detail fetch
            succeeded AND the scenario actually ships with presets.
            Compiled-from-seed scenarios usually do; some hand-crafted
            disk drafts don't. */}
        {detail && detail.presets.length > 0 && detail.presets[0].leaders.length > 0 && (
          <section className={styles.presetsSection} aria-labelledby="scenario-detail-presets-heading">
            <h3 className={styles.sectionHeading} id="scenario-detail-presets-heading">
              Leader presets
            </h3>
            <p className={styles.sectionHint}>
              Default leader pair the scenario ships with. Picking Run with the slot count below
              fills these in first; extra slots beyond the preset get LLM-generated.
            </p>
            <ul className={styles.presetList} role="list">
              {detail.presets[0].leaders.map((leader, idx) => (
                <li key={`${leader.name}-${idx}`} className={styles.presetCard}>
                  <div className={styles.presetHeader}>
                    <span className={styles.presetName}>{leader.name}</span>
                    {leader.archetype && (
                      <span className={styles.presetArchetype}>{leader.archetype}</span>
                    )}
                  </div>
                  {leader.unit && (
                    <span className={styles.presetUnit}>{leader.unit}</span>
                  )}
                  {leader.hexaco && Object.keys(leader.hexaco).length > 0 && (
                    <ul className={styles.hexacoList} aria-label={`HEXACO profile for ${leader.name}`}>
                      {Object.entries(leader.hexaco).slice(0, 6).map(([axis, value]) => {
                        const pct = Math.round((Number(value) || 0) * 100);
                        return (
                          <li key={axis} className={styles.hexacoRow}>
                            <span className={styles.hexacoAxis}>
                              {axis.length > 6 ? axis.slice(0, 6) : axis}
                            </span>
                            <span
                              className={styles.hexacoBar}
                              role="img"
                              aria-label={`${axis} ${pct}%`}
                            >
                              <span
                                className={styles.hexacoFill}
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                            <span className={styles.hexacoValue}>{pct}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {leader.instructions && (
                    <p className={styles.presetInstructions} title={leader.instructions}>
                      {leader.instructions.length > 220
                        ? `${leader.instructions.slice(0, 220)}…`
                        : leader.instructions}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Departments — short list of who deliberates per turn. Same
            gate as presets: only renders when detail fetched + array
            non-empty. */}
        {detail && detail.departments.length > 0 && (
          <section className={styles.departmentsSection} aria-labelledby="scenario-detail-depts-heading">
            <h3 className={styles.sectionHeading} id="scenario-detail-depts-heading">
              Departments <span className={styles.sectionCount}>· {detail.departments.length}</span>
            </h3>
            <ul className={styles.deptChips} role="list">
              {detail.departments.map((d) => (
                <li key={d.id} className={styles.deptChip}>
                  {d.icon && <span className={styles.deptIcon} aria-hidden="true">{d.icon}</span>}
                  <span>{d.label}</span>
                  {d.role && <span className={styles.deptRole}>· {d.role}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {detailLoading && !detail && (
          <p className={styles.statusLine} style={{ padding: '0 18px' }}>Loading scenario detail…</p>
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
            disabled={disabled || deleting}
            aria-label={`Run ${actorCount} actor${actorCount === 1 ? '' : 's'} against ${scenario.name}`}
          >
            Run {actorCount} {actorCount === 1 ? 'actor' : 'actors'} →
          </button>
          {canDelete && (
            <>
              <button
                type="button"
                className={styles.deleteButton}
                onClick={handleDelete}
                disabled={deleting || disabled}
                aria-label={`Delete scenario ${scenario.name}`}
              >
                {deleting ? 'Deleting…' : 'Delete (admin)'}
              </button>
              {deleteError && (
                <p className={styles.deleteError} role="alert">{deleteError}</p>
              )}
            </>
          )}
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
