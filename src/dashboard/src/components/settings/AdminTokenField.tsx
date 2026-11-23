import { useEffect, useRef, useState } from 'react';
import {
  ADMIN_TOKEN_UNSENDABLE,
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
 * written through admin-token.ts, which the four admin calls read; this
 * field never holds a saved token in its input and never shows one back.
 * The input and its two buttons stay on one row at every width.
 *
 * The input is uncontrolled: React mirrors a controlled input's value into
 * its value attribute, which would put typed text in the page markup. The
 * component keeps only whether anything is typed, for the Save button.
 */
export function AdminTokenField() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(false);
  const [state, setState] = useState<AdminTokenState>(() => adminTokenState());
  const [refusal, setRefusal] = useState<string | null>(null);

  // A call the server refused clears the token; so can another tab.
  useEffect(() => subscribeAdminToken(() => setState(adminTokenState())), []);

  const empty = () => {
    if (inputRef.current) inputRef.current.value = '';
    setTyped(false);
  };

  const save = () => {
    const value = inputRef.current?.value ?? '';
    if (!value.trim()) return;
    const saved = saveAdminToken(value);
    if (saved === 'unsendable') {
      // Kept in the input, so a mistyped character can be put right.
      setRefusal(ADMIN_TOKEN_UNSENDABLE);
      return;
    }
    setRefusal(null);
    setState(saved);
    empty();
  };

  const clear = () => {
    clearAdminToken();
    setState('none');
    setRefusal(null);
    empty();
  };

  return (
    <div>
      <p className={styles.intro}>
        Admin writes on this server take its <code>ADMIN_TOKEN</code>: Save to Disk in the scenario editor below,
        Delete server data in the run actions menu, and Rename and Delete in a scenario&apos;s details. Enter the
        token once. The dashboard sends it only on those requests, as the <code>X-Admin-Token</code> header, and
        keeps it in this browser.
      </p>
      <label htmlFor="admin-token" className={styles.label}>Token for this server</label>
      <div className={styles.row}>
        <input
          id="admin-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          ref={inputRef}
          onChange={e => { setTyped(e.target.value.trim() !== ''); setRefusal(null); }}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          placeholder={state === 'none' ? 'Not entered' : 'Saved'}
          aria-describedby="admin-token-status"
          className={styles.input}
        />
        <button
          type="button"
          onClick={save}
          disabled={!typed}
          className={[styles.btn, styles.amber].join(' ')}
          aria-label="Save admin token"
        >
          Save
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={state === 'none' && !typed}
          className={styles.btn}
          aria-label="Clear admin token"
        >
          Clear
        </button>
      </div>
      <div id="admin-token-status" role="status" className={styles.status}>{STATUS[state]}</div>
      {refusal && <p role="alert" className={styles.refusal}>{refusal}</p>}
    </div>
  );
}
