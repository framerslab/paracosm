/**
 * The first screen's notes, each in view before a first press of Start:
 * the leaders are fictional, under the leaders' heading row, where leaders
 * are picked; and the leaders are AI and can be wrong, as one line directly
 * above Start's notice. Each is a sentence at the body size in the ink. The
 * age terms sit in the landing page's Terms section, never on the app's screens.
 *
 * @module paracosm/dashboard/quickstart/first-screen/FirstScreenNotes
 */
import { NOTE_AI, NOTE_FICTIONAL } from './words';
import styles from './FirstScreenNotes.module.scss';

/** Under the leaders' heading row. */
export function FictionalNote() {
  return <p className={styles.note} data-text="body" data-testid="note-fictional">{NOTE_FICTIONAL}</p>;
}

/** Above Start's notice: the AI note. */
export function FirstScreenNotes() {
  return (
    <div className={styles.notes} data-testid="first-screen-notes">
      <p className={styles.note} data-text="body" data-testid="note-ai">{NOTE_AI}</p>
    </div>
  );
}
