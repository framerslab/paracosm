import { Fragment, useId, type CSSProperties, type ReactNode } from 'react';
import { STATIONS, glyphFor, type AttemptMark, type LineModel, type StationId, type StationState } from './forgeLine';
import { LINE_STATE_WORDS, OUTCOME_WORDS, STATION_WORDS, STATIONS_LIST_NAME, attemptRow, stationName } from './forgeWords';
import { OutcomeGlyph } from './OutcomeGlyph';
import styles from './ForgeLine.module.scss';

export interface ForgeLineProps {
  model: LineModel;
  /** 'trace': the line down the trace, each station a button. 'row': the same line in small on a toolbox row, drawn only. */
  size: 'trace' | 'row';
  /** The line's colour: lineColour() gives the actor's run colour on a pair and the quiet tone from three actors. */
  colour: string;
  /** The stations whose evidence is open (trace size only). */
  open?: ReadonlySet<StationId>;
  /** Called when a station's button is pressed (trace size only). */
  onToggle?: (station: StationId) => void;
  /** The one-line result beside each station's name while it is closed. */
  stationResult?: (station: StationId) => ReactNode;
  /** A station's evidence, shown in place when it is open; a station with none has nothing to open. */
  renderEvidence?: (station: StationId) => ReactNode;
  /** Shows another attempt of the tool: its row where it leaves the line is a link to it (trace size only). */
  onAttempt?: (attempt: number) => void;
  /** The address a row's link names; the page's own while a tool's address is not written. */
  attemptHref?: (attempt: number) => string;
}

const forgeGot = (state: StationState | undefined) => state === 'reached' || state === 'stopped';

/** The rail from a station to the next: solid in the line's colour where the forge got there, dashed where it did not. */
const railTo = (next: StationState | undefined) => (next === undefined ? undefined : forgeGot(next) ? 'solid' : 'dashed');

/** The station's cell: filled where reached, the outcome's glyph where the forge stopped, hollow or dashed otherwise. */
function Cell({ model, station, size }: { model: LineModel; station: StationId; size: 10 | 20 }) {
  const state = model.stations[station];
  if (state === 'stopped') {
    const stop = model.stop;
    return <OutcomeGlyph kind={stop && stop.station === station ? stop.glyph : 'didNotPass'} size={size} />;
  }
  return <span className={styles.cell} data-cell={state} />;
}

/**
 * Another attempt's row where it leaves the line: one quiet row in the ink,
 * that attempt's glyph, its words and a chevron, and a link to that attempt.
 */
function AttemptRow({ mark, onAttempt, href }: { mark: AttemptMark; onAttempt?: (attempt: number) => void; href: string }) {
  const kind = glyphFor(mark.outcome);
  return (
    <div className={styles.fork} data-fork={mark.attempt}>
      <a
        className={styles.forkLink}
        href={href}
        data-fork-attempt={mark.attempt}
        onClick={(e) => {
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onAttempt?.(mark.attempt);
        }}
      >
        <OutcomeGlyph kind={kind} size={20} />
        <span className={styles.forkWords}>{attemptRow(mark.attempt, OUTCOME_WORDS[kind])}</span>
        <svg className={styles.chevron} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M6 3.5L10.5 8L6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </div>
  );
}

/** The one line a station says while closed when its caller gives none: why it has nothing to open. */
function defaultResult(state: StationState): ReactNode {
  if (state === 'notReached') return LINE_STATE_WORDS.notReached;
  if (state === 'unknown') return LINE_STATE_WORDS.unknown;
  return null;
}

/**
 * The forge's five stations as the living grid's square cells on a 2 px line.
 *
 * At trace size the line runs down the trace's left side as a list named
 * "The forge's stations": each station is a button, named by its station
 * and state, that opens its evidence in place, a region named by the
 * station, and closes it again. A
 * station the forge never reached, an unknown one, or one with no evidence
 * has nothing to open: it is marked aria-disabled, its one line says why,
 * and it is left out of the tab order.
 *
 * Every other attempt of the tool leaves the line at the station where it
 * stopped, as one row in the ink with its glyph, its words ("Attempt 1 ·
 * Did not pass") and a chevron: each earlier attempt a short spur, the next
 * attempt the branch. Each row is a link that shows that attempt.
 *
 * At row size the same line is drawn in small and hidden from screen
 * readers: the row's own button names the tool and its outcome. A tool
 * forged again forks after the station where its earlier attempts left the
 * line, each earlier attempt a small glyph under the shown attempt's line.
 */
export function ForgeLine({ model, size, colour, open, onToggle, stationResult, renderEvidence, onAttempt, attemptHref }: ForgeLineProps) {
  const baseId = useId();
  const lineStyle = { '--line': colour } as CSSProperties;

  if (size === 'row') {
    return (
      <span className={styles.row} style={lineStyle} aria-hidden="true" data-forge-line="row">
        {STATIONS.map((station, i) => {
          const spursHere = model.spurs.filter((s) => s.station === station);
          return (
            <Fragment key={station}>
              {i > 0 && <span className={styles.segment} data-rail={railTo(model.stations[station])} />}
              <span className={styles.rowStation} data-station={station} data-state={model.stations[station]}>
                <Cell model={model} station={station} size={10} />
                {spursHere.length > 0 && (
                  <span className={styles.spur} data-spurs={spursHere.length}>
                    {spursHere.map((s) => (
                      <OutcomeGlyph key={s.attempt} kind={glyphFor(s.outcome)} size={10} />
                    ))}
                  </span>
                )}
              </span>
            </Fragment>
          );
        })}
      </span>
    );
  }

  return (
    <ol className={styles.trace} style={lineStyle} role="list" aria-label={STATIONS_LIST_NAME} data-forge-line="trace">
      {STATIONS.map((station, i) => {
        const state = model.stations[station];
        const evidence = renderEvidence?.(station);
        const hasEvidence = evidence !== undefined && evidence !== null && evidence !== false;
        const openable = forgeGot(state) && hasEvidence;
        const isOpen = openable && !!open?.has(station);
        const result = stationResult?.(station) ?? defaultResult(state);
        const resultId = `${baseId}-${station}-result`;
        const evidenceId = `${baseId}-${station}-evidence`;
        const nameId = `${baseId}-${station}-name`;
        const quiet = state === 'notReached' || state === 'unknown';
        // The attempts that leave the line here: each earlier one, then the next one.
        const forks = [
          ...model.spurs.filter((s) => s.station === station),
          ...(model.branch && model.branch.station === station ? [model.branch] : []),
        ];
        return (
          <li
            key={station}
            className={styles.station}
            data-station={station}
            data-state={state}
            data-open={isOpen || undefined}
            data-rail={railTo(model.stations[STATIONS[i + 1]])}
          >
            <button
              type="button"
              className={styles.stationKey}
              aria-label={stationName(station, state)}
              aria-expanded={openable ? isOpen : undefined}
              aria-controls={openable ? evidenceId : undefined}
              aria-disabled={openable ? undefined : true}
              aria-describedby={!openable && result != null ? resultId : undefined}
              tabIndex={openable ? undefined : -1}
              onClick={openable ? () => onToggle?.(station) : undefined}
            >
              <span className={styles.mark} aria-hidden="true">
                <Cell model={model} station={station} size={20} />
              </span>
              <span id={nameId} className={styles.name} data-text="heading">{STATION_WORDS[station]}</span>
            </button>
            {!isOpen && result != null && (
              <div id={resultId} className={styles.result} data-quiet={quiet || undefined} data-text={quiet ? undefined : 'body'}>
                {result}
              </div>
            )}
            {openable && (
              <div id={evidenceId} className={styles.evidence} role="region" aria-labelledby={nameId} hidden={!isOpen}>
                {isOpen ? evidence : null}
              </div>
            )}
            {forks.map((mark) => (
              <AttemptRow
                key={mark.attempt}
                mark={mark}
                onAttempt={onAttempt}
                href={attemptHref ? attemptHref(mark.attempt) : '#'}
              />
            ))}
          </li>
        );
      })}
    </ol>
  );
}
