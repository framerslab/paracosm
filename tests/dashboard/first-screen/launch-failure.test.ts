/**
 * The time the day's free runs reset, as the first screen says it: a clock
 * time with its time zone, in the visitor's own zone and their browser's
 * own format.
 *
 * The expected strings are assembled from Intl in the test, so the runner's
 * own data decides the glyphs (the space before PM, the zone's short name).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatResetTime } from '../../../src/dashboard/src/components/quickstart/first-screen/launchFailure.js';

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
