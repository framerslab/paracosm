/**
 * The operator's admin token in this browser.
 *
 * A server started with ADMIN_WRITE=true takes its admin writes only with
 * its ADMIN_TOKEN in the X-Admin-Token header. The dashboard sends it on
 * four calls: Save to Disk in the scenario editor, Delete server data in the
 * run actions menu, and Rename and Delete in a scenario's details. The
 * operator enters that token in Settings (AdminTokenField); it is kept under
 * one localStorage key and read here by the calls that send it. It goes out
 * as that header on those calls and nowhere else: never in a URL, never in
 * a log line, never on another request.
 *
 * A request header carries characters up to U+00FF only, and fetch throws
 * on any other. Save refuses such a token, and a call finds one stored
 * earlier, drops it and says why, before any request goes out.
 *
 * Every storage access is guarded. Where the browser cannot store the
 * token (storage blocked, or no room left), it is held in memory for this
 * page load, so the admin calls work until a reload. A held token is the
 * last one entered, so it is read before anything an earlier save stored.
 */

/** The localStorage key the token is kept under. The admin calls reach it through this module only. */
export const ADMIN_TOKEN_STORAGE_KEY = 'paracosm:adminToken';
/** The request header the server compares with its ADMIN_TOKEN. */
export const ADMIN_TOKEN_HEADER = 'X-Admin-Token';

/** Where a person enters the token. Shown after the server refuses a call. */
export const ADMIN_TOKEN_WHERE = 'Enter it in Settings, under Admin Token, and press Save.';

/**
 * Why a token was refused before any request went out, and which
 * characters a token may hold. Shown at Save, and by a call that found such
 * a token stored.
 */
export const ADMIN_TOKEN_UNSENDABLE =
  'This token holds a character a request header cannot carry, so it is not kept. '
  + 'A token may hold only printable ASCII and Latin-1 characters: U+0020 to U+007E and U+00A0 to U+00FF.';

/**
 * Whether `token` can go out as a request header: printable ASCII
 * (U+0020 to U+007E) and printable Latin-1 (U+00A0 to U+00FF) only. Control
 * characters and anything above U+00FF are refused.
 */
export function isSendableAdminToken(token: string): boolean {
  return /^[\x20-\x7E\xA0-\xFF]*$/.test(token);
}

/** `stored`: in this browser's storage. `held`: the browser could not store it, in memory until a reload. */
export type AdminTokenState = 'none' | 'stored' | 'held';

const CHANGED_EVENT = 'paracosm:admin-token-changed';

/** The token when the browser could not store it; empty otherwise. */
let held = '';

function announce(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

function readStored(): string {
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '';
  } catch {
    // Storage blocked, or no window: nothing stored.
    return '';
  }
}

/**
 * The token to send, or an empty string when none was entered. A held
 * token comes first: it was entered after whatever storage still has.
 */
export function readAdminToken(): string {
  return held || readStored();
}

/** Where the token {@link readAdminToken} returns is kept, or `none` when there is none. */
export function adminTokenState(): AdminTokenState {
  if (held) return 'held';
  return readStored() ? 'stored' : 'none';
}

/**
 * Keeps `value`, trimmed, for the admin calls. Returns `stored` when the
 * browser stored it and `held` when the browser could not and it lasts
 * until the page reloads. An empty value clears the token. A value
 * {@link isSendableAdminToken} refuses is not kept, and returns
 * `unsendable`; whatever token was kept before stays.
 */
export function saveAdminToken(value: string): AdminTokenState | 'unsendable' {
  const token = value.trim();
  if (!token) {
    clearAdminToken();
    return 'none';
  }
  if (!isSendableAdminToken(token)) return 'unsendable';
  let stored = false;
  try {
    window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    stored = true;
  } catch {
    // Storage blocked or full: hold it for this page load, and drop an
    // older token storage may still have, so a reload does not bring that
    // one back in place of this one.
    try {
      window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    } catch {
      // Storage blocked: there is nothing stored to remove.
    }
  }
  held = stored ? '' : token;
  announce();
  return stored ? 'stored' : 'held';
}

/**
 * Drops the token from this browser and from this page.
 *
 * A call the server refused passes `refused`, the token it was sent with
 * (an empty string when it was sent with none). The token is then dropped
 * only while it is still that one: a token entered after the call went out
 * is not the one the server refused, and stays.
 */
export function clearAdminToken(refused?: string): void {
  if (refused !== undefined && readAdminToken() !== refused) return;
  held = '';
  try {
    window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    // Storage blocked: there was nothing stored to remove.
  }
  announce();
}

/**
 * For a call about to send `token`: when the token cannot go out as a
 * header, drops it (while it is still the one kept) and returns the message
 * to show, which ends by saying where to enter a token. Returns null when
 * the token can be sent.
 */
export function dropUnsendableAdminToken(token: string): string | null {
  if (isSendableAdminToken(token)) return null;
  clearAdminToken(token);
  return `${ADMIN_TOKEN_UNSENDABLE} ${ADMIN_TOKEN_WHERE}`;
}

/**
 * Calls `callback` when the token is saved or cleared on this page, or in
 * another tab of this browser. Returns the function that stops it.
 */
export function subscribeAdminToken(callback: () => void): () => void {
  const onChange = () => callback();
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ADMIN_TOKEN_STORAGE_KEY) callback();
  };
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
