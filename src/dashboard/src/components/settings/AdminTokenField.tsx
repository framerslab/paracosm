import { useEffect, useState } from 'react';
import {
  adminTokenState,
  clearAdminToken,
  saveAdminToken,
  subscribeAdminToken,
  type AdminTokenState,
} from '../../admin-token';
import styles from './AdminTokenField.module.scss';

const STATUS: Record<AdminTokenState, string> = {
  none: 'No token is saved in this browser.',
  stored: 'A token is saved in this browser. It is not shown back.',
  held: 'This browser could not store the token, so it is kept only until this page reloads.',
};

/**
 * Where the operator enters the server's admin token.
 *
 * Settings shows it only on a server with admin writes on. The token is
 * written through admin-token.ts, which the three admin calls read; this
 * field never holds a saved token in its input and never shows one back.
 * The input and its two buttons stay on one row at every width.
 */
export function AdminTokenField() {
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<AdminTokenState>(() => adminTokenState());

  // A call the server refused clears the token; so can another tab.
  useEffect(() => subscribeAdminToken(() => setState(adminTokenState())), []);

  const save = () => {
    if (!draft.trim()) return;
    setState(saveAdminToken(draft));
    setDraft('');
  };

  const clear = () => {
    clearAdminToken();
    setState('none');
    setDraft('');
  };

  return (
    <div>
      <p className={styles.intro}>
        Admin writes on this server take its <code>ADMIN_TOKEN</code>: Save to Disk in the scenario editor below,
        the server wipe that Clear local data runs, and Delete in a scenario&apos;s details. Enter the token once.
        The dashboard sends it only on those requests, as the <code>X-Admin-Token</code> header, and keeps it in
        this browser.
      </p>
      <label htmlFor="admin-token" className={styles.label}>Token for this server</label>
      <div className={styles.row}>
        <input
          id="admin-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          placeholder={state === 'none' ? 'Not entered' : 'Saved'}
          aria-describedby="admin-token-status"
          className={styles.input}
        />
        <button
          type="button"
          onClick={save}
          disabled={!draft.trim()}
          className={[styles.btn, styles.amber].join(' ')}
          aria-label="Save admin token"
        >
          Save
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={state === 'none' && !draft}
          className={styles.btn}
          aria-label="Clear admin token"
        >
          Clear
        </button>
      </div>
      <div id="admin-token-status" role="status" className={styles.status}>{STATUS[state]}</div>
    </div>
  );
}
