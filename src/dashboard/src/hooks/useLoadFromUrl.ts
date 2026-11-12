/**
 * Detect `?load=<url>` on mount, fetch the remote JSON, wrap it as a
 * File, and hand it to {@link useLoadPreview}'s `openFromFile` so the
 * F9 preview modal renders. Strips the `?load=` param from the URL
 * after the fetch resolves so a page refresh doesn't re-trigger.
 *
 * A file on the page's own site is fetched on mount. A file on another
 * site is not: the hook reports its host as `pendingHost` and fetches it
 * only after `confirmPending`, so the page asks the visitor first. A
 * response that a redirect brought from another origin than the one
 * fetched is not opened, since nobody named or agreed to that site.
 *
 * Designed to be passive: if no valid `?load=` param is present, the
 * hook does nothing. When present, it fetches with a timeout and
 * surfaces all failure modes as error toasts rather than blocking the
 * rest of the dashboard.
 *
 * @module paracosm/cli/dashboard/hooks/useLoadFromUrl
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseLoadUrlParam,
  deriveFileNameFromUrl,
  isCrossOrigin,
} from './useLoadFromUrl.helpers';

/** Default fetch timeout for remote runs. Balances slow links vs hung loads. */
const FETCH_TIMEOUT_MS = 30_000;

export interface UseLoadFromUrlOptions {
  /** Hand the fetched run off to the preview flow (F9 path). */
  openFromFile: (file: File) => void | Promise<void>;
  /** Info-level toast used for "Loading from..." banner. */
  onInfo?: (title: string, body: string) => void;
  /** Error toast for fetch / validation failures. */
  onError?: (title: string, body: string) => void;
  /**
   * Test-only injection hook. Production callers omit this and get the
   * real global fetch.
   *
   * @internal
   */
  _fetchImpl?: typeof fetch;
}

/**
 * A `?load=` link on another site waits for the visitor: nothing is
 * fetched until they answer the question that names the site.
 */
export interface LoadFromUrlState {
  /** Host of the run file a link names on another site, while the page waits to ask. */
  pendingHost: string | null;
  /** The visitor chose Load: fetch the file. */
  confirmPending: () => void;
  /** The visitor chose Cancel: fetch nothing and drop the link's params. */
  cancelPending: () => void;
}

export function useLoadFromUrl(opts: UseLoadFromUrlOptions): LoadFromUrlState {
  // Ref-stable callbacks so remount isn't triggered by fresh opts
  // object identities between renders.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [pending, setPending] = useState<URL | null>(null);
  // The fetch in flight, so an unmount aborts it.
  const activeRef = useRef<{ cancelled: boolean; ctrl: AbortController; timeoutId: number } | null>(null);

  const startFetch = useCallback((url: URL) => {
    const ctrl = new AbortController();
    const timeoutId = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const active = { cancelled: false, ctrl, timeoutId };
    activeRef.current = active;

    (async () => {
      const { openFromFile, onInfo, onError } = optsRef.current;
      if (isCrossOrigin(url, window.location.href)) {
        onInfo?.('Loading remote run', `Fetching from ${url.host}...`);
      } else {
        onInfo?.('Loading run', `Fetching ${url.pathname}...`);
      }
      try {
        const fetchImpl = optsRef.current._fetchImpl ?? fetch;
        const res = await fetchImpl(url.toString(), { signal: ctrl.signal });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        // The page asked about, or allowed, this URL's origin only. A
        // redirect to another origin would show a file from a site nobody
        // named, so it is refused before the body is read.
        if (res.url) {
          let finalHost: string | null;
          try {
            const finalUrl = new URL(res.url);
            finalHost = finalUrl.origin === url.origin ? null : finalUrl.host;
          } catch {
            finalHost = 'another address';
          }
          if (finalHost !== null) {
            throw new Error(`The file redirects to ${finalHost}, so it was not loaded.`);
          }
        }
        const blob = await res.blob();
        if (active.cancelled) return;
        const file = new File([blob], deriveFileNameFromUrl(url), {
          type: 'application/json',
        });
        await openFromFile(file);
      } catch (err) {
        if (active.cancelled) return;
        const message =
          err instanceof Error && err.name === 'AbortError'
            ? `Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s.`
            : err instanceof Error
              ? err.message
              : String(err);
        onError?.('Remote load failed', message);
      } finally {
        window.clearTimeout(timeoutId);
        stripLoadParam();
      }
    })();
  }, []);

  useEffect(() => {
    const parsed = parseLoadUrlParam(window.location.href);
    if (!parsed.ok) {
      if (parsed.reason === 'unsupported-scheme' || parsed.reason === 'malformed') {
        // Don't toast for these — user may be noise-testing or the URL
        // was mangled in transit. Console hint is enough for debugging.
        console.warn(`[paracosm] Ignoring ?load= param: ${parsed.reason}`);
        stripLoadParam();
      }
      return;
    }

    // A file on another site was named by whoever wrote the link, not by
    // the visitor: ask first, naming the site, and fetch nothing until then.
    if (isCrossOrigin(parsed.url, window.location.href)) {
      setPending(parsed.url);
    } else {
      startFetch(parsed.url);
    }

    return () => {
      const active = activeRef.current;
      if (!active) return;
      active.cancelled = true;
      active.ctrl.abort();
      window.clearTimeout(active.timeoutId);
      activeRef.current = null;
    };
    // Mount-only — identity of opts is handled via the ref above so
    // the fetch never re-triggers mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmPending = useCallback(() => {
    setPending(null);
    if (pending) startFetch(pending);
  }, [pending, startFetch]);

  const cancelPending = useCallback(() => {
    setPending(null);
    stripLoadParam();
  }, []);

  return { pendingHost: pending ? pending.host : null, confirmPending, cancelPending };
}

/**
 * Remove the `?load=` and `?autoload=` params from the current URL
 * without a page reload so a subsequent refresh doesn't re-fetch the
 * remote run or re-skip the preview modal. `?tab=` is preserved so the
 * post-load destination (set by the share link) survives any later tab
 * navigations.
 */
function stripLoadParam(): void {
  try {
    const url = new URL(window.location.href);
    const hadLoad = url.searchParams.has('load');
    const hadAutoload = url.searchParams.has('autoload');
    if (!hadLoad && !hadAutoload) return;
    url.searchParams.delete('load');
    url.searchParams.delete('autoload');
    const newHref = url.pathname + (url.search ? url.search : '') + url.hash;
    window.history.replaceState({}, '', newHref);
  } catch {
    // noop — URL might be unusual; best-effort cleanup only
  }
}
