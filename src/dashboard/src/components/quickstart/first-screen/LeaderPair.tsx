/**
 * The two leaders of a pair, before the run starts: each leader's place
 * figure, name, title, six scores as bars with their figures, and its
 * written orders whole. No picture of a leader, and no colony field: the
 * colony shows once, in the shared panel above.
 *
 * From 1,100 px the two cards stand side by side, each score at the same
 * height on both, which is the pair's comparison. Under 1,100 px one card
 * shows at a time under a switch of two keys, and one table holds both
 * leaders' scores, a column a leader, so the pair still compares with no
 * press. The switch key carries the leader's place and name, so the card
 * under it does not repeat them.
 *
 * A leader's orders are shown byte for byte as the scenario holds them. A
 * scenario with no written leaders shows two cards named Leader 1 and
 * Leader 2 with empty score tracks, and says Paracosm writes them on Start.
 * Until the scenario has loaded, shapes of the cards' size stand in their
 * place.
 *
 * @module paracosm/dashboard/quickstart/first-screen/LeaderPair
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useScenarioContext, useScenarioReady } from '../../../App';
import type { ScenarioClientPayload } from '../../../hooks/useScenario';
import { useMediaQuery } from '../../viz/grid/useMediaQuery';
import { SectionMark } from './marks';
import { ScoreBar, ScoreRows, TRAIT_ORDER, readScores, scoreFigure, traitShown, type HexacoTrait } from './ScoreRows';
import {
  HEXACO_NOTE,
  LEADERS_SPOKEN,
  LOADING_LEADER,
  MIDDLE_BAND,
  NO_WRITTEN_LEADERS,
  ORDERS_MARK,
  SCORES_MARK,
  placeSpoken,
  showLeader,
  unnamedLeader,
  writesAllLeaders,
} from './words';
import styles from './LeaderPair.module.scss';

/** From this width the two cards stand side by side. */
const SIDE_BY_SIDE_QUERY = '(min-width: 1100px)';

/** One of the pair, as its card shows it. */
interface PairLeader {
  /** Its place in the run, from 1. */
  place: number;
  name: string;
  /** False for a leader the scenario does not write: the name is its place, and it has no title, scores or orders. */
  written: boolean;
  title: string;
  scores: Partial<Record<HexacoTrait, number>> | null;
  orders: string;
}

/**
 * The pair a run of this scenario starts with: the first two leaders of the
 * scenario's first preset, as the launch reads them. A place the scenario
 * writes no leader for is named by its place.
 */
export function pairOf(scenario: Pick<ScenarioClientPayload, 'presets'>): PairLeader[] {
  const written = scenario.presets[0]?.leaders ?? scenario.presets[0]?.actors ?? [];
  return [0, 1].map((i) => {
    const leader = written[i];
    const place = i + 1;
    if (!leader) return { place, name: unnamedLeader(place), written: false, title: '', scores: null, orders: '' };
    return {
      place,
      name: leader.name,
      written: true,
      title: leader.archetype ?? '',
      scores: readScores(leader.hexaco),
      orders: leader.instructions ?? '',
    };
  });
}

/** A short capital mark over a block, led by the section triangle. */
function Mark({ id, children }: { id?: string; children: string }) {
  return (
    <h3 id={id} className={styles.mark}>
      <SectionMark className={styles.triangle} />
      <span>{children}</span>
    </h3>
  );
}

/** A leader's written orders, whole, with the note under them; or why there are none. */
function Orders({ leader, noneWritten }: { leader: PairLeader; noneWritten: boolean }) {
  if (!leader.written) {
    return noneWritten
      ? <p className={styles.noLeaders} data-text="body" data-testid="no-written-leaders">{NO_WRITTEN_LEADERS}</p>
      : null;
  }
  if (!leader.orders) return null;
  return (
    <>
      <Mark>{ORDERS_MARK}</Mark>
      <blockquote className={styles.ordersText} data-text="body" data-testid="leader-orders">{leader.orders}</blockquote>
      {leader.scores && <p className={styles.note} data-testid="hexaco-note">{HEXACO_NOTE}</p>}
    </>
  );
}

/** A leader's card from the desktop width: an article named by the leader's name. */
export function LeaderCard({ leader, noneWritten }: { leader: PairLeader; noneWritten: boolean }) {
  const nameId = useId();
  return (
    <article className={styles.card} aria-labelledby={nameId}>
      <header className={styles.head} data-testid="leader-head">
        {/* A leader named by its place alone shows no separate figure; the column stays, so every name starts at the same line. */}
        <span className={styles.place} data-testid="leader-place" aria-hidden="true">{leader.written ? leader.place : ''}</span>
        {leader.written && <span className="sr-only">{placeSpoken(leader.place)}</span>}
        <h2 id={nameId} className={styles.name} data-text="heading" translate="no">{leader.name}</h2>
        {leader.title && <p className={styles.title} data-testid="leader-title">{leader.title}</p>}
      </header>
      <div className={styles.scores}>
        <Mark>{SCORES_MARK}</Mark>
        <p className={styles.band} data-testid="middle-band">{MIDDLE_BAND}</p>
        <ScoreRows scores={leader.scores} label={`${leader.name}, ${SCORES_MARK.toLowerCase()}`} stackWide />
      </div>
      <div className={styles.orders}>
        <Orders leader={leader} noneWritten={noneWritten} />
      </div>
    </article>
  );
}

/** The two keys that choose which leader's card shows, under 1,100 px. */
export function LeaderSwitch({ pair, shown, onShow, tabId, panelId }: {
  pair: PairLeader[];
  shown: number;
  onShow: (index: number) => void;
  tabId: (index: number) => string;
  panelId: string;
}) {
  const keys = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = pair.length - 1;
    const to = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : -1;
    if (to < 0) return;
    event.preventDefault();
    onShow(to);
    keys.current[to]?.focus();
  };
  return (
    <div className={styles.switch} role="tablist" data-row="leader switch">
      {pair.map((leader, i) => (
        <button
          key={leader.place}
          ref={(el) => { keys.current[i] = el; }}
          type="button"
          role="tab"
          id={tabId(i)}
          className={styles.key}
          aria-selected={shown === i}
          aria-controls={panelId}
          aria-label={showLeader(leader.name, leader.written ? leader.place : undefined)}
          data-shown={shown === i ? 'true' : 'false'}
          onClick={() => onShow(i)}
          onKeyDown={(event) => move(event, i)}
        >
          {leader.written && <span className={styles.keyPlace}>{leader.place}</span>}
          {leader.written && ' '}
          <span className={styles.keyName} translate="no">{leader.name}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Both leaders' six scores in one table under 1,100 px: a row a score, a
 * column a leader. As a loading shape (`shape`), the same table with every
 * word drawn over, so it keeps the table's size.
 */
export function PairScoreTable({ pair, shape = false }: { pair: PairLeader[]; shape?: boolean }) {
  const markId = useId();
  const word = (text: string) => (shape ? <span className={styles.shape} data-shape>{text}</span> : text);
  return (
    <div className={styles.scores}>
      {shape ? <p className={styles.mark}>{word(SCORES_MARK)}</p> : <Mark id={markId}>{SCORES_MARK}</Mark>}
      <p className={styles.band} data-testid={shape ? undefined : 'middle-band'}>{word(MIDDLE_BAND)}</p>
      <table className={styles.table} aria-labelledby={shape ? undefined : markId}>
        <thead>
          <tr>
            <td className={styles.corner} />
            {pair.map((leader) => (
              <th key={leader.place} scope="col" className={styles.colHead}>
                {!shape && leader.written && <span className={styles.headPlace}>{leader.place}</span>}
                {!shape && leader.written && ' '}
                <span translate="no">{word(leader.name)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TRAIT_ORDER.map((trait) => (
            <tr key={trait} data-score={trait}>
              <th scope="row" className={styles.rowHead}>{word(traitShown(trait))}</th>
              {pair.map((leader) => {
                const score = leader.scores?.[trait];
                return (
                  <td key={leader.place} className={styles.cell}>
                    <span className={styles.cellInner}>
                      {score !== undefined && <span className={styles.cellFigure} data-testid="score-figure">{scoreFigure(score)}</span>}
                      {score === undefined && shape && <span className={styles.cellFigure}>{word('0.00')}</span>}
                      <ScoreBar score={score} short />
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The pair the loading shapes are drawn over: two leaders of no name yet. */
const SHAPE_PAIR: PairLeader[] = [1, 2].map((place) => ({
  place,
  name: LOADING_LEADER.name,
  written: false,
  title: LOADING_LEADER.title,
  scores: null,
  orders: '',
}));

/** The loading shape of one card: a mark, the lines of text and six empty tracks, at the card's size. */
function CardShape({ sideBySide }: { sideBySide: boolean }) {
  const shape = (words: string) => <span className={styles.shape} data-shape>{words}</span>;
  return (
    <div className={`${styles.card} ${sideBySide ? '' : styles.shown}`} data-leader-shape aria-hidden="true">
      <div className={styles.head}>
        {sideBySide && <span className={styles.place}>{shape('0')}</span>}
        {sideBySide && <p className={styles.name}>{shape(LOADING_LEADER.name)}</p>}
        <p className={styles.title}>{shape(LOADING_LEADER.title)}</p>
      </div>
      {sideBySide
        ? (
          <div className={styles.scores}>
            <p className={styles.mark}>{shape(SCORES_MARK)}</p>
            <p className={styles.band}>{shape(MIDDLE_BAND)}</p>
            <ScoreRows scores={null} label="" stackWide />
          </div>
        )
        : <PairScoreTable pair={SHAPE_PAIR} shape />}
      <div className={styles.orders}>
        <p className={styles.mark}>{shape(ORDERS_MARK)}</p>
        <p className={styles.ordersText}>{shape(LOADING_LEADER.orders)}</p>
        <p className={styles.note}>{shape(HEXACO_NOTE)}</p>
      </div>
    </div>
  );
}

export interface LeaderPairProps {
  /** How many leaders the run takes: from 3, one row says Paracosm writes them all when the run starts. */
  size?: number;
}

/** The pair of leaders: two cards side by side from 1,100 px, one card under a switch below it. */
export function LeaderPair({ size = 2 }: LeaderPairProps) {
  const scenario = useScenarioContext();
  const ready = useScenarioReady();
  const sideBySide = useMediaQuery(SIDE_BY_SIDE_QUERY);
  const [shown, setShown] = useState(0);
  const baseId = useId();
  const tabId = (index: number) => `${baseId}-leader-${index + 1}`;
  const panelId = `${baseId}-card`;

  if (!ready) {
    return (
      <section className={styles.leaders} data-testid="leaders" aria-label={LEADERS_SPOKEN} data-loading>
        {sideBySide
          ? (
            <div className={styles.pair}>
              <CardShape sideBySide />
              <CardShape sideBySide />
            </div>
          )
          : (
            <>
              <div className={styles.switch} aria-hidden="true">
                <span className={styles.key}><span className={styles.shape} data-shape>{LOADING_LEADER.name}</span></span>
                <span className={styles.key}><span className={styles.shape} data-shape>{LOADING_LEADER.name}</span></span>
              </div>
              <CardShape sideBySide={false} />
            </>
          )}
      </section>
    );
  }

  const pair = pairOf(scenario);
  const noneWritten = pair.every((leader) => !leader.written);
  // A run of 3 or more keeps the two written leaders on the screen and says what the run does with them.
  const writesAll = size > 2
    ? <p className={styles.writesAll} data-text="body" data-testid="writes-all">{writesAllLeaders(size)}</p>
    : null;

  if (sideBySide) {
    return (
      <section className={styles.leaders} data-testid="leaders" aria-label={LEADERS_SPOKEN}>
        {writesAll}
        <div className={styles.pair}>
          {pair.map((leader) => <LeaderCard key={leader.place} leader={leader} noneWritten={noneWritten} />)}
        </div>
      </section>
    );
  }

  const at = Math.min(shown, pair.length - 1);
  const leader = pair[at];
  return (
    <section className={styles.leaders} data-testid="leaders" aria-label={LEADERS_SPOKEN}>
      {writesAll}
      <LeaderSwitch pair={pair} shown={at} onShow={setShown} tabId={tabId} panelId={panelId} />
      <div className={`${styles.card} ${styles.shown}`} role="tabpanel" id={panelId} aria-label={leader.name}>
        {leader.title && (
          <div className={styles.head} data-testid="leader-head">
            <p className={styles.title} data-testid="leader-title">{leader.title}</p>
          </div>
        )}
        <PairScoreTable pair={pair} />
        <div className={styles.orders}>
          <Orders leader={leader} noneWritten={noneWritten} />
        </div>
      </div>
    </section>
  );
}
