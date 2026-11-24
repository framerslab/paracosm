import { useDashboardNavigation } from '../../App';
import { createDashboardTabHref } from '../../tab-routing';
import { atLimitChoice } from '../quickstart/first-screen/launchFailure';
import { useServerFacts } from '../quickstart/first-screen/useServerFacts';
import { RUN_END } from '../quickstart/first-screen/words';
import { buildReplayHref } from './LoadMenu.helpers';
import {
  EMPTY_REPORTS_BODY,
  EMPTY_REPORTS_TITLE,
  EMPTY_WATCH_BODY,
  EMPTY_WATCH_TITLE,
  GO_TO_RUN,
  WATCH_LAST_RUN,
} from './frameWords';
import styles from './EmptyTab.module.scss';

/**
 * What Watch (`kind` "watch") or Reports ("reports") shows with no run: its
 * title, a line on how a run gets there, Go to Run, and Watch your last run
 * again when the server still holds this visitor's last run.
 */
export function EmptyTab({ kind }: { kind: 'watch' | 'reports' }) {
  const navigate = useDashboardNavigation();
  const { sessions } = useServerFacts();
  const choice = atLimitChoice(sessions.rows);
  const base = typeof window === 'undefined' ? '' : window.location.href;
  const replay = choice.kind === 'own' && base ? buildReplayHref(base, choice.row.id) : undefined;
  const watch = kind === 'watch';

  return (
    <div className={styles.empty}>
      <div className={styles.copy}>
        <h2 data-text="heading">{watch ? EMPTY_WATCH_TITLE : EMPTY_REPORTS_TITLE}</h2>
        <p data-text="body">{watch ? EMPTY_WATCH_BODY : EMPTY_REPORTS_BODY}</p>
        <div className={styles.links}>
          <a
            href={base ? createDashboardTabHref(base, 'quickstart') : '/sim?tab=quickstart'}
            onClick={event => {
              if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              navigate('quickstart');
            }}
          >
            {GO_TO_RUN}
          </a>
          {replay && <a href={replay}>{WATCH_LAST_RUN}</a>}
        </div>
      </div>
      {watch ? (
        <div className={styles.runLine} data-testid="empty-run-line" aria-hidden="true">
          <ol>{Array.from({ length: 6 }, (_, step) => <li key={step} />)}</ol>
          <span>{RUN_END.verdict}</span>
        </div>
      ) : (
        <ol className={styles.tracks} data-testid="empty-score-tracks" aria-hidden="true">
          {Array.from({ length: 4 }, (_, track) => <li key={track} />)}
        </ol>
      )}
    </div>
  );
}
