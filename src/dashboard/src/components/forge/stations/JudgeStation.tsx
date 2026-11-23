import { JUDGE_WORDS, judgeConfidence } from '../forgeWords';
import styles from './stations.module.scss';

/**
 * Judge on the run's record of a passed forge: the notice that a model's
 * review is no audit, the confidence the record holds as a number and a
 * meter, and that the judge's own words were not recorded. The record holds
 * none of the judge's four checks, so none is drawn.
 */
export function JudgeStation({ confidence }: { confidence: number }) {
  const value = Math.min(1, Math.max(0, Number(confidence.toFixed(2))));
  return (
    <div className={styles.open}>
      <h3 className={styles.heading} data-text="heading">{JUDGE_WORDS.heading}</h3>
      <p className={styles.meta}>{JUDGE_WORDS.notice}</p>
      <div className={styles.confidence}>
        <p className={styles.body} data-text="body">{judgeConfidence(confidence)}</p>
        <div
          role="meter"
          className={styles.meter}
          aria-label={JUDGE_WORDS.meterName}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={value}
        >
          <span className={styles.meterFill} style={{ width: `${value * 100}%` }} data-meter-fill />
        </div>
      </div>
      <p className={styles.quiet}>{JUDGE_WORDS.wordsNotRecorded}</p>
    </div>
  );
}
