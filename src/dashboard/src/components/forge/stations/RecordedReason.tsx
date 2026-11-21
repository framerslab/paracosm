import { useId } from 'react';
import { RECORDED_REASON } from '../forgeWords';
import styles from '../TraceDialog.module.scss';

/**
 * Under the head of a forge that did not pass: the reason its run recorded.
 * The run's record keeps the forge's own text, cut at 240 characters, and
 * names no station, so the text is shown as it was recorded, in the code
 * face, with no sentence about where the forge stopped. A forge whose record
 * holds no reason says so.
 */
export function RecordedReason({ reason }: { reason: string | null }) {
  const headingId = useId();
  return (
    <section className={styles.reason} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.reasonHeading} data-text="heading">{RECORDED_REASON.heading}</h3>
      {reason ? (
        <>
          <pre className={styles.reasonText} translate="no">{reason}</pre>
          <p className={styles.reasonNote}>{RECORDED_REASON.limit}</p>
        </>
      ) : (
        <p className={styles.reasonNote}>{RECORDED_REASON.none}</p>
      )}
    </section>
  );
}
