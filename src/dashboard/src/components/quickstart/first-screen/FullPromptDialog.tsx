import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LeaderPromptAnswer } from '../../../../../api/leader-prompt.js';
import { useMediaQuery } from '../../viz/grid/useMediaQuery';
import type { Payer } from './effectiveLaunch';
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
export function FullPromptDialog({ selection, payer, state, onClose }: {
  selection: PromptSelection;
  payer: Payer;
  state: PromptLoad;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const phone = !useMediaQuery('(min-width: 600px)');
  const answer = state.status === 'ready' ? state.answer : null;
  const pending = state.status === 'loading';
  const [current, setCurrent] = useState<Part['key']>('system');
  const model = payer === 'host' ? answer?.model : null;

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    title.current?.focus({ preventScroll: true });
    return () => node.close();
  }, []);

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={id + '-title'} onCancel={event => {
      event.preventDefault();
      onClose();
    }}>
      <header className={styles.header}>
        <h2 id={id + '-title'} ref={title} tabIndex={-1} data-text="heading">{words.title(selection.name)}</h2>
        <button type="button" className={styles.close} onClick={onClose}>{words.close}</button>
      </header>
      <p className="sr-only" role="status">{pending ? words.loading : answer ? words.loaded : ''}</p>
      <div className={styles.scroll} aria-busy={pending}>
        <p className={styles.model}>
          {model ? <>{words.freeModel} {model.provider} <code>{model.model}</code></> : payer !== 'host' ? words.ownModel : null}
        </p>
        <p className={styles.lead} data-text="body">{words.lead}</p>
        {state.status === 'failed' && <p data-text="body">{words.failed}</p>}
        <div className={styles.layout}>
          <nav aria-label={words.sections} className={styles.nav}>
            {parts.map(part => (
              <a key={part.key} href={`#${id}-${part.key}`} aria-current={current === part.key ? 'location' : undefined}
                onClick={event => {
                  event.preventDefault();
                  setCurrent(part.key);
                  document.getElementById(`${id}-${part.key}`)?.scrollIntoView({ block: 'start' });
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
