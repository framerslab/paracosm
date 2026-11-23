import { useState } from 'react';
import { readLaunchSettings, safeLocalStorage } from '../quickstart/first-screen/effectiveLaunch';
import { useServerFacts, type RateLimitState, type ServerFacts } from '../quickstart/first-screen/useServerFacts';
import { hasSessionProviderKey } from '../settings/sessionProviderKeys';
import { freeRuns, NO_FREE_RUNS, OWN_KEYS, SERVER_KEYS } from './frameWords';

/** The visitor's payer or quota in its full and compact forms. */
export type VisitorState = { long: string; short: string };

/** Reads the banner state in payer order from the available server answers. */
export function visitorState({ ownKey, adminConfig, rateLimit }: {
  ownKey: boolean;
  adminConfig: ServerFacts['adminConfig'];
  rateLimit: RateLimitState;
}): VisitorState | null {
  if (ownKey) return OWN_KEYS;
  if (adminConfig.status === 'loading') return null;
  if (adminConfig.hostedDemo === false) return SERVER_KEYS;
  if (rateLimit.status === 'ready' && rateLimit.answer) {
    const { remaining } = rateLimit.answer;
    return remaining === 0 ? NO_FREE_RUNS : freeRuns(remaining);
  }
  if (rateLimit.status === 'unlimited' && adminConfig.hostedDemo !== true) return SERVER_KEYS;
  return null;
}

/** Keeps the last successful answer through a failed or pending read. */
export function keepVisitorState(previous: VisitorState | null, current: VisitorState | null): VisitorState | null {
  if (!current || (current.long === previous?.long && current.short === previous?.short)) return previous;
  return current;
}

/** Shares the launch panel's server answers and reads the current browser keys. */
export function useVisitorState(): VisitorState | null {
  const { adminConfig, rateLimit } = useServerFacts();
  const { overrides } = readLaunchSettings(safeLocalStorage());
  const current = visitorState({ ownKey: hasSessionProviderKey(overrides), adminConfig, rateLimit });
  const [previous, setPrevious] = useState<VisitorState | null>(null);
  const next = keepVisitorState(previous, current);
  if (next !== previous) setPrevious(next);
  return next;
}
