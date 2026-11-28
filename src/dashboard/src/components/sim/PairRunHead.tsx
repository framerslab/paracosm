import { useEffect, useRef, type MouseEvent } from 'react';
import type { RunFacts } from '../../hooks/useSSE';
import { useForgeView } from '../forge/ForgeViewProvider';
import styles from './SimView.module.scss';

export type RunHeadAction = 'stop' | 'details' | null;

interface PairRunHeadProps {
  facts: RunFacts | null;
  scenario: string;
  turns: number;
  status: string;
  warning?: boolean;
  recoveryHref?: string;
  recovered: boolean;
  models?: Readonly<Record<string, string>>;
  toolCount: number;
  spend: number;
  canStop: boolean;
  action: RunHeadAction;
  stopping: boolean;
  stopMessage: string | null;
  onAskStop: () => void;
  onKeepWatching: () => void;
  onConfirmStop: () => void;
  onCloseDetails: () => void;
}

function billingLine(spend: number, estimate?: number) {
  const spent = `${spend.toFixed(2)}\u00a0USD`;
  const caveat = 'Your provider’s bill can differ.';
  if (estimate === undefined) return `Spent so far, estimated: ${spent}. ${caveat}`;
  const expected = `${estimate.toFixed(2)}\u00a0USD`;
  return spend > estimate
    ? `Spent so far, estimated: ${spent}, more than the ${expected} estimated before Start.`
    : `Spent so far, estimated: ${spent} of about ${expected}. ${caveat}`;
}

function modelLine(models: PairRunHeadProps['models']) {
  if (!models) return null;
  const roles = [
    models.commander && models.commander === models.departments
      ? `${models.commander} for the leaders and departments`
      : models.commander && `${models.commander} for the leaders`,
    models.departments && models.departments !== models.commander && `${models.departments} for the departments`,
    models.judge && `${models.judge} for the verdict`,
  ].filter(Boolean);
  return roles.length ? `Models: ${roles.join(', ')}` : null;
}

export function PairRunHead({
  facts, scenario, turns, status, warning, recoveryHref, recovered, models, toolCount, spend,
  canStop, action, stopping, stopMessage, onAskStop, onKeepWatching, onConfirmStop, onCloseDetails,
}: PairRunHeadProps) {
  const { openToolbox } = useForgeView();
  const stopKey = useRef<HTMLButtonElement>(null);
  const firstKey = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (action) firstKey.current?.focus();
  }, [action]);

  function returnFocus(toStop: boolean) {
    requestAnimationFrame(() => {
      const origin = toStop && stopKey.current?.offsetParent
        ? stopKey.current : document.getElementById('run-actions-key');
      origin?.focus();
    });
  }

  function closeDetails() {
    onCloseDetails();
    returnFocus(false);
  }

  function keepWatching() {
    onKeepWatching();
    returnFocus(true);
  }

  function seeTools(event: MouseEvent<HTMLButtonElement>) {
    openToolbox(event.currentTarget, 'sim');
  }

  const payer = facts?.payer;
  const own = payer === 'own';
  const description = [
    '2 leaders',
    `${turns} ${turns === 1 ? 'turn' : 'turns'}`,
    payer === 'host' ? 'today’s free run'
      : payer === 'server' ? 'on this server’s API keys'
      : own ? 'on your own API key' : 'payer unknown',
  ].join(' · ');
  const reportedModels = modelLine(models);

  return (
    <section className={styles.runHead} aria-label="Run" onKeyDown={event => {
      if (event.key !== 'Escape' || stopping) return;
      if (action === 'details') closeDetails();
      else if (action === 'stop') keepWatching();
    }}>
      <div className={styles.runHeading}>
        <h2 className={styles.runName}>{facts?.name ?? scenario}</h2>
        <p className={styles.runDescription}>{description}</p>
        <p className={styles.runState} role="status" aria-atomic="true">
          {warning && <span className={styles.runGlyph} aria-hidden="true">▲ </span>}
          {status}
        </p>
        {own && <p className={styles.runSpend}>{billingLine(spend, facts?.estimate)}</p>}
        {canStop && action !== 'stop' &&
          <button id="watch-stop-key" ref={stopKey} type="button" className={styles.runKey} data-phone-stop={own ? undefined : 'menu'}
            aria-label="Stop the run" onClick={onAskStop}>
            <span aria-hidden="true">□ </span>Stop
          </button>}
        {recoveryHref && <a className={styles.runKey} href={recoveryHref}>Go to Run</a>}
      </div>
      {recovered && <p className={styles.runState} aria-live="polite">You’re back online.</p>}
      {action === 'stop' && (
        <div className={styles.runFold} role="group" aria-labelledby="watch-stop-question">
          <p id="watch-stop-question">Stop the run? Turns that arrived stay on this page.</p>
          {payer === 'host' && <p>Stopping keeps this free run used.</p>}
          <div className={styles.runKeys}>
            <button ref={firstKey} type="button" className={styles.runKey} onClick={keepWatching}
              disabled={stopping}>Keep watching</button>
            <button type="button" className={styles.runKey} onClick={onConfirmStop}
              disabled={stopping}>{stopping ? 'Stopping…' : 'Stop the run'}</button>
          </div>
        </div>
      )}
      {stopMessage && <p className={styles.runState} aria-live="polite">{stopMessage}</p>}
      {action === 'details' && (
        <section className={styles.runFold} aria-label="Run details">
          <h3 className={styles.runName}>Run details</h3>
          {facts?.seed !== undefined && <p>Seed {facts.seed}</p>}
          {reportedModels && <p>{reportedModels}</p>}
          {facts?.startedAt !== undefined && <p>Started {new Date(facts.startedAt).toLocaleTimeString(undefined, {
            hour: 'numeric', minute: '2-digit',
          })}</p>}
          <p>{toolCount} {toolCount === 1 ? 'tool' : 'tools'} forged</p>
          <div className={styles.runKeys}>
            <button ref={firstKey} type="button" className={styles.runKey} onClick={closeDetails}>Close</button>
            <button type="button" className={styles.runKey} onClick={seeTools}>See the tools</button>
          </div>
        </section>
      )}
    </section>
  );
}
