import { useEffect, useState, type ComponentType } from 'react';
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

export function lazyTab<P extends object, Name extends string>(
  load: () => Promise<Record<Name, ComponentType<P>>>,
  name: Name,
): ComponentType<P> {
  type TabModule = Record<Name, ComponentType<P>>;
  let loaded: TabModule | undefined;
  let failedUrl: URL | undefined;
  let pending: Promise<TabModule> | undefined;
  let retries = 0;

  function loadTab() {
    if (!pending) {
      let request: Promise<TabModule>;
      if (failedUrl) {
        failedUrl.searchParams.set('tab-retry', String(++retries));
        request = import(/* @vite-ignore */ failedUrl.href) as Promise<TabModule>;
      } else {
        request = load();
      }
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
      const Tab = module[name];
      return <Tab {...props} />;
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
