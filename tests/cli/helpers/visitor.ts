/**
 * One visitor of the dashboard server: fetch with a cookie jar.
 *
 * A browser keeps the Set-Cookie of each answer and sends the cookie back
 * on its next same-origin request. The scenario a visitor picked rides on
 * that cookie (paracosm_scenario), so a test of two visitors needs a jar
 * for each.
 */
export interface Visitor {
  get(path: string, init?: RequestInit): Promise<Response>;
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
 * cookie (a stale pick, a pick from before a restart). `headers` go on
 * every request, such as an `x-forwarded-for` that gives the visitor an
 * address of their own.
 */
export function visitor(base: string, initialCookies: Record<string, string> = {}, headers: Record<string, string> = {}): Visitor {
  const cookies = new Map(Object.entries(initialCookies));
  const send = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const sent = new Headers(init.headers);
    for (const [name, value] of Object.entries(headers)) sent.set(name, value);
    if (cookies.size > 0) {
      sent.set('Cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const res = await fetch(`${base}${path}`, { ...init, headers: sent });
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';', 1)[0];
      const eq = pair.indexOf('=');
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return res;
  };
  return {
    cookies,
    get: (path, init) => send(path, init),
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
