/**
 * One visitor of the dashboard server: fetch with a cookie jar.
 *
 * A browser keeps the Set-Cookie of each answer and sends the cookie back
 * on its next same-origin request. The scenario a visitor picked rides on
 * that cookie (paracosm_scenario), so a test of two visitors needs a jar
 * for each.
 */
export interface Visitor {
  get(path: string): Promise<Response>;
  post(path: string, payload: unknown): Promise<Response>;
  /** GET a path and parse its JSON. */
  json<T = Record<string, unknown>>(path: string): Promise<T>;
  /** The cookies this visitor holds, name to value. */
  readonly cookies: Map<string, string>;
}

/**
 * A visitor of the server at `base` (`http://127.0.0.1:<port>`). It keeps
 * the name and value of every Set-Cookie its answers carry and sends them
 * back as one Cookie header on its next requests, as a browser does on the
 * same origin; attributes such as Max-Age are not enforced.
 * `initialCookies` starts the jar, for a visitor who arrives holding a
 * cookie (a stale pick, a pick from before a restart).
 */
export function visitor(base: string, initialCookies: Record<string, string> = {}): Visitor {
  const cookies = new Map(Object.entries(initialCookies));
  const send = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (cookies.size > 0) {
      headers.set('Cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const res = await fetch(`${base}${path}`, { ...init, headers });
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';', 1)[0];
      const eq = pair.indexOf('=');
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return res;
  };
  return {
    cookies,
    get: path => send(path),
    post: (path, payload) => send(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    json: async <T>(path: string) => {
      const res = await send(path);
      return await res.json() as T;
    },
  };
}
