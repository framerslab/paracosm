/**
 * What the first screen says when a run cannot start, the saved run it
 * offers in Start's place at the day's limit, and the time the day's free
 * runs reset: a clock time with its time zone, in the visitor's own zone
 * and their browser's own format, and the clock face's hands.
 *
 * The expected strings are assembled from Intl in the test, so the runner's
 * own data decides the glyphs (the space before PM, the zone's short name).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  atLimitChoice,
  classifyLaunchFailure,
  clockHands,
  formatResetTime,
  resetClockTime,
} from '../../../src/dashboard/src/components/quickstart/first-screen/launchFailure.js';

/** Midnight UTC on 22 Nov 2026, when a day's count resets. */
const RESET = Date.UTC(2026, 10, 22, 0, 0, 0);

/** The parts Intl gives for the reset time in a locale and zone. */
function parts(locale: string, timeZone: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone }).formatToParts(new Date(RESET))) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return out;
}

test('formatResetTime: a 4:00 PM time with its zone in Los Angeles', () => {
  const said = formatResetTime(RESET, 'en-US', 'America/Los_Angeles');
  const p = parts('en-US', 'America/Los_Angeles');
  // Midnight UTC is 4:00 in the afternoon of the day before, Pacific Standard Time.
  assert.equal(Number(p.hour), 4);
  assert.equal(p.minute, '00');
  assert.match(p.dayPeriod, /^pm$/i);
  assert.equal(p.timeZoneName, 'PST');
  assert.equal(said, new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/Los_Angeles' }).format(new Date(RESET)));
  for (const piece of [`${p.hour}:${p.minute}`, p.dayPeriod, p.timeZoneName]) assert.ok(said.includes(piece), `${said} holds ${piece}`);
});

test('formatResetTime: a 01:00 time with its zone in Berlin', () => {
  for (const locale of ['en-GB', 'de-DE']) {
    const said = formatResetTime(RESET, locale, 'Europe/Berlin');
    const p = parts(locale, 'Europe/Berlin');
    // Midnight UTC is one in the morning, Central European Time, on a 24-hour clock with no AM or PM.
    assert.equal(Number(p.hour), 1, locale);
    assert.equal(p.minute, '00', locale);
    assert.equal(p.dayPeriod, undefined, locale);
    assert.ok(p.timeZoneName.length > 0, locale);
    assert.equal(said, new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'Europe/Berlin' }).format(new Date(RESET)));
    for (const piece of [`${p.hour}:${p.minute}`, p.timeZoneName]) assert.ok(said.includes(piece), `${said} holds ${piece}`);
  }
  // The zone's short name as English names it.
  assert.equal(parts('en-GB', 'Europe/Berlin').timeZoneName, 'CET');
});

test('formatResetTime: the browser\'s own locale and zone when none is named, and nothing for a time that is none', () => {
  assert.equal(formatResetTime(RESET), new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(RESET)));
  assert.equal(formatResetTime(Number.NaN), '');
  assert.equal(formatResetTime(RESET, 'en-US', 'Not/AZone'), '');
});

test('classifyLaunchFailure: by the answer, never by its words', () => {
  // No answer at all, or a page that is offline.
  assert.equal(classifyLaunchFailure({ networkError: true }).kind, 'offline');
  assert.equal(classifyLaunchFailure({ status: 500, body: {}, online: false }).kind, 'offline');
  // POST /setup's own refusal at the day's limit.
  assert.equal(classifyLaunchFailure({ status: 429, body: { error: 'Rate limit exceeded.', limit: 1, remaining: 0 } }).kind, 'limit');
  // The same answer from the route that writes the leaders is that route's own limit, never the day's limit of runs.
  assert.equal(classifyLaunchFailure({ status: 429, body: { error: 'Rate limit exceeded.', limit: 20, remaining: 0 }, request: 'leaders' }).kind, 'other');
  assert.equal(classifyLaunchFailure({ status: 429, body: { error: 'Rate limit exceeded.', limit: 1, remaining: 0 }, request: 'setup' }).kind, 'limit');
  // A full server names the most runs it holds.
  assert.equal(classifyLaunchFailure({ status: 503, body: { error: 'x', runsInFlight: 3, maxRuns: 3 } }).kind, 'slots');
  // Any other 429 or 503 is a busy server, whatever its words say.
  assert.equal(classifyLaunchFailure({ status: 503, body: { error: 'Every run slot is in use' } }).kind, 'busy');
  assert.equal(classifyLaunchFailure({ status: 503, body: { error: 'x', maxRuns: '3' } }).kind, 'busy');
  assert.equal(classifyLaunchFailure({ status: 429, body: { error: 'x', remaining: 1 } }).kind, 'busy');
  assert.equal(classifyLaunchFailure({ status: 429 }).kind, 'busy');
  // Anything else.
  assert.equal(classifyLaunchFailure({ status: 500, body: { error: 'x' } }).kind, 'other');
  assert.equal(classifyLaunchFailure({ status: 400, body: { remaining: 0 } }).kind, 'other');
  assert.equal(classifyLaunchFailure({}).kind, 'other');
});

test('atLimitChoice: the visitor\'s own newest run, else the team\'s newest pair, else neither', () => {
  const own = { id: 'own', createdAt: 3, leaderA: 'Aria Chen', leaderB: 'Dietrich Voss' };
  const olderOwn = { id: 'older-own', createdAt: 1, leaderA: 'Aria Chen', leaderB: 'Dietrich Voss' };
  const teamPair = { id: 'team-pair', createdAt: 5, pinned: true, leaderA: 'Aria Chen', leaderB: 'Dietrich Voss' };
  const teamCohort = { id: 'team-24', createdAt: 9, pinned: true, leaderA: 'L1', leaderB: 'L2', leaders: Array.from({ length: 24 }, (_, i) => `L${i + 1}`) };

  // An own run comes first, newest by when it was made, before any team run.
  assert.deepEqual(atLimitChoice([teamPair, olderOwn, own]), { kind: 'own', row: own });
  // A pinned pair found by its two leader fields, with no leaders list.
  assert.deepEqual(atLimitChoice([teamPair]), { kind: 'team', row: teamPair });
  // A pinned pair that lists its two leaders.
  const listedPair = { id: 'team-listed', createdAt: 2, pinned: true, leaders: ['Aria Chen', 'Dietrich Voss'] };
  assert.deepEqual(atLimitChoice([listedPair]), { kind: 'team', row: listedPair });
  // A pinned cohort of 24 is left out, even when it is the newest.
  assert.deepEqual(atLimitChoice([teamCohort]), { kind: 'neither' });
  assert.deepEqual(atLimitChoice([teamCohort, teamPair]), { kind: 'team', row: teamPair });
  // A pinned row with only one leader named is not a pair.
  assert.deepEqual(atLimitChoice([{ id: 'half', createdAt: 1, pinned: true, leaderA: 'Aria Chen' }]), { kind: 'neither' });
  // An empty list.
  assert.deepEqual(atLimitChoice([]), { kind: 'neither' });
});

test('resetClockTime and clockHands: the clock face set to the reset time in the visitor\'s zone', () => {
  // Midnight UTC is 16:00 the day before in Los Angeles and 01:00 in Berlin.
  assert.deepEqual(resetClockTime(RESET, 'America/Los_Angeles'), { hour: 16, minute: 0 });
  assert.deepEqual(resetClockTime(RESET, 'Europe/Berlin'), { hour: 1, minute: 0 });
  assert.deepEqual(resetClockTime(RESET, 'UTC'), { hour: 0, minute: 0 });
  assert.equal(resetClockTime(Number.NaN), null);
  assert.equal(resetClockTime(RESET, 'Not/AZone'), null);
  // The hour hand points at the hour on a 12-hour face and moves on half a degree a minute.
  assert.deepEqual(clockHands({ hour: 16, minute: 0 }), { hour: 120, minute: 0 });
  assert.deepEqual(clockHands({ hour: 1, minute: 30 }), { hour: 45, minute: 180 });
  assert.deepEqual(clockHands({ hour: 0, minute: 0 }), { hour: 0, minute: 0 });
  assert.deepEqual(clockHands({ hour: 23, minute: 59 }), { hour: 359.5, minute: 354 });
});
