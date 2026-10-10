/**
 * POST /api/waitlist handler. The landing-page waitlist is closed: the
 * route answers 410 Gone with `{ error: 'waitlist_closed' }` and stores
 * nothing. The signups collected while it was open stay in the waitlist
 * store (`../stores/waitlist.ts`), where
 * `scripts/send-waitlist-broadcast.ts` reads them.
 *
 * @module paracosm/cli/server/waitlist-route
 */
import type { ServerResponse } from 'node:http';

/**
 * Answers a waitlist signup with 410 Gone. It reads no request body,
 * sends no email and never opens the waitlist store.
 */
export function handleWaitlistClosed(res: ServerResponse): void {
  res.writeHead(410, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'waitlist_closed' }));
}
