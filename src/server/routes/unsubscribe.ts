/**
 * `/unsubscribe?t=<token>`, the link in the footer and the
 * List-Unsubscribe header of every Paracosm email
 * (`../services/optional-mail.ts`).
 *
 * - GET (and HEAD) only asks. Link scanners and mail previews follow links,
 *   so a GET shows a page with one button and changes nothing.
 * - POST stops all mail to the address the link was sent to, at once. A
 *   mail program's one-click POST (RFC 8058, body
 *   `List-Unsubscribe=One-Click`) and the page's button do the same thing.
 *   There is no origin check, since a webmail posts from its own site, and
 *   the token is all it needs: it can only suppress.
 * - Nothing is ever emailed about an unsubscribe.
 * - An unknown token answers 404 and records nothing. A server that never
 *   sent mail has no mail store and creates none.
 *
 * @module paracosm/cli/server/unsubscribe-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { openMailStore, UNSUBSCRIBE_TOKEN_PATTERN } from '../stores/mail-suppression.js';

export interface UnsubscribeRouteOptions {
  /** The mail store the broadcast script writes (`mailDbPath(APP_DIR)`). */
  mailDbPath: string;
}

const SUPPORT_EMAIL = 'team@frame.dev';

type PageState = 'ask' | 'already' | 'done' | 'unknown';

function page(state: PageState, token: string): string {
  const action = `/unsubscribe?t=${token}`;
  const nothingElse =
    '<p>Paracosm sends no account, sign-in or receipt email, so after this no email from Paracosm reaches this address.</p>';
  const deletion = `<p>To have the address deleted from our list as well, write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>`;
  const bodies: Record<PageState, { title: string; html: string }> = {
    ask: {
      title: 'Unsubscribe from Paracosm email',
      html: `<h1>Unsubscribe from Paracosm email</h1>
<p>Press the button and Paracosm sends no more email to the address this link was sent to. It takes effect at once, and we send no email to confirm it.</p>
<form method="post" action="${action}"><button type="submit">Unsubscribe</button></form>
${nothingElse}
${deletion}`,
    },
    already: {
      title: 'This address is unsubscribed',
      html: `<h1>This address is unsubscribed</h1>
<p>This address is unsubscribed. Paracosm sends it no more email.</p>
${nothingElse}
${deletion}`,
    },
    done: {
      title: 'You are unsubscribed',
      html: `<h1>You are unsubscribed</h1>
<p>You are unsubscribed. Paracosm sends no more email to this address, starting now, and no email to confirm it.</p>
${nothingElse}
${deletion}`,
    },
    unknown: {
      title: 'This link is not valid',
      html: `<h1>This link is not valid</h1>
<p>This unsubscribe link is not valid. If Paracosm email keeps reaching you, write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> and we will stop it.</p>`,
    },
  };
  const { title, html } = bodies[state];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${title} · Paracosm</title>
<style>
:root { color-scheme: light dark; --bg: #faf6f1; --fg: #1a1410; --muted: #5c4a3d; --accent: #a5531f; --button-fg: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg: #0a0806; --fg: #f5e6d3; --muted: #c9b5a3; --accent: #e8b44a; --button-fg: #0a0806; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
main { max-width: 34rem; margin: 0 auto; padding: 48px 16px; }
h1 { font-size: 1.6rem; line-height: 1.3; margin: 0 0 16px; }
p { margin: 0 0 16px; color: var(--muted); }
a { color: var(--accent); }
button { font: inherit; font-weight: 700; min-height: 48px; padding: 12px 28px; border: 0; border-radius: 8px; background: var(--accent); color: var(--button-fg); cursor: pointer; margin: 8px 0 24px; }
.brand { font: 700 15px/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 1px; color: var(--accent); margin-bottom: 32px; }
</style>
</head>
<body>
<main>
<div class="brand">PARACOSM</div>
${html}
</main>
</body>
</html>`;
}

function send(res: ServerResponse, status: number, state: PageState, token: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(page(state, token));
}

/**
 * Answers `/unsubscribe`. Returns false for any other path, so the caller
 * goes on to its next route.
 */
export async function handleUnsubscribeRoute(
  req: IncomingMessage,
  res: ServerResponse,
  options: UnsubscribeRouteOptions,
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return false;
  }
  if (url.pathname !== '/unsubscribe') return false;

  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    res.writeHead(405, { Allow: 'GET, HEAD, POST', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return true;
  }
  // The body says nothing the link does not: discard it.
  if (method === 'POST') req.resume();

  const token = url.searchParams.get('t') ?? '';
  // Only a well-formed token is looked up or echoed into the page; and a
  // server with no mail store has sent no link, so it knows no token.
  if (!UNSUBSCRIBE_TOKEN_PATTERN.test(token) || !existsSync(options.mailDbPath)) {
    send(res, 404, 'unknown', '');
    return true;
  }

  const store = openMailStore({ dbPath: options.mailDbPath });
  try {
    if (method === 'POST') {
      const known = await store.unsubscribeByToken(token);
      send(res, known ? 200 : 404, known ? 'done' : 'unknown', token);
      return true;
    }
    const found = await store.findToken(token);
    if (!found) send(res, 404, 'unknown', token);
    else send(res, 200, found.suppressed ? 'already' : 'ask', token);
    return true;
  } catch (err) {
    console.warn('[unsubscribe] mail store failed:', err instanceof Error ? err.message : String(err));
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' });
    res.end(`Unsubscribe is not available right now. Try the link again in a minute, or write to ${SUPPORT_EMAIL}.`);
    return true;
  } finally {
    await store.close();
  }
}
