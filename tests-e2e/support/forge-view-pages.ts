/**
 * What the forged tool view spec shares between its tests: the two servers
 * that store its runs, the widths and looks it walks, and how it finds a
 * stored run and opens its replay.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** The stored pair run: tests-e2e/support/shared-run-server.ts. */
export const PAIR_SERVER = 'http://127.0.0.1:3462';
/** The generated runs of 24 and 300 actors: tests-e2e/support/cohort-run-server.ts. */
export const COHORT_SERVER = 'http://127.0.0.1:3466';
/** Where the spec saves its pictures, which CI uploads. */
export const PICTURES = 'test-pictures/forged-tool-view';

/** A phone and a desktop. */
export const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;
/** The widths a row of keys is checked at. */
export const SWEEP_WIDTHS = [320, 360, 390, 430, 480, 768] as const;
export const LOOKS = ['light', 'dark'] as const;
export type Look = (typeof LOOKS)[number];

/** The names the cohort server stores its runs under. */
export const RUNS = {
  dozens: 'Mars Genesis · 24 actors',
  maximum: 'Mars Genesis · 300 actors',
  dozensA7Unreadable: 'Mars Genesis · 24 actors, A7 unreadable',
  reportOnlyPair: 'Mars Genesis · report-only pair',
  noForgePair: 'Mars Genesis · no forge',
} as const;

/** Opens every page of the test in one look. */
export async function useLook(page: Page, look: Look): Promise<void> {
  await page.addInitScript((t) => { window.localStorage.setItem('paracosm-theme', t); }, look);
}

interface StoredSession { id: string; scenarioName?: string }

async function storedSessions(request: APIRequestContext, server: string): Promise<StoredSession[]> {
  const res = await request.get(`${server}/sessions`);
  expect(res.ok()).toBe(true);
  return (await res.json() as { sessions: StoredSession[] }).sessions;
}

/** The id of the one run a server stores under a scenario name, from its own GET /sessions. */
export async function sessionIdByName(request: APIRequestContext, server: string, scenarioName: string): Promise<string> {
  const found = (await storedSessions(request, server)).filter(s => s.scenarioName === scenarioName);
  expect(found, `one stored run named "${scenarioName}"`).toHaveLength(1);
  return found[0].id;
}

/** The id of the pair run, the one session its server stores. */
export async function pairSessionId(request: APIRequestContext): Promise<string> {
  const sessions = await storedSessions(request, PAIR_SERVER);
  expect(sessions).toHaveLength(1);
  return sessions[0].id;
}

/** The address that replays a stored run on one tab of the dashboard. */
export const replayUrl = (server: string, id: string, tab: string): string =>
  `${server}/sim?replay=${encodeURIComponent(id)}&tab=${tab}`;
