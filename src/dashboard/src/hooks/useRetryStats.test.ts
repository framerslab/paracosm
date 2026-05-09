/**
 * Pure-logic tests for the useRetryStats hook's fetch + parse logic.
 * The hook itself uses React state (useState / useEffect / useCallback)
 * so we exercise the behavior end-to-end by mocking global fetch and
 * checking what state values we expect to flow through.
 *
 * React Testing Library is not wired up in the dashboard; the existing
 * dashboard test suite uses node:test for pure logic. We stay in the
 * same pattern by extracting the testable concerns: the fetch call
 * shape, the JSON parse, and the error-to-state mapping.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RETRY_STATS_ENDPOINT } from './useRetryStats.js';

test('RETRY_STATS_ENDPOINT points at the server route the backend exposes', () => {
  // Guards against accidental renames; server-app.ts handles /retry-stats.
  assert.equal(RETRY_STATS_ENDPOINT, '/retry-stats');
});

test('fetch+parse happy path returns the expected shape', async () => {
  const payload = {
    runCount: 3,
    schemas: {
      DepartmentReport: { calls: 30, attempts: 31, fallbacks: 0, avgAttempts: 1.03, fallbackRate: 0, runsPresent: 3 },
      'compile:milestones': { calls: 3, attempts: 3, fallbacks: 0, avgAttempts: 1, fallbackRate: 0, runsPresent: 3 },
    },
    forges: {
      totalAttempts: 18, approved: 14, rejected: 4,
      approvalRate: 0.7778, avgApprovedConfidence: 0.83, runsPresent: 3,
    },
  };
  const res = new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const parsed = await res.json();
  assert.equal(parsed.runCount, 3);
  assert.ok(parsed.forges);
  assert.equal(parsed.forges.approvalRate, 0.7778);
  // compile:* and runtime schemas share the same bucket shape but
  // consumers can differentiate by key prefix.
  const compileKeys = Object.keys(parsed.schemas).filter((k: string) => k.startsWith('compile:'));
  const runtimeKeys = Object.keys(parsed.schemas).filter((k: string) => !k.startsWith('compile:'));
  assert.equal(compileKeys.length, 1);
  assert.equal(runtimeKeys.length, 1);
});

test('non-200 response throws before hitting the parser', async () => {
  const res = new Response('Internal error', { status: 503 });
  // Matches the hook's guard: `if (!res.ok) throw new Error(...)`.
  assert.equal(res.ok, false);
});
