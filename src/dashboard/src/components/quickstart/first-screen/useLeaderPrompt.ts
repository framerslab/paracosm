import { useEffect, useRef, useState } from 'react';
import type { LeaderPromptAnswer } from '../../../../../api/leader-prompt.js';
import type { Payer } from './effectiveLaunch';
import { useOnline } from './useOnline';

type Retryable = 'failed' | 'offline' | 'limited';

/** The written leader selected from the scenario on screen. */
export interface PromptSelection {
  scenarioId: string;
  place: number;
  name: string;
}

/** The current read's result, with no result retained after Close. */
export type PromptLoad =
  | { status: 'closed' | 'changed' | Retryable }
  | { status: 'loading'; retrying?: Retryable }
  | { status: 'ready'; answer: LeaderPromptAnswer };

interface Result {
  selection: PromptSelection;
  payer: Payer;
  attempt: number;
  state: PromptLoad;
}

/** Reads the current prompt with the tab's payer choice and visitor cookie. */
export function useLeaderPrompt(selection: PromptSelection | null, payer: Payer) {
  const online = useOnline();
  const [attempt, setAttempt] = useState(0);
  const retried = useRef<Result | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!selection) {
      setResult(null);
      retried.current = null;
      return;
    }

    const controller = new AbortController();
    const finish = (state: PromptLoad) => {
      if (!controller.signal.aborted) setResult({ selection, payer, attempt, state });
    };
    if (navigator.onLine === false) {
      finish({ status: 'offline' });
      return () => controller.abort();
    }
    const query = new URLSearchParams({ scenario: selection.scenarioId, place: String(selection.place) });
    void (async () => {
      try {
        const response = await fetch(`/leader-prompt?${query}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json', ...(payer === 'own' ? { 'X-Paracosm-Prompt-Mode': 'own' } : {}) },
          signal: controller.signal,
        });
        if (response.status === 409) return finish({ status: 'changed' });
        if (response.status === 429) return finish({ status: 'limited' });
        if (!response.ok) return finish({ status: 'failed' });
        const answer = await response.json() as LeaderPromptAnswer;
        if (answer.scenarioId !== selection.scenarioId || answer.place !== selection.place) {
          return finish({ status: 'changed' });
        }
        finish({ status: 'ready', answer });
      } catch {
        finish({ status: navigator.onLine ? 'failed' : 'offline' });
      }
    })();
    return () => controller.abort();
  }, [selection, payer, attempt]);

  const matching = result?.selection === selection && result.payer === payer ? result : null;
  const previous = matching?.state.status;
  const retrying = previous === 'failed' || previous === 'offline' || previous === 'limited' ? previous : undefined;
  const state: PromptLoad = !selection ? { status: 'closed' }
    : matching?.attempt === attempt ? matching.state
    : { status: 'loading', retrying };

  const retry = () => {
    if (!retrying || !matching || matching.attempt !== attempt || retried.current === matching || !online) return;
    retried.current = matching;
    setAttempt(attempt + 1);
  };
  return { state, retry, online };
}
