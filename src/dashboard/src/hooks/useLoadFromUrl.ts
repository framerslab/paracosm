/**
 * Detect `?load=<url>` on mount, fetch the remote JSON, wrap it as a
 * File, and hand it to {@link useLoadPreview}'s `openFromFile` so the
 * F9 preview modal renders. Strips the `?load=` param from the URL
 * after the fetch resolves so a page refresh doesn't re-trigger.
 *
 * Designed to be passive: if no valid `?load=` param is present, the
 * hook does nothing. When present, it fetches with a timeout and
 * surfaces all failure modes as error toasts rather than blocking the
 * rest of the dashboard.
 *
 * @module paracosm/cli/dashboard/hooks/useLoadFromUrl
 */
import { useEffect, useRef } from 'react';
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

export function useLoadFromUrl(opts: UseLoadFromUrlOptions): void {
  // Ref-stable callbacks so remount isn't triggered by fresh opts
  // object identities between renders.
  const optsRef = useRef(opts);
  optsRef.current = opts;

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

    const { url } = parsed;
    let cancelled = false;
    const ctrl = new AbortController();
    const timeoutId = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

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
        const blob = await res.blob();
        if (cancelled) return;
        const file = new File([blob], deriveFileNameFromUrl(url), {
          type: 'application/json',
        });
        await openFromFile(file);
      } catch (err) {
        if (cancelled) return;
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

    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearTimeout(timeoutId);
    };
    // Mount-only — identity of opts is handled via the ref above so
    // the fetch never re-triggers mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Remove the `?load=` param from the current URL without a page reload
 * so a subsequent refresh doesn't re-trigger the fetch.
 */
function stripLoadParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('load')) return;
    url.searchParams.delete('load');
    const newHref = url.pathname + (url.search ? url.search : '') + url.hash;
    window.history.replaceState({}, '', newHref);
  } catch {
    // noop — URL might be unusual; best-effort cleanup only
  }
}
