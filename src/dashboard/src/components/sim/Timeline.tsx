import { useEffect, useRef, type CSSProperties } from 'react';
import type { GameState, ActorSideState } from '../../hooks/useGameState';
import { getActorColorVar } from '../../hooks/useGameState';
import { Tooltip } from '../shared/Tooltip';
import styles from './Timeline.module.scss';

interface TimelineProps {
  state: GameState;
}

interface TurnEntry {
  turn: number;
  time: number;
  title: string;
  summary?: string;
  outcome?: string;
  decision?: string;
  category?: string;
  emergent?: boolean;
  current?: boolean;
  subEvents?: Array<{ index: number; title: string; category: string }>;
}

function extractTurns(sideState: ActorSideState, isComplete: boolean): TurnEntry[] {
  const turns: TurnEntry[] = [];
  const s = sideState;
  for (const evt of s.events) {
    if (evt.type === 'turn_start' && evt.data.title && evt.data.title !== 'Director generating...') {
      turns.push({
        turn: evt.data.turn as number,
        time: evt.data.time as number,
        title: evt.data.title as string,
        summary: (evt.data.turnSummary as string) || (evt.data.crisis as string) || '',
        category: evt.data.category as string || '',
        emergent: evt.data.emergent as boolean || false,
      });
    }
    if (evt.type === 'event_start') {
      const turnNum = evt.data.turn as number;
      const t = turns.find(t => t.turn === turnNum);
      if (t) {
        if (!t.subEvents) t.subEvents = [];
        t.subEvents.push({
          index: Number(evt.data.eventIndex ?? 0),
          title: String(evt.data.title || ''),
          category: String(evt.data.category || ''),
        });
      }
    }
    if (evt.type === 'outcome') {
      const t = turns.find(t => t.turn === evt.data.turn);
      if (t) {
        t.outcome = evt.data.outcome as string;
        t.decision = (evt.data._decision as string) || '';
      }
    }
  }
  if (turns.length) turns[turns.length - 1].current = !isComplete;
  return turns;
}

function outcomeLabel(outcome?: string): { label: string; color: string } {
  if (!outcome) return { label: '', color: 'var(--text-3)' };
  const isSuccess = outcome.includes('success');
  const isRisky = outcome.includes('risky');
  const label = isRisky ? (isSuccess ? 'RISKY WIN' : 'RISKY LOSS') : (isSuccess ? 'SAFE WIN' : 'SAFE LOSS');
  const color = isSuccess ? 'var(--green)' : 'var(--rust)';
  return { label, color };
}

function outcomeBadge(outcome?: string) {
  if (!outcome) return null;
  const { color } = outcomeLabel(outcome);
  const isSuccess = outcome.includes('success');
  const short = outcome.includes('risky') ? (isSuccess ? 'RS' : 'RF') : (isSuccess ? 'CS' : 'CF');
  return (
    <span
      className={styles.outcomeBadge}
      style={{
        '--status-color': color,
        // Was rgba(...,.15) tint background which dropped rust-on-tint
        // contrast to 4.21:1 (failed WCAG AA 4.5:1 for the 9px badge).
        // Transparent background lets the rust text sit on the parent
        // dark surface directly (~6.5:1), and the colored border still
        // signals the outcome state.
        '--status-bg': 'transparent',
      } as CSSProperties}
    >
      {short}
    </span>
  );
}

function TurnTooltipContent({ t, sideColor }: { t: TurnEntry; sideColor: string }) {
  const { label, color } = outcomeLabel(t.outcome);
  const sideStyle = { '--side-color': sideColor } as CSSProperties;
  return (
    <div>
      <div className={styles.tooltipHeader}>
        <b className={styles.tooltipTurn} style={sideStyle}>Turn {t.turn}</b>
        <span className={styles.tooltipTime}>Y{t.time}</span>
        {t.category && <span className={styles.tooltipCategory}>{t.category}</span>}
        {t.emergent && <span className={styles.tooltipEmergent}>EMERGENT</span>}
      </div>
      <div className={styles.tooltipTitle}>{t.title}</div>
      {t.summary && <div className={styles.tooltipSummary}>{t.summary}</div>}
      {t.decision && (
        <div className={styles.tooltipDecision}>
          <span className={styles.tooltipDecisionLabel} style={sideStyle}>Decision: </span>
          {t.decision}
        </div>
      )}
      {t.outcome && (
        <div className={styles.tooltipOutcome} style={{ '--outcome-color': color } as CSSProperties}>
          {label}
        </div>
      )}
    </div>
  );
}

function SideTimeline({ turns, actorIndex }: { turns: TurnEntry[]; actorIndex: number }) {
  const sideColor = getActorColorVar(actorIndex);
  const sideStyle = { '--side-color': sideColor } as CSSProperties;
  // Same tail-to-bottom pattern as the Sim column and Event Log:
  // auto-scroll when pinned, release on user scroll-up.
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns.length]);

  return (
    <div ref={scrollRef} onScroll={onScroll} className={styles.side}>
      {turns.map(t => (
        <Tooltip key={t.turn} dot content={<TurnTooltipContent t={t} sideColor={sideColor} />}>
          <div
            className={[styles.entry, t.current ? styles.current : ''].filter(Boolean).join(' ')}
            style={sideStyle}
          >
            <div className={styles.entryHead}>
              <span className={styles.entryTurn} style={sideStyle}>
                T{t.turn} {t.time}
              </span>
              <span className={styles.entryTitle}>{t.title}</span>
              {t.category && <span className={styles.entryCategory}>{t.category}</span>}
              {t.emergent && <span className={styles.entryEmergent}>EMERGENT</span>}
              {outcomeBadge(t.outcome)}
            </div>
            {t.summary && <div className={styles.entrySummary}>{t.summary}</div>}
            {t.subEvents && t.subEvents.length > 1 && (
              <div className={styles.entrySubEvents}>
                {t.subEvents.map((se, i) => (
                  <div key={i} className={styles.entrySubEventRow}>
                    <span className={styles.entrySubIdx}>{se.index + 1}.</span>
                    <span>{se.title}</span>
                  </div>
                ))}
              </div>
            )}
            {t.decision && !t.subEvents?.length && (
              <div className={styles.entryDecision}>{t.decision}</div>
            )}
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

export function Timeline({ state }: TimelineProps) {
  const firstId = state.actorIds[0];
  const secondId = state.actorIds[1];
  const sideA = firstId ? state.actors[firstId] : null;
  const sideB = secondId ? state.actors[secondId] : null;
  const turnsA = sideA ? extractTurns(sideA, state.isComplete) : [];
  const turnsB = sideB ? extractTurns(sideB, state.isComplete) : [];

  if (!turnsA.length && !turnsB.length) return null;

  return (
    <div className={`timeline-row ${styles.timelineRow}`} role="region" aria-label="Turn timeline">
      <SideTimeline turns={turnsA} actorIndex={0} />
      <SideTimeline turns={turnsB} actorIndex={1} />
    </div>
  );
}
