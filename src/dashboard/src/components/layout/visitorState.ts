import { useEffect, useState } from 'react';
import { KEY_OVERRIDES_CHANGED } from '../../hooks/useLastLaunchConfig';
import { readLaunchSettings, safeLocalStorage } from '../quickstart/first-screen/effectiveLaunch';
import { useServerFacts, type RateLimitState, type ServerFacts } from '../quickstart/first-screen/useServerFacts';
import { hasSessionProviderKey } from '../settings/sessionProviderKeys';
import { freeRuns, NO_FREE_RUNS, OWN_KEYS, SERVER_KEYS } from './frameWords';

/** The visitor's payer or quota in its full and compact forms. */
export type VisitorState = { long: string; short: string };

/** Reads the banner state in payer order from the available server answers. */
export function visitorState({ ownKey, adminConfig, rateLimit, limitMet = false }: {
  ownKey: boolean;
  adminConfig: ServerFacts['adminConfig'];
  rateLimit: RateLimitState;
  /** The server refused a launch at its daily limit, as Start reads it. */
  limitMet?: boolean;
}): VisitorState | null {
  if (ownKey) return OWN_KEYS;
  if (adminConfig.status === 'loading') return null;
  if (adminConfig.hostedDemo === false) return SERVER_KEYS;
  if (limitMet) return NO_FREE_RUNS;
  if (rateLimit.status === 'ready' && rateLimit.answer) {
    const { remaining } = rateLimit.answer;
    return remaining === 0 ? NO_FREE_RUNS : freeRuns(remaining);
  }
  if (rateLimit.status === 'unlimited' && adminConfig.hostedDemo !== true) return SERVER_KEYS;
  return null;
}

/**
 * Keeps the last successful answer through a failed or pending read. The
 * visitor's own key is read in this browser, not asked of the server: once
 * it is gone, its words go too, even while the server's answer is unknown.
 */
export function keepVisitorState(previous: VisitorState | null, current: VisitorState | null): VisitorState | null {
  if (!current && previous?.long === OWN_KEYS.long) return null;
  if (!current || (current.long === previous?.long && current.short === previous?.short)) return previous;
  return current;
}

/** Shares the launch panel's server answers and reads the current browser keys. */
export function useVisitorState(): VisitorState | null {
  const { adminConfig, rateLimit, limitMet } = useServerFacts();
  // A key saved in Settings writes only to this tab's storage, which
  // renders nothing here: its notice reads the keys again.
  const [, setKeysRead] = useState(0);
  useEffect(() => {
    const readAgain = () => setKeysRead(count => count + 1);
    window.addEventListener(KEY_OVERRIDES_CHANGED, readAgain);
    return () => window.removeEventListener(KEY_OVERRIDES_CHANGED, readAgain);
  }, []);
  const { overrides } = readLaunchSettings(safeLocalStorage());
  const current = visitorState({ ownKey: hasSessionProviderKey(overrides), adminConfig, rateLimit, limitMet });
  const [previous, setPrevious] = useState<VisitorState | null>(null);
  const next = keepVisitorState(previous, current);
  if (next !== previous) setPrevious(next);
  return next;
}
