import { useId } from 'react';
import type { SharedLink, ShareCopyState } from '../../hooks/useShareLink';
import styles from './ShareLinkNote.module.scss';

/** What the note says about the copy, one line each. */
export const SHARE_COPY_WORDS: Record<ShareCopyState, string> = {
  copying: 'Copying the link…',
  copied: 'Link copied.',
  refused: 'The browser refused to copy the link. Select the link and copy it.',
  unanswered: 'The browser did not copy the link. Select the link and copy it.',
};

/** Who can open a replay link: the stored run plays for whoever holds it. */
export const SHARE_WHO_CAN_OPEN = 'Anyone who has this link can watch this run.';

interface ShareLinkNoteProps {
  shared: SharedLink;
  onClose: () => void;
  /** Pinned under the top bar, for the run actions menu, which closes on the press. */
  floating?: boolean;
}

/**
 * What a "Share viz link" press shows: the link in a field to select and
 * copy, what became of the copy, and who can open the link.
 */
export function ShareLinkNote({ shared, onClose, floating = false }: ShareLinkNoteProps) {
  const fieldId = useId();
  return (
    <div
      role="status"
      aria-label="Share link"
      className={[styles.note, floating ? styles.floating : ''].filter(Boolean).join(' ')}
      data-state={shared.state}
    >
      <label htmlFor={fieldId} className={styles.label}>Link to this run</label>
      <input
        id={fieldId}
        className={styles.field}
        type="text"
        readOnly
        value={shared.url}
        onFocus={e => e.currentTarget.select()}
      />
      <p className={styles.result}>{SHARE_COPY_WORDS[shared.state]}</p>
      <p className={styles.who}>{SHARE_WHO_CAN_OPEN}</p>
      <button type="button" className={styles.close} onClick={onClose}>Close</button>
    </div>
  );
}
