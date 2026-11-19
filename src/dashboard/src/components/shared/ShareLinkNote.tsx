import { useId } from 'react';
import type { SharedLink, ShareCopyState } from '../../hooks/useShareLink';
import { shareLinkOpensOnlyHere } from '../../hooks/shareUrl.helpers';
import styles from './ShareLinkNote.module.scss';

/** What the note says about the copy, one line each. */
export const SHARE_COPY_WORDS: Record<ShareCopyState, string> = {
  copying: 'Copying the link…',
  copied: 'Link copied.',
  refused: 'The browser refused to copy the link. Select the link and copy it.',
  unanswered: 'The browser did not copy the link. Select the link and copy it.',
};

/**
 * Who can open a replay link: the stored run plays for whoever holds the
 * link and can reach the dashboard that serves it.
 */
export const SHARE_WHO_CAN_OPEN = 'Anyone who has this link and can reach this dashboard can watch this run.';

/** Who can open a replay link made on a dashboard served at a local address. */
export const SHARE_OPENS_ONLY_HERE = 'This link opens only on this computer: the dashboard is served at a local address.';

interface ShareLinkNoteProps {
  shared: SharedLink;
  onClose: () => void;
}

/**
 * What a "Share viz link" press shows: the link in a field to select and
 * copy, what became of the copy, and who can open the link.
 */
export function ShareLinkNote({ shared, onClose }: ShareLinkNoteProps) {
  const fieldId = useId();
  return (
    <div
      role="status"
      aria-label="Share link"
      className={styles.note}
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
      <p className={styles.who}>
        {shareLinkOpensOnlyHere(shared.url) ? SHARE_OPENS_ONLY_HERE : SHARE_WHO_CAN_OPEN}
      </p>
      <button type="button" className={styles.close} onClick={onClose}>Close</button>
    </div>
  );
}
