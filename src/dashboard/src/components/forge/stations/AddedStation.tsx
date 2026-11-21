import type { ToolEntry } from '../../../hooks/useToolRegistry';
import { usesOf } from '../forgeLine';
import { ADDED_WORDS, historyRowLine, usedTimes } from '../forgeWords';
import styles from './stations.module.scss';

/**
 * Added on the run's record: how many times the actor used the tool after
 * its forge, then each row of its history in order, the forges and the uses,
 * each with its turn, department and event and the output its run recorded.
 * The record holds no forge's test, and says so on each forge's row.
 */
export function AddedStation({ entry }: { entry: ToolEntry }) {
  const uses = usesOf(entry);
  return (
    <div className={styles.open}>
      <p className={styles.body} data-text="body">{usedTimes(uses)}</p>
      {entry.history.length > 0 && (
        <ol className={styles.uses}>
          {entry.history.map((row, i) => {
            const forge = i === 0 || row.isReforge;
            return (
              <li key={`${row.turn}-${row.eventIndex}-${row.department}-${i}`} className={styles.use} data-history-row={forge ? 'forge' : 'use'}>
                <p className={styles.meta}>{historyRowLine(row.turn, row.department, row.eventTitle)}</p>
                {row.output ? (
                  <>
                    <p className={styles.meta}>{ADDED_WORDS.output}</p>
                    <pre className={styles.code} translate="no">{row.output}</pre>
                  </>
                ) : null}
                {forge && <p className={styles.quiet}>{ADDED_WORDS.testNotRecorded}</p>}
              </li>
            );
          })}
        </ol>
      )}
      {uses === 0 && <p className={styles.quiet}>{ADDED_WORDS.notUsed}</p>}
    </div>
  );
}
