/**
 * Other scenarios: one list of the server's scenarios under Start. A row
 * shows the scenario's name and the departments a run of it uses, and a
 * press loads it into the first screen above through the server's own
 * switch and a reload; a row never runs a scenario. The bundled scenarios
 * come first, the space and ocean ones leading, then the scenarios this
 * browser compiled or stored, under Yours. The row of the scenario on
 * screen says so and cannot be pressed. The first rows fill whole rows of
 * cards, and Show all opens the rest in place.
 *
 * A list that did not load, a row whose switch failed and a row chosen
 * offline each say so on their own, beside a Try again key or the
 * broken-link mark, and the first screen above is not touched by either. A
 * server with one scenario shows no list. A row of Yours opens its details,
 * where a compiled scenario is renamed or deleted with the admin token.
 *
 * @module paracosm/dashboard/quickstart/first-screen/OtherScenarios
 */
import { useCallback, useEffect, useState } from 'react';
import { useScenarioContext, useScenarioReady } from '../../../App';
import { markScenarioSwitched } from '../../../scenario-sync';
import { useMediaQuery } from '../../viz/grid/useMediaQuery';
import type { CatalogScenario } from '../ScenarioCatalogGrid';
import { ScenarioDetailDrawer } from '../ScenarioDetailDrawer';
import { payer, readLaunchSettings, safeLocalStorage } from './effectiveLaunch';
import { BrokenLinkMark } from './marks';
import { useServerFacts } from './useServerFacts';
import {
  CHOOSE_WHEN_ONLINE,
  ON_SCREEN_NOW,
  OTHER_SCENARIOS,
  SCENARIOS_DID_NOT_LOAD,
  SHOW_FEWER,
  TRY_AGAIN,
  VIEW_DETAIL,
  YOURS,
  departmentsLine,
  loadScenario,
  loadingScenario,
  onScreenSpoken,
  scenarioDidNotLoad,
  showAll,
  trying as TRYING,
  viewDetailSpoken,
} from './words';
import styles from './OtherScenarios.module.scss';

/** The bundled scenarios that lead the list, in this order: the space and ocean ones. */
const LEADING = ['lunar-outpost', 'mars-genesis', 'deep-ocean-station'];

/** Set before the reload a row starts, so the page's heading takes focus once the new scenario shows. */
const FOCUS_HEADING_KEY = 'paracosm:focusScenarioHeading';

/** How many loading shapes stand under the heading until the list arrives. */
const SHAPES = 3;

/** A scenario this browser compiled or stored, listed under Yours. */
const isYours = (row: CatalogScenario): boolean => row.source === 'compiled' || row.source === 'memory';

/** The bundled scenarios with the leading ones first, then Yours, each in the server's order. */
export function orderScenarios(rows: CatalogScenario[]): { bundled: CatalogScenario[]; yours: CatalogScenario[] } {
  const rank = (row: CatalogScenario): number => {
    const at = LEADING.indexOf(row.id);
    return at < 0 ? LEADING.length : at;
  };
  const bundled = rows.filter((row) => !isYours(row)).sort((a, b) => rank(a) - rank(b));
  return { bundled, yours: rows.filter(isYours) };
}

/** The rows shown before Show all: enough to fill whole rows of cards at each width. */
function useShownCount(): number {
  const narrow = useMediaQuery('(min-width: 600px)');
  const desktop = useMediaQuery('(min-width: 1100px)');
  const wide = useMediaQuery('(min-width: 1440px)');
  if (wide) return 4;
  if (desktop) return 3;
  if (narrow) return 4;
  return 3;
}

type ListState = { status: 'loading' } | { status: 'ready'; rows: CatalogScenario[] } | { status: 'error' };
/** What a row is doing after a press: loading its scenario, failed to, or chosen while offline. */
type RowState = { id: string; kind: 'loading' | 'failed' | 'offline' };

export interface OtherScenariosProps {
  /** True from Start's press until the run opens or fails: the run posted is the scenario on screen, so no row loads another. */
  locked?: boolean;
}

export function OtherScenarios({ locked = false }: OtherScenariosProps = {}) {
  const scenario = useScenarioContext();
  const scenarioReady = useScenarioReady();
  const facts = useServerFacts();
  const shown = useShownCount();
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [tryingList, setTryingList] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rowState, setRowState] = useState<RowState | null>(null);
  const [detail, setDetail] = useState<CatalogScenario | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/scenarios');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { scenarios?: CatalogScenario[] };
      setList({ status: 'ready', rows: Array.isArray(body.scenarios) ? body.scenarios : [] });
    } catch {
      setList({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // After a row's reload, the new scenario's name is read: focus goes to the page's heading once it shows.
  useEffect(() => {
    if (!scenarioReady) return;
    let asked = false;
    try {
      asked = sessionStorage.getItem(FOCUS_HEADING_KEY) === '1';
      if (asked) sessionStorage.removeItem(FOCUS_HEADING_KEY);
    } catch {
      return;
    }
    if (!asked) return;
    const heading = document.querySelector<HTMLElement>('[data-testid="run-first-screen"] h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }, [scenarioReady]);

  // Whose keys a run uses decides the departments a row says: on the host's keys, no more than the host's cap.
  const who = payer(facts, readLaunchSettings(safeLocalStorage()).overrides);
  const cap = who === 'host' ? facts.adminConfig.demoCaps?.maxActiveDepartments : undefined;
  const departmentsOf = (row: CatalogScenario): number => {
    const own = typeof row.departments === 'number' ? row.departments : 0;
    return typeof cap === 'number' && cap > 0 ? Math.min(own, cap) : own;
  };

  const choose = async (row: CatalogScenario) => {
    if (locked || rowState?.kind === 'loading') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setRowState({ id: row.id, kind: 'offline' });
      return;
    }
    setRowState({ id: row.id, kind: 'loading' });
    try {
      const res = await fetch('/scenario/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      markScenarioSwitched();
      try { sessionStorage.setItem(FOCUS_HEADING_KEY, '1'); } catch { /* private mode: the heading keeps its place in the order */ }
      window.location.reload();
    } catch {
      setRowState({ id: row.id, kind: 'failed' });
    }
  };

  const retryList = () => {
    if (tryingList) return;
    setTryingList(true);
    void load().finally(() => setTryingList(false));
  };

  const rows = list.status === 'ready' ? list.rows : [];
  // A server with one scenario has no other: no heading and no list.
  if (list.status === 'ready' && rows.length < 2) return null;

  const ordered = orderScenarios(rows);
  const all = [...ordered.bundled, ...ordered.yours];
  const onScreenId = scenarioReady ? scenario.id : null;
  const loadable = all.filter((row) => row.id !== onScreenId).length;
  const visible = new Set((expanded ? all : all.slice(0, shown)).map((row) => row.id));
  const busy = rowState?.kind === 'loading';
  // The rows wait for the scenario above as well, so the row on screen is never marked for the page's
  // fallback, and nothing here is said while the scenario line says its own failure.
  const waiting = !scenarioReady || list.status === 'loading';

  const renderRow = (row: CatalogScenario) => {
    const name = row.name || row.id;
    const departments = departmentsOf(row);
    const figures = departments > 0 ? departmentsLine(departments) : null;
    const state = rowState?.id === row.id ? rowState.kind : null;
    const onScreen = row.id === onScreenId;
    return (
      <li key={row.id} className={styles.row} data-testid="scenario-row" data-scenario={row.id} data-state={onScreen ? 'on-screen' : state ?? 'rest'}>
        {onScreen
          ? (
            <div className={`${styles.card} ${styles.onScreen}`}>
              <span className="sr-only">{onScreenSpoken(name)}</span>
              <span className={styles.name} data-testid="row-name" aria-hidden="true">{name}</span>
              <span className={styles.state} data-testid="row-state" aria-hidden="true">{ON_SCREEN_NOW}</span>
              {figures && <span className={styles.figures} data-testid="row-figures" aria-hidden="true">{figures}</span>}
            </div>
          )
          : (
            <button
              type="button"
              className={styles.card}
              aria-label={loadScenario(name)}
              aria-disabled={busy || locked || state === 'failed' ? 'true' : undefined}
              onClick={() => {
                if (busy || locked || state === 'failed') return;
                void choose(row);
              }}
            >
              <span className={styles.name} data-testid="row-name">{name}</span>
              {figures && <span className={styles.figures} data-testid="row-figures">{figures}</span>}
            </button>
          )}
        {state === 'loading' && <p className={styles.line} role="status">{loadingScenario(name)}</p>}
        {state === 'failed' && (
          <div className={styles.problem}>
            <BrokenLinkMark className={styles.mark} />
            <p className={styles.line} role="status">{scenarioDidNotLoad(name)}</p>
            <button
              type="button"
              className={styles.tryAgain}
              onClick={() => { void choose(row); }}
            >
              {TRY_AGAIN}
            </button>
          </div>
        )}
        {state === 'offline' && (
          <div className={styles.problem}>
            <BrokenLinkMark className={styles.mark} />
            <p className={styles.line} role="status">{CHOOSE_WHEN_ONLINE}</p>
          </div>
        )}
        {isYours(row) && (
          <button
            type="button"
            className={styles.detail}
            aria-label={viewDetailSpoken(name)}
            onClick={() => setDetail(row)}
          >
            {VIEW_DETAIL}
          </button>
        )}
      </li>
    );
  };

  const bundledShown = ordered.bundled.filter((row) => visible.has(row.id));
  const yoursShown = ordered.yours.filter((row) => visible.has(row.id));

  return (
    <section className={styles.part} data-testid="other-scenarios" aria-labelledby="other-scenarios-heading">
      <h2 className={styles.heading} id="other-scenarios-heading" data-text="heading">{OTHER_SCENARIOS}</h2>
      {!waiting && list.status === 'error' && (
        <div className={styles.problem} data-testid="scenarios-failed">
          <BrokenLinkMark className={styles.mark} />
          <p className={styles.line} role="status">{SCENARIOS_DID_NOT_LOAD}</p>
          <button
            type="button"
            className={styles.tryAgain}
            onClick={retryList}
            aria-disabled={tryingList ? 'true' : undefined}
          >
            {tryingList ? TRYING : TRY_AGAIN}
          </button>
        </div>
      )}
      {waiting && (
        <ul className={styles.grid} aria-hidden="true">
          {Array.from({ length: SHAPES }, (_, i) => <li key={i} className={styles.shape} data-shape />)}
        </ul>
      )}
      {!waiting && list.status === 'ready' && (
        <>
          <ul className={styles.grid}>{bundledShown.map(renderRow)}</ul>
          {yoursShown.length > 0 && (
            <>
              <h3 className={styles.subheading} data-text="heading">{YOURS}</h3>
              <ul className={styles.grid}>{yoursShown.map(renderRow)}</ul>
            </>
          )}
          {all.length > shown && (
            <button
              type="button"
              className={styles.showAll}
              data-testid="show-all"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? SHOW_FEWER : showAll(loadable)}
            </button>
          )}
        </>
      )}
      <ScenarioDetailDrawer
        scenario={detail}
        showRun={false}
        onRunScenario={() => undefined}
        onClose={() => setDetail(null)}
        onDeleted={(id) => {
          setDetail(null);
          setList((current) => (current.status === 'ready' ? { status: 'ready', rows: current.rows.filter((row) => row.id !== id) } : current));
        }}
        onRenamed={(id, name) => {
          setList((current) => (current.status === 'ready'
            ? { status: 'ready', rows: current.rows.map((row) => (row.id === id ? { ...row, name } : row)) }
            : current));
          setDetail((open) => (open && open.id === id ? { ...open, name } : open));
        }}
      />
    </section>
  );
}
