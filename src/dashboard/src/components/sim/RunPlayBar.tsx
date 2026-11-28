import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { sendEvent } from '../../analytics/send';
import { RUN_SPEEDS, type RunPlayhead, type RunSpeed } from '../../hooks/useRunPlayhead';
import type { WatchTurn } from '../../tab-routing';
import styles from './RunPlayBar.module.scss';

interface RunPlayBarProps {
  playhead: RunPlayhead;
  arrivedTurns: readonly number[];
  maxTurns: number;
  stopped: boolean;
  turnTitle: (turn: number) => string;
  focusTurn: () => void;
}

const SPEED_KEYS: Record<RunSpeed, string> = { 0.5: 'speed_half', 1: 'speed_1', 2: 'speed_2', 4: 'speed_4' };
const INTERACTIVE = [
  'a[href]', 'button', 'input', 'textarea', 'select', 'summary', '[contenteditable]',
  '[role="button"]', '[role="link"]', '[role="dialog"]', '[role="menu"]', '[role="slider"]',
  '[role="tablist"]', '[role="radio"]', '[role="checkbox"]', '[role="switch"]', '[role="grid"]',
  '[data-testid^="living-colony-grid"]',
].join(',');

/** The pair's arrived turns and the controls for reading them. */
export function RunPlayBar({ playhead, arrivedTurns, maxTurns, stopped, turnTitle, focusTurn }: RunPlayBarProps) {
  const { selected, newest, endReady, endSeen, mode, speed, hasBack, hasForward } = playhead;
  const atEnd = selected === 'end';
  const total = Math.max(maxTurns, newest ?? 1);
  const onScreen = typeof selected === 'number' ? selected : newest ?? 0;
  const pending = !endReady && !stopped && (newest ?? 0) < total ? (newest ?? 0) + 1 : null;
  const showLatest = !endSeen && !stopped;
  const canLatest = showLatest && (endReady || newest !== null && selected !== newest);
  const playing = mode !== 'hold' && !atEnd && (!stopped || mode === 'replay');
  const playLabel = atEnd ? 'Play from turn 1' : playing ? 'Pause' : 'Play';
  const valueText = atEnd ? 'Verdict' : onScreen === 0 ? 'Waiting for turn 1'
    : `Turn ${onScreen} of ${total} on screen${stopped && onScreen === newest ? '. The run stopped here.' : ''}`;
  const buttonLabel = newest !== null && selected !== newest && !endReady ? `Turn ${newest} is in` : 'Latest';
  const marks: WatchTurn[] = [...Array.from({ length: total }, (_, i) => i + 1), 'end'];
  const received = new Set(arrivedTurns);
  const bar = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const speedKey = useRef<HTMLButtonElement>(null);
  const speedMenu = useRef<HTMLDivElement>(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  const menuId = useId();

  const pick = (position: WatchTurn, focus = true) => {
    if (position !== 'end' && !received.has(position) || position === 'end' && !endReady) return;
    sendEvent('watch_turn_pick', {});
    playhead.select(position);
    if (focus && position !== 'end') focusTurn();
  };

  const step = (direction: -1 | 1, focus: boolean) => {
    if (direction === -1 ? !hasBack : !hasForward) return;
    sendEvent('watch_play', { key: direction === -1 ? 'back' : 'forward' });
    playhead.step(direction);
    if (focus) focusTurn();
  };

  const toggle = () => {
    if (atEnd && newest === null) return;
    sendEvent('watch_play', { key: playing ? 'pause' : 'play' });
    if (stopped && !playing && !hasForward && arrivedTurns[0] !== undefined) {
      playhead.restart();
    } else {
      playhead.toggle();
    }
  };

  const latest = (focus: boolean) => {
    if (!canLatest) return;
    sendEvent('watch_play', { key: 'latest' });
    playhead.latest();
    if (focus && !endReady) focusTurn();
    if (endReady) line.current?.focus({ preventScroll: true });
  };

  function handleKey(event: KeyboardEvent | globalThis.KeyboardEvent, slider: boolean) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    const focus = !slider;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        if (slider || event.key === 'ArrowLeft') step(-1, focus);
        else return;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        if (slider || event.key === 'ArrowRight') step(1, focus);
        else return;
        break;
      case 'Home':
        if (arrivedTurns[0] !== undefined && selected !== arrivedTurns[0]) pick(arrivedTurns[0], focus);
        break;
      case 'End':
        if (stopped && newest !== null && selected !== newest) pick(newest, focus);
        else if (endReady && !atEnd && endSeen) pick('end', false);
        else latest(focus);
        break;
      case ' ':
        toggle();
        break;
      case 'Escape':
        if (!slider) return;
        (bar.current?.closest('#tabpanel-sim') as HTMLElement | null)?.focus({ preventScroll: true });
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const panel = bar.current?.closest('#tabpanel-sim');
      if (!target || (target !== document.body && !panel?.contains(target)) || target.closest(INTERACTIVE)) return;
      if (document.querySelector('[aria-modal="true"]') || speedOpen) return;
      handleKey(event, false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useLayoutEffect(() => {
    if (!speedOpen) return;
    speedMenu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [speedOpen]);

  useEffect(() => {
    if (!speedOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || speedMenu.current?.contains(event.target) || speedKey.current?.contains(event.target)) return;
      setSpeedOpen(false);
    };
    window.addEventListener('pointerdown', closeOutside);
    return () => window.removeEventListener('pointerdown', closeOutside);
  }, [speedOpen]);

  useLayoutEffect(() => {
    const root = bar.current;
    if (!root?.parentElement) return;
    const viewport = root.parentElement;
    const observer = new ResizeObserver(measure);
    let consent: HTMLElement | null = null;
    function measure() {
      const next = document.getElementById('pcc');
      if (next !== consent) {
        if (consent) observer.unobserve(consent);
        consent = next;
        if (consent) observer.observe(consent);
      }
      const box = consent?.getBoundingClientRect();
      const overlap = box?.height ? Math.max(0, viewport.getBoundingClientRect().bottom - box.top) : 0;
      root?.style.setProperty('--play-consent-space', `${overlap}px`);
    }
    const added = new MutationObserver(measure);
    added.observe(document.body, { childList: true });
    observer.observe(viewport);
    measure();
    return () => {
      observer.disconnect();
      added.disconnect();
    };
  }, []);

  const closeSpeed = () => {
    setSpeedOpen(false);
    speedKey.current?.focus();
  };
  const onSpeedKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSpeed();
      return;
    }
    const items = Array.from(event.currentTarget.querySelectorAll('button'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (offset) items[(current + offset + items.length) % items.length]?.focus();
    else if (event.key === 'Home') items[0]?.focus();
    else if (event.key === 'End') items.at(-1)?.focus();
    else return;
    event.preventDefault();
  };

  const selectedIndex = selected === 'end' ? total : (selected ?? 0) - 1;
  const progressStyle = {
    '--play-turn-count': total,
    '--play-current-index': selectedIndex,
    '--play-arrived-index': endReady ? total : Math.max(0, (newest ?? 0) - 1),
  } as CSSProperties;

  return (
    <div className={styles.bar} ref={bar}>
      {endReady && !endSeen && newest !== null && <p className={styles.announcement} role="status">
        The verdict is in. Press Latest to see it, or keep going and it follows turn {newest}.
      </p>}
      <div className={styles.controls}>
        <div
          ref={line}
          role="slider"
          tabIndex={0}
          aria-label="Run line"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={onScreen}
          aria-valuetext={valueText}
          onKeyDown={event => handleKey(event, true)}
          className={styles.line}
          data-many={total > 8 || undefined}
          style={progressStyle}
        >
          <div className={styles.track} aria-hidden="true" data-arrived={newest !== null} />
          {marks.map(position => {
            const end = position === 'end';
            const arrived = end ? endReady : received.has(position);
            const interrupted = stopped && position === newest;
            const label = end ? 'Verdict' : turnTitle(position);
            return <span key={position}
              className={styles.mark}
              data-run-mark={position}
              data-arrived={arrived}
              data-pending={pending === position}
              data-selected={selected === position}
              data-interrupted={interrupted}
              aria-hidden="true"
              title={interrupted ? `${label}. The run stopped here.` : label}
              onClick={() => pick(position)}
            >
              <span className={styles.point}>{interrupted ? '!' : ''}</span>
              {end ? <span className={styles.endLabel}>Verdict</span>
                : (total < 100 || position % 10 === 0) && <span className={styles.number} data-run-number>{position}</span>}
            </span>;
          })}
          {selectedIndex >= 0 && <span className={styles.ring} aria-hidden="true" data-end={atEnd} />}
        </div>
        <span className={styles.compactTurn} data-many={total > 8 || undefined} aria-hidden="true">
          {atEnd ? 'Verdict' : onScreen > 0 ? `Turn ${onScreen} of ${total}` : 'Waiting for turn 1'}
        </span>
        <span className="sr-only" aria-live="polite">{newest !== null ? `Turn ${newest} of ${total}` : ''}</span>
        <div className={styles.keys} data-watch-play-keys>
          {!atEnd && <button type="button" className={`${styles.key} ${styles.back}`} aria-label="Back" title="Back" disabled={!hasBack} onClick={() => step(-1, true)}>
            <span aria-hidden="true">‹</span><span className={styles.word}>Back</span>
          </button>}
          <button type="button" className={`${styles.key} ${styles.toggle}`} aria-label={playLabel} title={playLabel} aria-pressed={playing} disabled={atEnd && newest === null} onClick={toggle}>
            <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span><span className={atEnd ? styles.restart : styles.word}>{playLabel}</span>
          </button>
          {!atEnd && <button type="button" className={`${styles.key} ${styles.forward}`} aria-label="Forward" title="Forward" disabled={!hasForward} onClick={() => step(1, true)}>
            <span aria-hidden="true">›</span><span className={styles.word}>Forward</span>
          </button>}
          {showLatest && <button type="button" className={`${styles.key} ${styles.latest}`} aria-label={buttonLabel} title={buttonLabel} disabled={!canLatest} onClick={() => latest(true)}>
            <span aria-hidden="true">⇥</span>{canLatest && <span className={styles.unread} aria-hidden="true" />}<span className={styles.word}>{buttonLabel}</span>
          </button>}
          <div className={styles.speed}>
            <button type="button" ref={speedKey} className={styles.key} aria-label={`Speed, ${speed}x`} title={`Speed, ${speed}x`}
              aria-haspopup="menu" aria-expanded={speedOpen} aria-controls={speedOpen ? menuId : undefined} onClick={() => setSpeedOpen(!speedOpen)}>{speed}x</button>
            {speedOpen && <div className={styles.speedMenu} role="menu" id={menuId} ref={speedMenu}
              aria-label="Pace of the turns that have arrived" onKeyDown={onSpeedKey}
              onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setSpeedOpen(false); }}>
              <p aria-hidden="true">Pace of the turns that have arrived</p>
              {RUN_SPEEDS.map(option => <button key={option} type="button" role="menuitemradio"
                aria-checked={speed === option} tabIndex={-1} className={styles.key} onClick={() => {
                  sendEvent('watch_play', { key: SPEED_KEYS[option] });
                  playhead.setSpeed(option);
                  closeSpeed();
                }}>
                <span aria-hidden="true">{speed === option ? '✓' : ''}</span>{option}x
              </button>)}
            </div>}
          </div>
        </div>
      </div>
    </div>
  );
}
