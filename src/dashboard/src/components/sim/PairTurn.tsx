import { useId, useState, type MouseEvent, type ReactNode } from 'react';
import type { ScenarioClientPayload } from '../../hooks/useScenario';
import { sendEvent } from '../../analytics/send';
import { AiWritten, isAiWritten, isAiWrittenPassage } from '../shared/AiWritten';
import { Badge, outcomeLabel } from '../shared/Badge';
import { describeBarCheck } from './EventCard';
import { hasChoice, type PairDecision, type PairTurnData } from './pair-turn';
import styles from './SimView.module.scss';

type DisplayMetrics = ScenarioClientPayload['ui']['headerMetrics'];

const stampHelp = 'RISKY: took the bold option. SAFE: took the safe one. WIN or LOSS: whether it paid off.';
const barHelp = 'A leader takes the bold option when its chance reaches that leader’s bar. The bar comes from the leader’s traits: a more open, less careful and calmer leader sets it lower.';

function Disclosure({ label, fold, children }: { label: string; fold: 'crisis' | 'reasoning'; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const target = useId();
  return (
    <>
      <button type="button" className={styles.watchKey} aria-controls={target} aria-expanded={open} onClick={() => {
        if (!open) sendEvent('watch_fold', { fold });
        setOpen(!open);
      }}>{label}</button>
      <div id={target} hidden={!open}>{children}</div>
    </>
  );
}

function Crisis({ info, noun }: { info: Record<string, unknown>; noun: string }) {
  const heading = useId();
  const title = String(info.title || '');
  const description = String(info.description || info.turnSummary || '');
  const authored = isAiWritten(info, info.description ? 'description' : 'turnSummary');
  const [open, setOpen] = useState(false);
  const body = useId();
  return (
    <article className={styles.watchCrisis} aria-labelledby={heading}>
      <h3 id={heading}><AiWritten authored={isAiWritten(info, 'title')}>{title}</AiWritten></h3>
      {typeof info.category === 'string' && <p className={styles.watchKind} data-testid="watch-crisis-kind">{info.category.charAt(0).toUpperCase() + info.category.slice(1)}</p>}
      {description && <>
        <AiWritten as="p" className={open ? styles.watchProse : styles.watchSummary} authored={authored}>
          <span id={body}>{description}</span>
        </AiWritten>
        <button type="button" className={styles.watchKey} aria-expanded={open} aria-controls={body} onClick={() => {
          if (!open) sendEvent('watch_fold', { fold: 'crisis' });
          setOpen(!open);
        }}>Read the whole {noun}</button>
      </>}
    </article>
  );
}

function changesOf(outcome: Record<string, unknown>, metrics: DisplayMetrics) {
  const changes = { ...outcome.systemDeltas as Record<string, unknown>, ...outcome.politicsDeltas as Record<string, unknown> };
  return Object.entries(changes).flatMap(([id, value]) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return [];
    const metric = metrics.find(entry => entry.id === id);
    const label = id.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
    const percent = metric?.format === 'percent' || id === 'morale';
    const amount = +Math.abs(value * (percent && metric?.max !== 100 ? 100 : 1)).toFixed(2);
    return [`${label.charAt(0).toUpperCase()}${label.slice(1)} ${value < 0 ? 'down' : 'up'} ${amount}${percent ? (amount === 1 ? ' point' : ' points') : ''}`];
  }).join(' · ');
}

function Decision({ name, nameAuthored, side, place, noun, metrics, firstStamp, firstBar, reportHref, openReport }: {
  name: string;
  nameAuthored: boolean;
  side?: PairDecision;
  place: number;
  noun: string;
  metrics: DisplayMetrics;
  firstStamp: boolean;
  firstBar: boolean;
  reportHref: string;
  openReport?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const heading = useId();
  const explanation = useId();
  const [explain, setExplain] = useState(false);
  const choice = side?.choice;
  const replied = hasChoice(choice);
  const outcome = typeof side?.outcome?.outcome === 'string' ? side.outcome.outcome : '';
  const check = side?.barCheck;
  const barText = check ? describeBarCheck(check) : '';
  const fact = check?.departs ? check.departureFact : '';
  const reportedBar = fact ? barText.slice(0, -fact.length) : barText;
  const reportNames = Array.from(side?.reports.keys() ?? [], name => name.charAt(0).toUpperCase() + name.slice(1));
  const changes = side?.outcome ? changesOf(side.outcome, metrics) : '';
  const reason = String(choice?.rationale || '');
  const reasoning = String(choice?.reasoning || '');
  const policies = Array.isArray(choice?.selectedPolicies) ? choice.selectedPolicies : [];
  return (
    <article className={styles.watchDecision} aria-labelledby={heading}>
      <h3 id={heading}><span aria-hidden="true" className={styles.watchPlaceFigure}>{place + 1}</span> <AiWritten authored={nameAuthored}>{name}</AiWritten><span className="sr-only">’s decision</span></h3>
      {replied ? <>
        <div className={styles.watchChoiceRow}>
          <AiWritten as="p" className={styles.watchChoice} authored={isAiWrittenPassage(choice, 'decision', choice?.decision)}>{String(choice?.decision)}</AiWritten>
          {outcome && <div className={styles.watchStamp}>
            <Badge outcome={outcome} neutral />
            {!firstStamp && <button type="button" className={styles.watchKey} aria-label="What the stamps mean" aria-controls={explanation}
              aria-expanded={explain} onClick={() => setExplain(!explain)}>?</button>}
          </div>}
        </div>
        {outcome && <div id={explanation} hidden={!firstStamp && !explain}>
          <p>{stampHelp}</p>
          {!firstBar && check && <p>{barHelp}</p>}
        </div>}
        {check && <p className={styles.watchKind}>
          {check.bar < 57 ? 'Bold leader.' : check.bar > 57 ? 'Careful leader.' : 'Balanced leader.'}{' '}
          <span>{reportedBar}{fact && <AiWritten authored>{fact}</AiWritten>}</span>
        </p>}
        {check && firstBar && <p>{barHelp}</p>}
        {changes && <p>{changes}</p>}
        {reason && <AiWritten as="p" className={styles.watchProse} authored={isAiWrittenPassage(choice, 'rationale', reason)}>{reason}</AiWritten>}
        {(reasoning || policies.length > 0) && <Disclosure fold="reasoning" label="Full reasoning and policies">
          {reasoning && <AiWritten as="p" className={styles.watchProse} authored={isAiWrittenPassage(choice, 'reasoning', reasoning)}>{reasoning}</AiWritten>}
          {policies.length > 0 && <ul>{policies.map((policy, index) => typeof policy === 'string'
            ? <AiWritten as="li" key={index} authored={isAiWrittenPassage(choice, 'selectedPolicies', policy)}>{policy}</AiWritten> : null)}</ul>}
        </Disclosure>}
      </> : choice || side?.outcome ? <>
        <p>No decision came back for this {noun}.</p>
        <a href={reportHref} onClick={openReport} className={styles.watchKey}>See the run’s log in Reports</a>
      </> : <>
        <p>Deciding…</p>
        {reportNames.length > 0 && <p>{new Intl.ListFormat('en', { type: 'conjunction' }).format(reportNames)} {reportNames.length === 1 ? 'is' : 'are'} reporting.</p>}
        {Array.from(side?.reports ?? [], ([department, report]) => report && typeof report.summary === 'string'
          ? <AiWritten as="p" className={styles.watchProse} key={department} authored={isAiWrittenPassage(report, 'summary', report.summary)}>{report.summary}</AiWritten>
          : null)}
      </>}
    </article>
  );
}

export function PairTurn({ data, turn, maxTurns, noun, place, grid, metrics, reportHref, openReport, firstEvidence }: {
  data: PairTurnData;
  turn: number;
  maxTurns: number;
  noun: string;
  place: number;
  grid: ReactNode;
  metrics: DisplayMetrics;
  reportHref: string;
  openReport?: (e: MouseEvent<HTMLAnchorElement>) => void;
  firstEvidence: boolean;
}) {
  const label = `Turn ${turn}${maxTurns > 0 ? ` of ${maxTurns}` : ''}`;
  const heading = `${label}${data.time !== undefined ? `, ${data.time}` : ''}`;
  const first = data.crises[0]?.sides.find(side => side?.crisis)?.crisis;
  const title = String(first?.title || '');
  const plural = noun === 'crisis' ? 'crises' : noun + 's';
  let showStampHelp = firstEvidence;
  let showBarHelp = firstEvidence;

  return (
    <section className={styles.watchTurn} aria-label={label} data-watch-place={place + 1}>
      <h2 id="watch-turn-heading" className={styles.watchHeading} tabIndex={-1}>
        <span className={styles.watchWideHeading}>{heading}{data.time !== undefined && maxTurns > 0 ? `. The verdict comes after turn ${maxTurns}.` : ''}</span>
        <span className={styles.watchPhoneHeading}>{heading}{title && <> · <AiWritten authored={isAiWritten(first, 'title')}>{title}</AiWritten></>}
          {data.crises.length > 1 && ` and ${data.crises.length - 1} more ${data.crises.length > 2 ? plural : noun}`}
        </span>
      </h2>
      {data.crises.length === 0 && <p className={styles.watchWaiting}>Turn {turn} is on its way.</p>}
      {grid}
      {data.crises.map(({ index, sides }) => {
        const a = sides[0]?.crisis;
        const b = sides[1]?.crisis;
        const shared = Boolean(a && b && a.title === b.title && a.category === b.category && a.description === b.description);
        const firstCrisis = index === data.crises[0].index;
        return (
          <div className={styles.watchCrisisGroup} data-first={firstCrisis} key={index}>
            {data.crises.length > 1 && <h3 className={styles.watchCrisisCount}>{noun.charAt(0).toUpperCase() + noun.slice(1)} {index + 1} of {data.crises.length}</h3>}
            <div className={styles.watchEvents}>
              {a && b && <p className={styles.watchMatch}>{shared ? `Same ${noun} for both colonies` : `Different ${plural} this turn`}</p>}
              <div className={styles.watchColumns}>
                {shared && a ? <div className={styles.watchShared}><Crisis info={a} noun={noun} /></div> :
                  [a, b].map((info, i) => <div data-watch-side={i + 1} key={i}>{info && <Crisis info={info} noun={noun} />}</div>)}
              </div>
            </div>
            <div className={styles.watchColumns}>
              {data.leaders.map(({ name, info }, i) => {
                const side = sides[i];
                const firstStamp = showStampHelp && hasChoice(side?.choice) && Boolean(side?.outcome?.outcome);
                const firstBar = showBarHelp && hasChoice(side?.choice) && Boolean(side?.barCheck);
                if (firstStamp) showStampHelp = false;
                if (firstBar) showBarHelp = false;
                return <div data-watch-side={i + 1} className={styles.watchDecisionColumn} key={name}>
                  <Decision name={name} nameAuthored={info?.aiAuthorship?.fields.includes('name') === true}
                    place={i} side={side} noun={noun} metrics={metrics} firstStamp={firstStamp} firstBar={firstBar}
                    reportHref={reportHref} openReport={openReport} />
                </div>;
              })}
            </div>
            {[0, 1].map(i => {
              const choice = sides[i]?.choice;
              const leader = data.leaders[i];
              if (!leader || !hasChoice(choice)) return null;
              const outcome = sides[i]?.outcome?.outcome;
              return <p className={styles.watchCompact} data-watch-other={i + 1} key={i}>
                <AiWritten authored={leader.info?.aiAuthorship?.fields.includes('name') === true}>{leader.name}</AiWritten>: {typeof outcome === 'string' && `${outcomeLabel(outcome)}, `}
                <AiWritten authored={isAiWrittenPassage(choice, 'decision', choice?.decision)}>{String(choice?.decision)}</AiWritten>
              </p>;
            })}
          </div>
        );
      })}
    </section>
  );
}
