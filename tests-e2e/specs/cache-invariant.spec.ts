/**
 * Cache-invariant smoke test (Track 3A end-to-end half).
 *
 * The deep regression coverage lives in `src/server/auto-save-gate.test.ts`.
 * This spec is intentionally minimal: it validates that `/sessions`
 * returns the expected shape and that any cached row carries the fields
 * the dashboard's session listing UI needs. A failure here means a
 * deploy went out with a bad shape — the user-visible LoadMenu would
 * silently misrender, which the structural test catches without needing
 * to drive a real run.
 */
import { test, expect } from '@playwright/test';

interface SessionRow {
  id: string;
  createdAt: number;
  eventCount: number;
  scenarioName?: string;
  title?: string | null;
}

test('GET /sessions responds with a typed array (or an empty list on a fresh server)', async ({ request }) => {
  const res = await request.get('/sessions');
  expect(res.status(), `GET /sessions returned ${res.status()}`).toBeLessThan(500);
  const body = (await res.json()) as { sessions?: SessionRow[] };
  expect(Array.isArray(body.sessions ?? []), 'body.sessions must be an array').toBe(true);
  for (const s of body.sessions ?? []) {
    expect(typeof s.id, `session.id must be a string`).toBe('string');
    expect(typeof s.createdAt, `session.createdAt must be a number`).toBe('number');
    expect(typeof s.eventCount, `session.eventCount must be a number`).toBe('number');
    // A row reaching /sessions has crossed every auto-save gate. If it
    // contains a sim_error or sim_aborted event, the upstream gate
    // failed — but we don't have the events here (intentional, to keep
    // the listing payload small). The unit tests cover the gate.
  }
});
