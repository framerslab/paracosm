import { createElement, useEffect, useState, type ComponentType } from 'react';
import { BrokenLinkMark } from '../quickstart/first-screen/marks';
import { useOnline } from '../quickstart/first-screen/useOnline';
import { TAB_LOADING, TAB_OFFLINE, TAB_FAILED, TRY_AGAIN, TRYING } from './frameWords';
import styles from './lazyTab.module.scss';

/** A failed module fetch can stay in the browser's module map for this page. */
function failedModuleUrl(error: unknown): URL | undefined {
  if (!(error instanceof TypeError)) return;
  const match = error.message.match(/^(?:Failed to fetch dynamically imported module|error loading dynamically imported module): (https?:\/\/\S+)$/i);
  if (!match) return;
  const url = new URL(match[1]);
  if (url.origin === window.location.origin) return url;
}

/**
 * Puts back every stylesheet of this site that failed to load. The bundler's
 * preload helper remembers a stylesheet it tried, so a second import of the
 * tab would skip it and the tab would show unstyled.
 */
function reloadFailedStylesheets(): Promise<unknown> {
  const failed = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .filter(link => link.sheet === null && new URL(link.href, window.location.href).origin === window.location.origin);
  return Promise.all(failed.map(link => new Promise<void>((resolve, reject) => {
    const fresh = document.createElement('link');
    fresh.rel = 'stylesheet';
    fresh.href = link.href;
    fresh.addEventListener('load', () => resolve(), { once: true });
    fresh.addEventListener('error', () => reject(new Error('Unable to load the stylesheet ' + link.href)), { once: true });
    link.replaceWith(fresh);
  })));
}

/**
 * A tab whose module loads the first time the tab opens, then stays loaded
 * for the page. `load` imports the module and `name` is the component it
 * exports. While the module loads the tab shows its loading shapes; offline
 * it says it loads once the page is back online; after a failure it offers
 * Try again, which fetches a failed module again from a new module URL and
 * puts back any stylesheet that failed with it.
 */
export function lazyTab<P extends object, Name extends string>(
  load: () => Promise<Record<Name, ComponentType<P>>>,
  name: Name,
): ComponentType<P> {
  type TabModule = Record<Name, ComponentType<P>>;
  let loaded: TabModule | undefined;
  let failedUrl: URL | undefined;
  let pending: Promise<TabModule> | undefined;
  let retries = 0;
  /** Whether the module was asked for before, so a stylesheet may have failed with it. */
  let attempted = false;

  function loadTab() {
    if (!pending) {
      let importTab: () => Promise<TabModule> = load;
      if (failedUrl) {
        // The fragment gives the browser a new module URL while keeping
        // the request for the same file on the dashboard server.
        failedUrl.hash = 'tab-retry-' + ++retries;
        const href = failedUrl.href;
        importTab = () => import(/* @vite-ignore */ href) as Promise<TabModule>;
      }
      // A first try asks for the stylesheets itself; a retry puts back those that failed.
      const request = attempted ? reloadFailedStylesheets().then(importTab) : importTab();
      attempted = true;
      pending = request.then(
        module => (loaded = module),
        error => {
          failedUrl = failedModuleUrl(error) ?? failedUrl;
          throw error;
        },
      ).finally(() => { pending = undefined; });
    }
    return pending;
  }

  function LazyTab(props: P) {
    const online = useOnline();
    const [module, setModule] = useState(loaded);
    const [attempt, setAttempt] = useState(0);
    const [failed, setFailed] = useState(false);
    const [retrying, setRetrying] = useState(false);

    useEffect(() => {
      if (!online || module) return;
      let active = true;
      setFailed(false);
      void loadTab().then(
        result => { if (active) setModule(result); },
        () => {
          if (!active) return;
          setFailed(true);
          setRetrying(false);
        },
      );
      return () => { active = false; };
    }, [attempt, module, online]);

    if (module) {
      return createElement<P>(module[name], props);
    }

    if (!online || failed || retrying) {
      return (
        <div className={styles.state}>
          <div className={styles.problem} role="status">
            <BrokenLinkMark className={styles.mark} />
            <p data-text="body">{online ? TAB_FAILED : TAB_OFFLINE}</p>
          </div>
          {online && (
            <button
              type="button"
              className={styles.retry}
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                setAttempt(value => value + 1);
              }}
            >
              {retrying ? TRYING : TRY_AGAIN}
            </button>
          )}
        </div>
      );
    }

    return (
      <div className={styles.state} data-testid="tab-loading" data-tab={name} role="status">
        <span className="sr-only">{TAB_LOADING}</span>
        <div className={styles.shapes} aria-hidden="true">
          <span className={styles.shape} />
          <span className={styles.shape} />
          <span className={styles.shape} />
          <span className={styles.shape} />
        </div>
      </div>
    );
  }
  LazyTab.displayName = 'Lazy' + name;
  return LazyTab;
}
