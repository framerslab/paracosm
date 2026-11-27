import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { LeaderPromptAnswer } from '../../../../../api/leader-prompt.js';
import { useMediaQuery } from '../../viz/grid/useMediaQuery';
import type { Payer } from './effectiveLaunch';
import { BrokenLinkMark } from './marks';
import { scoreFigure, TRAIT_ORDER } from './ScoreRows';
import type { PromptLoad, PromptSelection } from './useLeaderPrompt';
import { FULL_PROMPT as words, TRAIT_NAMES } from './words';
import styles from './FullPromptDialog.module.scss';

const parts = [
  { key: 'system', title: words.system },
  { key: 'opening', title: words.openingMessage },
  { key: 'sampleTurn', title: words.sample },
] as const;
type Part = typeof parts[number];

function ScoresRow({ answer }: { answer: LeaderPromptAnswer }) {
  const byTrait = new Map(answer.scores.map(score => [score.trait, score]));
  const ordered = TRAIT_ORDER.flatMap(trait => {
    const score = byTrait.get(trait === 'honestyHumility' ? 'honesty-humility' : trait);
    return score ? [{ ...score, label: TRAIT_NAMES[trait], figure: scoreFigure(score.value) }] : [];
  });
  const label = words.scoreLabel(answer.name, ordered.map(score => `${score.trait} ${score.figure}`).join(', '));
  const speaking = answer.speaking.map(trait =>
    `${trait} (${(byTrait.get(trait)?.value ?? 0.5) < 0.5 ? 'low' : 'high'})`,
  ).join(', ');
  return (
    <>
      <p data-text="body">{words.hexaco}</p>
      <div className={styles.scores} role="img" aria-label={label}>
        {ordered.map(score => (
          <div className={styles.score} key={score.trait} aria-hidden="true">
            <span>{score.label}</span>
            <span className={styles.track}>
              <span
                className={styles.fill}
                data-speaking={score.line !== null}
                style={{ '--prompt-score': `${score.value * 100}%` } as CSSProperties}
              />
            </span>
            <span className={styles.figure} data-testid="prompt-score">{score.figure}</span>
          </div>
        ))}
      </div>
      <p data-text="body">{words.scoreRule}{' '}{speaking ? words.speaks(answer.name, speaking) : words.middle(answer.name)}</p>
    </>
  );
}

function PromptPart({ part, id, phone, pending, text, notes }: {
  part: Part;
  id: string;
  phone: boolean;
  pending: boolean;
  text?: string;
  notes?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(part.key === 'system');
  const headingId = id + '-heading';
  return (
    <section className={styles.part} id={id} aria-labelledby={headingId}>
      <h3 className={styles.partTitle} id={headingId} data-text="heading">
        {phone ? (
          <button type="button" aria-controls={id + '-text'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {part.title}<span aria-hidden="true">{expanded ? '−' : '+'}</span>
          </button>
        ) : part.title}
      </h3>
      <div id={id + '-text'} className={styles.partBody} hidden={phone && !expanded}>
        {text !== undefined ? (
          <>
            <div className={styles.notes}>{notes}</div>
            <blockquote className={styles.quote} data-text="body" translate="no" tabIndex={0}>{text}</blockquote>
          </>
        ) : pending ? (
          <div className={styles.skeleton} data-testid="prompt-skeleton" aria-hidden="true">
            <span /><span /><span />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** A modal with the current leader's exact first two inputs and a sample turn. */
export function FullPromptDialog({ selection, payer, state, opener, online, onClose, onRetry }: {
  selection: PromptSelection;
  payer: Payer;
  state: PromptLoad;
  opener: HTMLButtonElement | null;
  online: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const phone = !useMediaQuery('(min-width: 600px)');
  const answer = state.status === 'ready' ? state.answer : null;
  const pending = state.status === 'loading';
  const failure = state.status === 'loading' ? state.retrying
    : state.status === 'failed' || state.status === 'offline' || state.status === 'limited' || state.status === 'changed'
      ? state.status : undefined;
  const [current, setCurrent] = useState<Part['key']>('system');
  const model = payer === 'host' ? answer?.model : null;

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const locked: Array<{ element: HTMLElement; overflow: string }> = [];
    for (let element = node.parentElement; element; element = element.parentElement) {
      const overflowY = getComputedStyle(element).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll' && element !== document.documentElement) continue;
      locked.push({ element, overflow: element.style.overflow });
      element.style.overflow = 'hidden';
    }
    node.showModal();
    title.current?.focus({ preventScroll: true });
    return () => {
      node.close();
      for (const { element, overflow } of locked) element.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  const wrapFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]')]
      .filter(element => element.getClientRects().length > 0);
    const first = stops[0];
    const last = stops.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === title.current)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const section = (part: Part) => document.getElementById(`${id}-${part.key}`);
  const syncCurrent = () => {
    const viewport = scroll.current;
    if (!viewport) return;
    const edge = viewport.getBoundingClientRect().top + parseFloat(getComputedStyle(viewport).scrollPaddingTop) + 1;
    const visible = [...parts].reverse().find(part => (section(part)?.getBoundingClientRect().top ?? Infinity) <= edge);
    setCurrent(visible?.key ?? 'system');
  };
  const jump = (part: Part) => {
    const viewport = scroll.current;
    const destination = section(part);
    if (!viewport || !destination) return;
    const inset = parseFloat(getComputedStyle(viewport).scrollPaddingTop);
    const top = viewport.scrollTop + destination.getBoundingClientRect().top - viewport.getBoundingClientRect().top - inset;
    viewport.scrollTo({ top, behavior: 'auto' });
    setCurrent(part.key);
  };

  return (
    <dialog ref={dialog} className={styles.dialog} data-clarity-mask="True" aria-labelledby={id + '-title'} onKeyDown={wrapFocus} onCancel={event => {
      event.preventDefault();
      onClose();
    }}>
      <header className={styles.header}>
        <h2 id={id + '-title'} ref={title} tabIndex={-1} data-text="heading">{words.title(selection.name)}</h2>
        <button type="button" className={styles.close} onClick={onClose}>{words.close}</button>
      </header>
      <p className="sr-only" role="status">{pending ? words.loading : answer ? words.loaded : ''}</p>
      <div ref={scroll} className={styles.scroll} aria-busy={pending} onScroll={syncCurrent}>
        <p className={styles.model}>
          {model ? <>{words.freeModel} {model.provider} <code>{model.model}</code></> : payer !== 'host' ? words.ownModel : null}
        </p>
        <p className={styles.lead} data-text="body">{words.lead}</p>
        {failure && (
          <div className={styles.problem}>
            <BrokenLinkMark className={styles.problemMark} />
            <div>
              <p data-text="body">{words[failure]}</p>
              {failure === 'changed' ? (
                <button type="button" className={styles.action} onClick={() => window.location.reload()}>{words.reload}</button>
              ) : (
                <button type="button" className={styles.action} onClick={onRetry} disabled={pending || !online}>
                  {pending ? words.trying : words.retry}
                </button>
              )}
            </div>
          </div>
        )}
        <div className={styles.layout}>
          <nav aria-label={words.sections} className={styles.nav}>
            {parts.map(part => (
              <a key={part.key} href={`#${id}-${part.key}`} aria-current={current === part.key ? 'location' : undefined}
                onClick={event => {
                  event.preventDefault();
                  jump(part);
                }}
              >{part.title}</a>
            ))}
          </nav>
          <div className={styles.parts}>
            {parts.map(part => (
              <PromptPart key={part.key} part={part} id={`${id}-${part.key}`} phone={phone} pending={pending}
                text={answer?.parts[part.key]} notes={answer && {
                  system: (
                    <>
                      <p data-text="body">{answer.scores.length ? words.systemNote : words.systemNoteOther}</p>
                      {answer.filled && <p data-text="body">{words.filled}</p>}
                      {answer.scores.length > 0 && <ScoresRow answer={answer} />}
                    </>
                  ),
                  opening: (
                    <>
                      <p data-text="body">{words.openingNote}</p>
                      {answer.scores.length > 0 && <p data-text="body">{words.twice}</p>}
                    </>
                  ),
                  sampleTurn: (
                    <>
                      <p data-text="body">{words.sampleNote}</p>
                      {answer.bar !== null && (
                        <>
                          <p data-text="body">{words.barNote}</p>
                          <p className={styles.figure} data-testid="prompt-bar" data-text="body">{words.bar(answer.bar)}</p>
                        </>
                      )}
                    </>
                  ),
                }[part.key]}
              />
            ))}
          </div>
        </div>
      </div>
    </dialog>
  );
}
