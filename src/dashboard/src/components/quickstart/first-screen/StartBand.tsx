/**
 * Start, the run line and the notice: the one filled key of the Run tab's
 * first screen, what the run it starts is, and who pays for it.
 *
 * The key says the run's length on its second line (and from 3 leaders its
 * size): about how many minutes on the host's keys, or whose keys on the
 * visitor's own key or a self-hosted server. Beside it the run line draws
 * the run's turns to its end word, Verdict for a pair and Report for 3 to
 * 300 leaders. The notice says who pays, how many free runs this internet
 * address has left today and when they reset, and what comes after; from 3
 * leaders up it adds the estimate of what the run costs.
 *
 * One press starts the run. On the host's keys it reads the day's count
 * again first and posts nothing when none is left. The key is inactive from
 * the press until the page opens the run, saying each stage in words:
 * checking, writing the leaders a larger run needs, starting. An inactive
 * key has no fill, and its reason is written in or beside it. A request
 * that fails is said above the key in one sentence beside its mark (no
 * connection, a busy server, every run slot in use, or any other refusal),
 * and the key can then be pressed again. A visitor with a saved run of
 * their own has a link beside Start that replays it.
 *
 * With no free run left on the host's keys, as the count says or as a
 * refused press finds, two paragraphs take the notice's place: the reset
 * time with its zone beside a clock face whose hands show it, then what
 * the visitor can do. A filled key in Start's place replays the visitor's
 * last run, or the team's run of a pair when this browser has none, and
 * calls no model; with neither, no filled key stands there. The link to
 * Settings' API key field is under it. A saved-run list that did not load
 * is said in the key's place with a Try again key.
 *
 * The key's bar stays at the bottom edge of the view while its place in
 * the page is below the visible area, above the consent bar when that
 * shows, with the notice's first sentence beside it; once its place is
 * reached it rests there. The bar's height is the same held or resting, so
 * the two never trade places back and forth.
 *
 * @module paracosm/dashboard/quickstart/first-screen/StartBand
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useScenarioContext, useScenarioLoad, useScenarioReady } from '../../../App';
import { createDashboardTabHref } from '../../../tab-routing';
import { buildReplayHref } from '../../layout/LoadMenu.helpers';
import { estimateQuickstartCostUSD } from '../SeedInput.helpers';
import { useMediaQuery } from '../../viz/grid/useMediaQuery';
import {
  effectiveLaunch,
  keyProviderName,
  minutesForTurns,
  modelNames,
  payer,
  providerName,
  readLaunchSettings,
  safeLocalStorage,
  writtenLeaders,
  type EffectiveLaunch,
  type LaunchFailureInput,
  type LoadedRunOptions,
  type Payer,
} from './effectiveLaunch';
import {
  atLimitChoice,
  classifyLaunchFailure,
  clockHands,
  formatResetTime,
  resetClockTime,
  type ClockTime,
  type LaunchFailureKind,
} from './launchFailure';
import { BrokenLinkMark, WarningGlyph } from './marks';
import { useOnline } from './useOnline';
import { noFreeRunLeft, useServerFacts, type ServerFacts, type SessionRow } from './useServerFacts';
import {
  ADD_KEY_IN_SETTINGS,
  AI_AGENTS,
  CLEAR_DRAFT,
  GO_TO_DRAFT,
  COULD_NOT_REACH,
  CHECKING_FREE_RUNS,
  NOTICE_COUNT_UNAVAILABLE,
  NOTICE_FREE,
  NOTICE_SERVER,
  RUN_DID_NOT_START,
  RUN_END,
  SAVED_RUNS_NOT_LOADED,
  SERVER_BUSY,
  SLOTS_IN_USE,
  START,
  STARTING,
  START_WHEN_ONLINE,
  TRY_AGAIN,
  WATCH_LAST_RUN,
  WATCH_TEAM_RUN,
  YOU_ARE_OFFLINE,
  atLimitAfter,
  atLimitReset,
  estimateLine,
  heldDraft,
  noticeAfter,
  noticeCount,
  noticeOwnKey,
  ownKeyPays,
  startSecondLine,
  startSpoken,
  teamRunLine,
  teamRunSpoken,
  trying as TRYING,
  writingLeaders,
} from './words';
import styles from './StartBand.module.scss';

/** Starts the run: the launch the Run tab has always used, told to leave the first screen in view. */
export type StartRun = (size: number, opts: LoadedRunOptions) => Promise<void> | void;

export interface StartBandProps {
  /** How many leaders the run takes. */
  size: number;
  onStart: StartRun;
  /** Told true from the press until the run opens or fails: the size is locked meanwhile. */
  onBusy?: (busy: boolean) => void;
  /**
   * A draft scenario of 200 characters or more waits in Write your own
   * scenario: Start is held, with a link to the draft and a key that clears it.
   */
  draft?: { onGo: () => void; onClear: () => void } | null;
}

/** What the key is doing between a press and the run's opening. */
type Stage = 'checking' | 'writing' | 'starting';
/** What the band shows. */
type BandState = Stage | 'ready' | 'waiting' | 'unloaded' | 'offline' | 'limit' | 'held';
/** The band's layout: phone from 320 px, narrow from 600, tablet from 768, desktop from 1,100, wide from 1,440. */
type Layout = 'phone' | 'narrow' | 'tablet' | 'desktop' | 'wide';

/** The sentence above Start for each failure but the day's limit, which takes the band to its at-limit state. */
const FAILURE_WORDS: Record<Exclude<LaunchFailureKind, 'limit'>, string> = {
  offline: COULD_NOT_REACH,
  busy: SERVER_BUSY,
  slots: SLOTS_IN_USE,
  other: RUN_DID_NOT_START,
};

/** Up to this many turns the run line draws one mark a turn; past it, a ruler. */
const MARKS_UP_TO = 20;
/** The turns the run line's outlines are drawn for while the scenario has not loaded. */
const LOADING_TURNS = 6;

function useLayout(): Layout {
  const narrow = useMediaQuery('(min-width: 600px)');
  const tablet = useMediaQuery('(min-width: 768px)');
  const desktop = useMediaQuery('(min-width: 1100px)');
  const wide = useMediaQuery('(min-width: 1440px)');
  return wide ? 'wide' : desktop ? 'desktop' : tablet ? 'tablet' : narrow ? 'narrow' : 'phone';
}

/**
 * The run's turns drawn in one row to its end word: one mark a turn up to
 * 20 turns, and past that a ruler with a tick every 10 turns and the
 * figures 1 and the last turn at its ends. While Start waits, the marks
 * are empty outlines. Hidden from a screen reader: Start's name gives the
 * turns.
 */
export function RunLine({ turns, end, outline }: { turns: number; end: string; outline: boolean }) {
  const marks = Array.from({ length: turns }, (_, i) => i);
  const ticks: number[] = [];
  for (let turn = 10; turn <= turns; turn += 10) ticks.push(turn);
  return (
    <div className={styles.runLine} data-testid="run-line" data-row="run line" data-outline={outline ? 'true' : 'false'} aria-hidden="true">
      {turns <= MARKS_UP_TO
        ? (
          <span className={styles.marks}>
            {marks.map((i) => (
              <span key={i} className={styles.turn}>
                {i > 0 && <span className={styles.link} />}
                <span className={styles.mark} data-run-mark />
              </span>
            ))}
          </span>
        )
        : (
          <>
            <span className={styles.figure} data-testid="run-first-turn">1</span>
            <span className={styles.ruler} data-testid="run-ruler">
              {ticks.map((turn) => (
                <span key={turn} className={styles.tick} data-run-tick style={{ left: `${((turn - 1) / (turns - 1)) * 100}%` }} />
              ))}
            </span>
            <span className={styles.figure} data-testid="run-last-turn">{turns}</span>
          </>
        )}
      <span className={styles.end} data-testid="run-end">{end}</span>
    </div>
  );
}

/** The id of the held sentence, which describes the held key. */
const HELD_WORDS_ID = 'start-held-words';

/** The key: Start over the run's length, or the words of what it waits for. */
function StartKey({ state, launch, scenarioName, writing, onPress }: {
  state: BandState;
  launch: EffectiveLaunch | null;
  scenarioName: string;
  writing: number;
  onPress: () => void;
}) {
  if (state === 'held') {
    // Held by a waiting draft: no fill, and the sentence beside it says why.
    return (
      <button type="button" className={styles.key} data-testid="start-key" aria-disabled="true" aria-describedby={HELD_WORDS_ID}>
        <span className={styles.words} data-testid="start-words">{START}</span>
      </button>
    );
  }
  if (state === 'ready' && launch) {
    const line = { who: launch.payer, size: launch.size, turns: launch.turns, minutes: minutesForTurns(launch.turns) };
    // The key is named from its content, so its name starts with the word it shows: one line a screen reader reads,
    // the scenario and the length in words it reads well, and the two lines drawn for the eye, hidden from it.
    return (
      <button type="button" className={styles.key} data-testid="start-key" onClick={onPress}>
        <span className="sr-only">{startSpoken({ ...line, scenario: scenarioName })}</span>
        <span className={styles.first} data-testid="start-first" data-read-exception="primary-key-label" aria-hidden="true">{START}</span>
        <span className={styles.second} data-testid="start-second" data-read-exception="primary-key-label" aria-hidden="true">
          {startSecondLine(line)}
        </span>
      </button>
    );
  }
  const words = state === 'offline' ? YOU_ARE_OFFLINE
    : state === 'writing' ? writingLeaders(writing)
      : state === 'starting' ? STARTING
        : state === 'unloaded' ? START
          : CHECKING_FREE_RUNS;
  return (
    <button type="button" className={styles.key} data-testid="start-key" aria-disabled="true">
      <span className={styles.words} data-testid="start-words">{words}</span>
    </button>
  );
}

/**
 * A small clock face with its hands set to the time the day's free runs
 * reset, in the visitor's own zone. It does not move. Hidden from a screen
 * reader: the sentence beside it says the time in words.
 */
export function ClockFace({ time }: { time: ClockTime }) {
  const hands = clockHands(time);
  const shown = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
  return (
    <svg
      className={styles.clock}
      style={{ color: 'var(--text-1)' }}
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-glyph="clock"
      data-testid="reset-clock"
      data-time={shown}
    >
      <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="2" />
      {[0, 90, 180, 270].map((angle) => (
        <line key={angle} x1="20" y1="4" x2="20" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" transform={`rotate(${angle} 20 20)`} />
      ))}
      <line data-hand="hour" x1="20" y1="20" x2="20" y2="11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" transform={`rotate(${hands.hour} 20 20)`} />
      <line data-hand="minute" x1="20" y1="20" x2="20" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" transform={`rotate(${hands.minute} 20 20)`} />
      <circle cx="20" cy="20" r="2" fill="currentColor" />
    </svg>
  );
}

/** The address that replays a saved run on the Watch tab. */
const replayHref = (id: string): string => buildReplayHref(window.location.href, id);

/**
 * The filled key in Start's place at the limit: a link, since it opens the
 * run's replay, which calls no model. The visitor's own last run, or the
 * team's run over its scenario and turn count, named from its content.
 */
function ReplayKey({ choice }: { choice: { kind: 'own' | 'team'; row: SessionRow } }) {
  if (choice.kind === 'own') {
    return (
      <a className={`${styles.key} ${styles.replay}`} data-testid="replay-key" href={replayHref(choice.row.id)}>
        <span className={styles.replayFirst} data-testid="replay-first" data-read-exception="primary-key-label">{WATCH_LAST_RUN}</span>
      </a>
    );
  }
  const about = { scenario: choice.row.scenarioName, turns: choice.row.turnCount };
  const second = teamRunLine(about);
  return (
    <a className={`${styles.key} ${styles.replay}`} data-testid="replay-key" href={replayHref(choice.row.id)}>
      <span className="sr-only">{teamRunSpoken(about)}</span>
      <span className={styles.replayFirst} data-testid="replay-first" data-read-exception="primary-key-label" aria-hidden="true">{WATCH_TEAM_RUN}</span>
      {second && (
        <span className={styles.second} data-testid="replay-second" data-read-exception="primary-key-label" aria-hidden="true">{second}</span>
      )}
    </a>
  );
}

/** The notice in the page: who pays, the day's count and its reset, what comes after, and from 3 leaders the estimate. */
function StartNotice({ who, launch, facts, keyProvider }: {
  who: Payer;
  launch: EffectiveLaunch;
  facts: ServerFacts;
  keyProvider?: string;
}) {
  const paragraph = (testId: string, words: string, status = false) => (
    <p className={styles.sentence} data-text="body" data-testid={testId} role={status ? 'status' : undefined}>{words}</p>
  );
  if (who === 'host') {
    const { rateLimit, sessions } = facts;
    const answer = rateLimit.status === 'ready' ? rateLimit.answer : undefined;
    return (
      <div className={styles.notice} data-testid="start-notice">
        {paragraph('notice-pays', NOTICE_FREE)}
        {answer && paragraph(
          'notice-count',
          noticeCount({ remaining: answer.remaining, limit: answer.limit, resetTime: formatResetTime(answer.resetAt) || undefined }),
          true,
        )}
        {rateLimit.status === 'error' && paragraph('notice-count', NOTICE_COUNT_UNAVAILABLE, true)}
        {paragraph('notice-after', noticeAfter(sessions.rows.length > 0))}
      </div>
    );
  }
  const estimate = launch.size > 2
    ? estimateLine({
      who,
      usd: estimateQuickstartCostUSD(launch.size).toFixed(2),
      provider: launch.provider ? providerName(launch.provider) : undefined,
      models: launch.models ? modelNames(launch.models) : undefined,
    })
    : null;
  return (
    <div className={styles.notice} data-testid="start-notice">
      {paragraph('notice-pays', who === 'own' ? noticeOwnKey(keyProvider) : NOTICE_SERVER)}
      {estimate && paragraph('start-estimate', estimate)}
    </div>
  );
}

/** The nearest part above that scrolls its content up and down. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let above = el.parentElement; above; above = above.parentElement) {
    const flow = getComputedStyle(above).overflowY;
    if (flow === 'auto' || flow === 'scroll') return above;
  }
  return null;
}

/**
 * Whether the bar is held at the view's bottom edge (its place in the page
 * is below the visible area) or rests in its place. Also keeps the bar
 * above the consent bar while that shows, and the view's bottom scroll
 * padding equal to what the bars cover, so no control reached by keyboard
 * is under either.
 */
function useHeldBar(layout: Layout, limited: boolean) {
  const bar = useRef<HTMLDivElement | null>(null);
  const place = useRef<HTMLSpanElement | null>(null);
  const lines = useRef<HTMLDivElement | null>(null);
  const [held, setHeld] = useState(true);
  const measure = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const barEl = bar.current;
    const placeEl = place.current;
    if (!barEl || !placeEl) return undefined;
    const scroller = scrollerOf(barEl);
    const screen = barEl.closest<HTMLElement>('[data-testid="run-first-screen"]');
    let frame = 0;
    let consentWatched: Element | null = null;
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());

    const run = () => {
      frame = 0;
      const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const foot = view.bottom;
      const consent = document.getElementById('pcc');
      if (consent && consent !== consentWatched) {
        consentWatched = consent;
        sizes?.observe(consent);
      }
      const consentBox = consent ? consent.getBoundingClientRect() : null;
      const covered = consentBox && consentBox.height > 0 ? Math.max(0, Math.round(foot - consentBox.top)) : 0;
      // A consent bar that covers more than half the view leaves no room to stand above it: the bar keeps its place.
      const lift = covered > (foot - view.top) / 2 ? 0 : covered;
      barEl.style.setProperty('--start-lift', `${lift}px`);
      const height = barEl.offsetHeight;
      setHeld(placeEl.getBoundingClientRect().top + height > foot - lift + 1);
      // The two lines over the key on a phone stand above the bar's own box.
      const over = lines.current && getComputedStyle(lines.current).position === 'absolute' ? lines.current.offsetHeight : 0;
      if (scroller) scroller.style.scrollPaddingBottom = `${height + over + lift}px`;
    };
    function schedule() {
      if (!frame) frame = requestAnimationFrame(run);
    }
    measure.current = run;
    run();

    scroller?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    sizes?.observe(barEl);
    if (screen) sizes?.observe(screen);
    if (scroller) sizes?.observe(scroller);
    // The consent bar is added to the page a moment after it loads.
    const added = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => schedule());
    added?.observe(document.body, { childList: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      sizes?.disconnect();
      added?.disconnect();
      if (scroller) scroller.style.scrollPaddingBottom = '';
      measure.current = () => {};
    };
    // The bar is another part of the page at each layout, and while no free run is left.
  }, [layout, limited]);

  // The lines show and go with the bar's state; what they cover is measured again.
  useLayoutEffect(() => {
    measure.current();
  }, [held]);

  return { bar, place, lines, held };
}

export function StartBand({ size, onStart, onBusy, draft = null }: StartBandProps) {
  const scenario = useScenarioContext();
  const ready = useScenarioReady();
  const { failed } = useScenarioLoad();
  const facts = useServerFacts();
  const online = useOnline();
  const layout = useLayout();
  const [stage, setStage] = useState<Stage | null>(null);
  const [writing, setWriting] = useState(0);
  const [failure, setFailure] = useState<Exclude<LaunchFailureKind, 'limit'> | null>(null);
  const [trying, setTrying] = useState(false);
  const pressed = useRef(false);

  // Read on each render: the Settings tab may have saved a key since.
  const settings = readLaunchSettings(safeLocalStorage());
  const who = payer(facts, settings.overrides);
  // Whose keys a run uses is known once the visitor holds a key or the server has said whether it is the hosted demo.
  // A read of the settings that failed leaves that unknown: the band waits, as the scenario line's figures do, while
  // the page asks again, and never says a run on the host's keys is one on this server's.
  const payerKnown = who === 'own' || facts.adminConfig.status === 'ready';
  const launch = ready && payerKnown ? effectiveLaunch(facts, scenario, settings, size, who) : null;
  const { rateLimit } = facts;
  const noneLeft = who === 'host' && noFreeRunLeft(facts);
  const { bar, place, lines, held } = useHeldBar(layout, stage === null && online && launch !== null && noneLeft);

  const state: BandState = stage
    ?? (!online ? 'offline'
      : !launch ? (failed && !ready ? 'unloaded' : 'waiting')
        : who === 'host' && rateLimit.status === 'loading' ? 'waiting'
          : noneLeft ? 'limit'
            : draft ? 'held'
              : 'ready');

  // A press is over once the band can be pressed again.
  useEffect(() => {
    if (stage === null) pressed.current = false;
  }, [stage]);

  const press = async () => {
    if (pressed.current || state !== 'ready' || !launch) return;
    pressed.current = true;
    setFailure(null);
    const outcome: { failure: LaunchFailureInput | null } = { failure: null };
    // The reset time of the count this press acts on, kept with a refusal at the day's limit.
    let dayResetAt = rateLimit.status === 'ready' ? rateLimit.answer?.resetAt : undefined;
    try {
      // From here until the run opens or fails, the screen holds as it is: the body posted is this scenario at this size.
      onBusy?.(true);
      if (who === 'host') {
        // The count may have been spent since the page read it: read it again, and post nothing when none is left.
        setStage('checking');
        const fresh = await rateLimit.refresh();
        if (fresh.status === 'ready') dayResetAt = fresh.answer?.resetAt;
        if (fresh.status === 'ready' && fresh.answer?.remaining === 0) {
          setStage(null);
          onBusy?.(false);
          return;
        }
      }
      if (writtenLeaders(scenario).length < size) {
        setWriting(size);
        setStage('writing');
      } else {
        setStage('starting');
      }
      await onStart(size, {
        body: launch.body,
        onStage: (next, count) => {
          if (next === 'writing') setWriting(count ?? size);
          setStage(next);
        },
        onFailure: (f) => { outcome.failure = f; },
      });
    } catch {
      outcome.failure = { networkError: true };
    }
    if (outcome.failure) {
      const { kind } = classifyLaunchFailure({ ...outcome.failure, online: navigator.onLine });
      if (kind === 'limit' && who === 'host') {
        // The day's limit was met since the count was read: say it as the limit, with the reset time read again.
        // The refusal names when the day's count resets; a server that leaves it out leaves the count read before the press.
        const named = outcome.failure.body?.resetAt;
        facts.markLimitMet(typeof named === 'number' && Number.isInteger(named) && named > 0 ? named : dayResetAt);
        void rateLimit.refresh();
      } else {
        setFailure(kind === 'limit' ? 'other' : kind);
      }
      setStage(null);
      onBusy?.(false);
    }
    // With no failure the page is on its way to the run: the key stays as it is until the page leaves.
  };

  const { sessions } = facts;
  const choice = sessions.status === 'ready' ? atLimitChoice(sessions.rows) : { kind: 'neither' as const };

  if (state === 'limit') {
    // The reset time as the server last said it; none when the count could not be read again.
    const resetAt = rateLimit.status === 'ready' ? rateLimit.answer?.resetAt : undefined;
    const time = resetAt === undefined ? undefined : formatResetTime(resetAt) || undefined;
    const clock = resetAt !== undefined && time ? resetClockTime(resetAt) : null;
    const reset = atLimitReset(time);
    const retry = () => {
      if (trying) return;
      setTrying(true);
      void sessions.refresh().finally(() => setTrying(false));
    };
    const settingsHref = `${createDashboardTabHref(window.location.href, 'settings')}#key-openai`;
    return (
      <div className={styles.band} data-testid="start-band" data-state={state} data-layout={layout}>
        <div className={styles.limit} data-testid="at-limit">
          <div className={styles.resetRow}>
            {clock && <ClockFace time={clock} />}
            <p className={styles.sentence} data-text="body" data-testid="at-limit-reset" role="status">{reset}</p>
          </div>
          <p className={styles.sentence} data-text="body" data-testid="at-limit-after">
            {atLimitAfter(sessions.status === 'ready' && sessions.rows.length > 0)}
          </p>
        </div>
        <span ref={place} className={styles.place} aria-hidden="true" />
        <div ref={bar} className={styles.bar} data-testid="start-bar" data-stuck={held ? 'true' : 'false'}>
          {held && (
            <div ref={lines} className={`${styles.lines} ${styles.over}`} data-testid="start-bar-lines">
              <p>{reset}</p>
            </div>
          )}
          <div className={styles.limitKeys}>
            {sessions.status === 'error'
              ? (
                <div className={styles.problem} data-testid="sessions-failed">
                  <BrokenLinkMark className={styles.problemMark} />
                  <span className={styles.problemWords} role="status">{SAVED_RUNS_NOT_LOADED}</span>
                  <button
                    type="button"
                    className={styles.tryAgain}
                    onClick={retry}
                    aria-disabled={trying ? 'true' : undefined}
                  >
                    {trying ? TRYING : TRY_AGAIN}
                  </button>
                </div>
              )
              : choice.kind !== 'neither' && <ReplayKey choice={choice} />}
            <a className={styles.textLink} data-testid="add-key-link" href={settingsHref}>{ADD_KEY_IN_SETTINGS}</a>
          </div>
        </div>
      </div>
    );
  }

  const waitingDrawn = state === 'waiting' || state === 'unloaded' || state === 'checking' || state === 'writing' || state === 'starting' || state === 'held';
  const runLine = (
    <RunLine
      turns={launch ? launch.turns : LOADING_TURNS}
      end={size > 2 ? RUN_END.report : RUN_END.verdict}
      outline={waitingDrawn}
    />
  );
  const keyProvider = who === 'own' ? keyProviderName(settings) : undefined;
  const firstSentence = !launch ? null : who === 'host' ? NOTICE_FREE : who === 'own' ? ownKeyPays(keyProvider) : NOTICE_SERVER;
  const notice = launch ? <StartNotice who={who} launch={launch} facts={facts} keyProvider={keyProvider} /> : null;

  // What is wrong, said in the bar above the key: the page is offline, or the run did not start.
  let problem: ReactNode = null;
  if (state === 'offline') {
    problem = (
      <p className={styles.problem} data-testid="start-offline" aria-live="polite">
        <BrokenLinkMark className={styles.problemMark} />
        <span>{START_WHEN_ONLINE}</span>
      </p>
    );
  } else if (state === 'held' && draft) {
    const keys = draft;
    problem = (
      <div className={styles.held} data-testid="start-held">
        <p className={styles.heldWords} id={HELD_WORDS_ID}>{heldDraft(scenario.labels.name)}</p>
        <div className={styles.heldKeys}>
          <a
            className={styles.textLink}
            href="#quickstart-seed-field"
            onClick={(event) => {
              event.preventDefault();
              keys.onGo();
            }}
          >
            {GO_TO_DRAFT}
          </a>
          <button type="button" className={styles.clearDraft} onClick={keys.onClear}>{CLEAR_DRAFT}</button>
        </div>
      </div>
    );
  } else if (failure && state === 'ready') {
    problem = (
      <p className={styles.problem} data-testid="start-failure" role="alert">
        {failure === 'offline' ? <BrokenLinkMark className={styles.problemMark} /> : <WarningGlyph className={styles.problemMark} />}
        <span>{FAILURE_WORDS[failure]}</span>
      </p>
    );
  }

  // With a free run left, a visitor with a saved run of their own can replay it from beside Start.
  const lastRun = state === 'ready' && who === 'host' && choice.kind === 'own'
    ? (
      <p className={styles.lastRun}>
        <a className={styles.textLink} data-testid="last-run-link" href={replayHref(choice.row.id)}>{WATCH_LAST_RUN}</a>
      </p>
    )
    : null;

  // Held, the bar carries the notice's first sentence and what the leaders are; resting, the whole notice is beside it.
  const heldLines = held && firstSentence && !problem
    ? (
      <div
        ref={lines}
        className={layout === 'phone' || layout === 'narrow' ? `${styles.lines} ${styles.over}` : styles.lines}
        data-testid="start-bar-lines"
      >
        <p>{firstSentence}</p>
        <p>{AI_AGENTS}</p>
      </div>
    )
    : null;
  const lineInBar = layout === 'narrow' || layout === 'desktop' || layout === 'wide';
  const noticeAfterBar = layout === 'desktop' || layout === 'wide';
  const linesOver = layout === 'phone' || layout === 'narrow';

  return (
    <div className={styles.band} data-testid="start-band" data-state={state} data-layout={layout}>
      {!noticeAfterBar && notice}
      {!lineInBar && runLine}
      <span ref={place} className={styles.place} aria-hidden="true" />
      <div ref={bar} className={styles.bar} data-testid="start-bar" data-stuck={held ? 'true' : 'false'}>
        {linesOver && heldLines}
        {problem}
        <div className={styles.row} data-row="start row">
          <StartKey
            state={state}
            launch={launch}
            scenarioName={scenario.labels.name}
            writing={writing}
            onPress={() => { void press(); }}
          />
          {layout === 'narrow' && runLine}
          {layout === 'desktop' && (
            <div className={styles.beside}>
              {runLine}
              {heldLines}
            </div>
          )}
          {layout === 'wide' && runLine}
          {(layout === 'tablet' || layout === 'wide') && <div className={styles.side}>{heldLines}</div>}
        </div>
      </div>
      {noticeAfterBar && notice}
      {lastRun}
    </div>
  );
}
