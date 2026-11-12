/**
 * The operator's admin token in this browser.
 *
 * A server started with ADMIN_WRITE=true takes its admin writes (Save to
 * Disk, the server wipe, the scenario delete) only with its ADMIN_TOKEN in
 * the X-Admin-Token header. The operator enters that token in Settings
 * (AdminTokenField); it is kept under one localStorage key and read here by
 * the calls that send it. It goes out as that header on those calls and
 * nowhere else: never in a URL, never in a log line, never on another
 * request.
 *
 * Every storage access is guarded. Where the browser blocks storage, the
 * token is held in memory for this page load, so the admin calls work until
 * a reload.
 */

export const ADMIN_TOKEN_STORAGE_KEY = 'paracosm:adminToken';
export const ADMIN_TOKEN_HEADER = 'X-Admin-Token';

/** Where a person enters the token. Shown after the server refuses a call. */
export const ADMIN_TOKEN_WHERE = 'Enter it in Settings, under Admin Token, and press Save.';

/** `stored`: in this browser's storage. `held`: storage is blocked, in memory until a reload. */
export type AdminTokenState = 'none' | 'stored' | 'held';

const CHANGED_EVENT = 'paracosm:admin-token-changed';

/** The token when the browser refused to store it; empty otherwise. */
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

/** The token to send, or an empty string when none was entered. */
export function readAdminToken(): string {
  return readStored() || held;
}

export function adminTokenState(): AdminTokenState {
  if (readStored()) return 'stored';
  return held ? 'held' : 'none';
}

/**
 * Keeps `value`, trimmed, for the admin calls. Returns `stored` when the
 * browser stored it and `held` when storage is blocked and it lasts until
 * the page reloads. An empty value clears the token.
 */
export function saveAdminToken(value: string): AdminTokenState {
  const token = value.trim();
  if (!token) {
    clearAdminToken();
    return 'none';
  }
  let stored = false;
  try {
    window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    stored = true;
  } catch {
    // Storage blocked: hold it for this page load.
  }
  held = stored ? '' : token;
  announce();
  return stored ? 'stored' : 'held';
}

/** Drops the token from this browser and from this page. */
export function clearAdminToken(): void {
  held = '';
  try {
    window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    // Storage blocked: there was nothing stored to remove.
  }
  announce();
}

/** The credential header for an admin call; no header when no token was entered. */
export function adminTokenHeader(): Record<string, string> {
  const token = readAdminToken();
  return token ? { [ADMIN_TOKEN_HEADER]: token } : {};
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
