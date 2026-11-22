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
 * that fails is said above the key, which can then be pressed again.
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
import { formatResetTime } from './launchFailure';
import { BrokenLinkMark, WarningGlyph } from './marks';
import { useOnline } from './useOnline';
import { useServerFacts, type ServerFacts } from './useServerFacts';
import {
  AI_AGENTS,
  CHECKING_FREE_RUNS,
  NOTICE_COUNT_UNAVAILABLE,
  NOTICE_FREE,
  NOTICE_SERVER,
  RUN_DID_NOT_START,
  RUN_END,
  START,
  STARTING,
  START_WHEN_ONLINE,
  YOU_ARE_OFFLINE,
  atLimitReset,
  estimateLine,
  noticeAfter,
  noticeCount,
  noticeOwnKey,
  ownKeyPays,
  startSecondLine,
  startSpoken,
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
}

/** What the key is doing between a press and the run's opening. */
type Stage = 'checking' | 'writing' | 'starting';
/** What the band shows. */
type BandState = Stage | 'ready' | 'waiting' | 'unloaded' | 'offline' | 'limit';
/** The band's layout: phone from 320 px, narrow from 600, tablet from 768, desktop from 1,100, wide from 1,440. */
type Layout = 'phone' | 'narrow' | 'tablet' | 'desktop' | 'wide';

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

/** The key: Start over the run's length, or the words of what it waits for. */
function StartKey({ state, launch, scenarioName, writing, onPress }: {
  state: BandState;
  launch: EffectiveLaunch | null;
  scenarioName: string;
  writing: number;
  onPress: () => void;
}) {
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

export function StartBand({ size, onStart, onBusy }: StartBandProps) {
  const scenario = useScenarioContext();
  const ready = useScenarioReady();
  const { failed } = useScenarioLoad();
  const facts = useServerFacts();
  const online = useOnline();
  const layout = useLayout();
  const [stage, setStage] = useState<Stage | null>(null);
  const [writing, setWriting] = useState(0);
  const [failure, setFailure] = useState<LaunchFailureInput | null>(null);
  const pressed = useRef(false);

  // Read on each render: the Settings tab may have saved a key since.
  const settings = readLaunchSettings(safeLocalStorage());
  const who = payer(facts, settings.overrides);
  // Whose keys a run uses is known once the visitor holds a key or the server has said whether it is the hosted demo.
  const payerKnown = who === 'own' || facts.adminConfig.status !== 'loading';
  const launch = ready && payerKnown ? effectiveLaunch(facts, scenario, settings, size, who) : null;
  const { rateLimit } = facts;
  const noneLeft = who === 'host' && rateLimit.status === 'ready' && rateLimit.answer?.remaining === 0;
  const { bar, place, lines, held } = useHeldBar(layout, stage === null && online && launch !== null && noneLeft);

  const state: BandState = stage
    ?? (!online ? 'offline'
      : !launch ? (failed && !ready ? 'unloaded' : 'waiting')
        : who === 'host' && rateLimit.status === 'loading' ? 'waiting'
          : noneLeft ? 'limit'
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
    try {
      if (who === 'host') {
        // The count may have been spent since the page read it: read it again, and post nothing when none is left.
        setStage('checking');
        const fresh = await rateLimit.refresh();
        if (fresh.status === 'ready' && fresh.answer?.remaining === 0) {
          setStage(null);
          return;
        }
      }
      onBusy?.(true);
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
      setFailure(outcome.failure);
      setStage(null);
      onBusy?.(false);
    }
    // With no failure the page is on its way to the run: the key stays as it is until the page leaves.
  };

  if (state === 'limit') {
    const resetAt = rateLimit.answer?.resetAt;
    return (
      <div className={styles.band} data-testid="start-band" data-state={state} data-layout={layout}>
        <span ref={place} className={styles.place} aria-hidden="true" />
        <div ref={bar} className={styles.limit}>
          <p className={styles.sentence} data-text="body" data-testid="at-limit-reset" role="status">
            {atLimitReset(resetAt === undefined ? undefined : formatResetTime(resetAt) || undefined)}
          </p>
        </div>
      </div>
    );
  }

  const waitingDrawn = state === 'waiting' || state === 'unloaded' || state === 'checking' || state === 'writing' || state === 'starting';
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
  } else if (failure && state === 'ready') {
    problem = (
      <p className={styles.problem} data-testid="start-failure" role="alert">
        <WarningGlyph className={styles.problemMark} />
        <span>{RUN_DID_NOT_START}</span>
      </p>
    );
  }

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
    </div>
  );
}
