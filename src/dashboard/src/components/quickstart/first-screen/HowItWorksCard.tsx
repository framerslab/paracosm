/**
 * The How it works card: six lines that state the rules of a run, with
 * three drawings that together show one sample turn (a bar with a chance
 * marked on it, the stamp that turn earns, and a row of four scores). The
 * header's key opens it from any tab; its Close key, Escape or the same key
 * closes it. Nothing opens it by itself.
 *
 * On a phone it is a sheet from the bottom edge, a modal dialog that holds
 * focus until it closes, standing above the consent bar while that shows.
 * From 600 px it is a panel under the header's key that does not hold
 * focus: the page behind it stays usable, and a press outside closes the
 * panel and reaches the page. Opening moves focus to the title; Close and
 * Escape return it to the header's key.
 *
 * Its words ship with the page and it asks the server for nothing, so it
 * opens whole with no network. The fourth line names the run's turns, which
 * the first screen tells the page, and the scenario's word for a
 * settlement; until the scenario has loaded it names neither.
 *
 * It opens and closes with a 150 ms fade, with a 16 px rise on a phone,
 * both at once under reduced motion.
 *
 * @module paracosm/dashboard/quickstart/first-screen/HowItWorksCard
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useScenarioContext, useScenarioReady } from '../../../App';
import { useRunTurns } from './runTurns';
import {
  CLOSE,
  DRAWING_ALT,
  HOW_IT_WORKS,
  SAMPLE_SCORES,
  SAMPLE_STAMP,
  SAMPLE_TURN,
  howItWorksLines,
  sampleBar,
  sampleChance,
} from './words';
import styles from './HowItWorksCard.module.scss';

/** Under this width the card is a sheet; from it, a panel. */
const SHEET_QUERY = '(max-width: 599.98px)';
/** How long the card takes to leave, matching its fade. */
const FADE_MS = 150;
/** The gap between the header's row and the panel under it. */
const PANEL_GAP = 8;

const matches = (query: string): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

/** Whether the window is a phone's, kept current as it is resized. */
function useSheet(): boolean {
  const [sheet, setSheet] = useState(() => matches(SHEET_QUERY));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(SHEET_QUERY);
    const read = () => setSheet(media.matches);
    read();
    media.addEventListener('change', read);
    return () => media.removeEventListener('change', read);
  }, []);
  return sheet;
}

/** One drawing: an image whose text alternative says what it shows, marked as part of the sample turn. */
function Drawing({ kind, children }: { kind: keyof typeof DRAWING_ALT; children: ReactNode }) {
  return (
    <div className={`${styles.drawing} ${styles[kind]}`} role="img" aria-label={DRAWING_ALT[kind]} data-drawing={kind}>
      <span className={styles.sample}>{SAMPLE_TURN}</span>
      {children}
    </div>
  );
}

/** A track from 0 to 100 with the leader's bar and the bold option's chance marked on it. */
function BarDrawing() {
  return (
    <Drawing kind="bar">
      <span className={styles.track} aria-hidden="true">
        <span className={styles.barMark} aria-hidden="true" />
        <span className={styles.chanceMark} aria-hidden="true" />
      </span>
      <span className={styles.barKey}>
        <span className={styles.keyItem}>
          <span className={styles.barGlyph} aria-hidden="true" />
          <span>{sampleBar}</span>
        </span>{' '}
        <span className={styles.keyItem}>
          <span className={styles.chanceGlyph} aria-hidden="true" />
          <span>{sampleChance}</span>
        </span>
      </span>
    </Drawing>
  );
}

/** The stamp as the run screen prints it: two words in capitals inside a hairline frame, never turned. */
function StampDrawing() {
  return (
    <Drawing kind="stamp">
      <span className={styles.stampWords}>{SAMPLE_STAMP}</span>
    </Drawing>
  );
}

/** Four scores out of 10, each a figure over its own short track. */
function ScoresDrawing() {
  return (
    <Drawing kind="scores">
      <span className={styles.scoreRow}>
        {SAMPLE_SCORES.map(([name, value]) => (
          <span key={name} className={styles.score}>
            <span className={styles.scoreName}>{name}</span>{' '}
            <span className={styles.scoreValue}>{value}</span>
            <span className={styles.scoreTrack} aria-hidden="true">
              <span className={styles.scoreFill} aria-hidden="true" data-score={value} />
            </span>
          </span>
        ))}
      </span>
    </Drawing>
  );
}

/** The drawing that stands with a line, by the line's place from 0: the second, third and fourth lines have one. */
const DRAWINGS: Partial<Record<number, () => ReactNode>> = {
  1: () => <BarDrawing />,
  2: () => <StampDrawing />,
  3: () => <ScoresDrawing />,
};

export interface HowItWorksCardProps {
  open: boolean;
  /** Closes the card. */
  onClose(): void;
  /** The header's key, which the panel stands under and focus returns to. */
  anchor: RefObject<HTMLElement | null>;
}

export function HowItWorksCard({ open, onClose, anchor }: HowItWorksCardProps) {
  const scenario = useScenarioContext();
  const scenarioReady = useScenarioReady();
  const turns = useRunTurns();
  const sheet = useSheet();
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // The card stays on the page for its fade after it closes; under reduced motion it leaves at once.
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const leaving = present && !open;
  const [place, setPlace] = useState({ top: 52, bottom: 0 });

  useEffect(() => {
    if (!leaving) return undefined;
    if (matches('(prefers-reduced-motion: reduce)')) {
      setPresent(false);
      return undefined;
    }
    const done = window.setTimeout(() => setPresent(false), FADE_MS);
    return () => window.clearTimeout(done);
  }, [leaving]);

  /** Close and Escape: the card closes and focus returns to the header's key. */
  const closeToKey = useCallback(() => {
    onClose();
    anchor.current?.focus({ preventScroll: true });
  }, [onClose, anchor]);

  // Opening moves focus to the title, so the card is read from its start.
  useEffect(() => {
    if (open) titleRef.current?.focus({ preventScroll: true });
  }, [open]);

  // A panel left open while the window narrows becomes a sheet. A sheet holds focus, so it takes it then.
  useEffect(() => {
    if (open && sheet && !cardRef.current?.contains(document.activeElement)) titleRef.current?.focus({ preventScroll: true });
  }, [open, sheet]);

  // Where the card stands: a panel under the header's key, a sheet above the consent bar while that shows.
  useLayoutEffect(() => {
    if (!open) return undefined;
    let consentWatched: Element | null = null;
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => read());
    function read() {
      // Under the header's row where the key stands in one, else under the key itself.
      const key = anchor.current;
      const under = (key?.closest('header') ?? key)?.getBoundingClientRect();
      const top = under && under.height > 0 ? Math.round(under.bottom + PANEL_GAP) : 52;
      const consent = document.getElementById('pcc');
      if (consent && consent !== consentWatched) {
        consentWatched = consent;
        sizes?.observe(consent);
      }
      const box = consent ? consent.getBoundingClientRect() : null;
      const covered = box && box.height > 0 ? Math.max(0, Math.round(window.innerHeight - box.top)) : 0;
      // A consent bar that covers more than half the window leaves no room above it: the sheet keeps the bottom edge.
      const bottom = covered > window.innerHeight / 2 ? 0 : covered;
      setPlace((was) => (was.top === top && was.bottom === bottom ? was : { top, bottom }));
    }
    read();
    window.addEventListener('resize', read);
    // The consent bar is added to the page a moment after it loads, and leaves once it is answered.
    const added = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => read());
    added?.observe(document.body, { childList: true });
    return () => {
      window.removeEventListener('resize', read);
      added?.disconnect();
      sizes?.disconnect();
    };
  }, [open, anchor]);

  // Escape closes it, on a phone and as a panel.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeToKey();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closeToKey]);

  // As a panel, a press outside it closes it. The press is left alone, so it reaches the page.
  useEffect(() => {
    if (!open || sheet) return undefined;
    const onPress = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (cardRef.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('click', onPress, true);
    return () => document.removeEventListener('click', onPress, true);
  }, [open, sheet, onClose, anchor]);

  if (!open && !present) return null;
  if (typeof document === 'undefined') return null;

  const lines = howItWorksLines({
    turns: scenarioReady && turns !== null ? turns : undefined,
    settlement: scenarioReady ? scenario.labels.settlementNoun : undefined,
  });

  /** As a sheet, Tab and Shift+Tab stay inside it. */
  const holdFocus = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const first = bodyRef.current;
    const last = closeRef.current;
    const card = cardRef.current;
    if (!first || !last || !card) return;
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !card.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !card.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };

  const modal = sheet && open;
  return createPortal(
    <>
      {sheet && (
        <div
          className={styles.scrim}
          data-leaving={leaving ? '' : undefined}
          onClick={open ? closeToKey : undefined}
          data-testid="how-it-works-scrim"
        />
      )}
      <div
        ref={cardRef}
        className={styles.card}
        role="dialog"
        aria-modal={modal ? 'true' : undefined}
        aria-labelledby={titleId}
        data-testid="how-it-works-card"
        data-leaving={leaving ? '' : undefined}
        style={{ '--card-top': `${place.top}px`, '--sheet-bottom': `${place.bottom}px` } as CSSProperties}
        onKeyDown={modal ? holdFocus : undefined}
      >
        {/* The words scroll inside the card's own height; a keyboard reaches them to scroll. */}
        <div ref={bodyRef} className={styles.body} role="group" aria-labelledby={titleId} tabIndex={0} data-testid="how-it-works-body">
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className={styles.title} data-text="heading">{HOW_IT_WORKS}</h2>
          <ol className={styles.lines}>
            {lines.map((line, i) => {
              const drawing = DRAWINGS[i];
              return (
                <li key={i} className={styles.item}>
                  <div className={styles.row} data-drawn={drawing ? '' : undefined}>
                    <p className={styles.line} data-text="body" data-testid="how-line">{line}</p>
                    {drawing?.()}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        <div className={styles.foot}>
          <button ref={closeRef} type="button" className={styles.close} onClick={closeToKey} data-testid="how-it-works-close">
            {CLOSE}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
