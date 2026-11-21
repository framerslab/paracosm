/**
 * The forge view's events reach a vendor only under the visitor's yes to its
 * purpose, and carry only the fields their type names. The page is a stand-in
 * for the one the hosted demo serves: the consent script's
 * `paracosmConsent.allows` and the two vendors' functions, each recording
 * what it was called with.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { actorRange, sendForgeEvent, type ForgeEvent } from './forgeEvents';

interface FakePage {
  window: Window;
  gtag: unknown[][];
  clarity: unknown[][];
}

/** A page whose consent script says yes to the purposes given; with `yes` null, a page with no consent script. */
function page(yes: Array<'count' | 'measure' | 'record'> | null): FakePage {
  const gtag: unknown[][] = [];
  const clarity: unknown[][] = [];
  const w: Record<string, unknown> = {
    gtag: (...args: unknown[]) => { gtag.push(args); },
    clarity: (...args: unknown[]) => { clarity.push(args); },
  };
  const purposes: readonly string[] | null = yes;
  if (purposes !== null) w.paracosmConsent = Object.freeze({ allows: (purpose: string) => purposes.includes(purpose) });
  return { window: w as unknown as Window, gtag, clarity };
}

const STATION_OPEN: ForgeEvent = { name: 'forge_station_open', station: 'judge', via: 'press' };

test('with no consent script, or no yes to measure or record, no vendor is called', () => {
  for (const yes of [null, [], ['count']] as const) {
    const p = page(yes === null ? null : [...yes]);
    sendForgeEvent(STATION_OPEN, p.window);
    sendForgeEvent({ name: 'forge_toolbox_open', from: 'sim' }, p.window);
    sendForgeEvent({ name: 'forge_log_jump' }, p.window);
    assert.deepEqual(p.gtag, [], `${JSON.stringify(yes)}: Google Analytics is not called`);
    assert.deepEqual(p.clarity, [], `${JSON.stringify(yes)}: Clarity is not called`);
  }
  // A consent script whose answer cannot be read counts as no.
  const broken = page(null);
  (broken.window as unknown as Record<string, unknown>).paracosmConsent = { allows: () => { throw new Error('unreadable'); } };
  sendForgeEvent(STATION_OPEN, broken.window);
  assert.deepEqual([broken.gtag, broken.clarity], [[], []]);
});

test('with a yes to measure alone, Google Analytics gets the event and its fields, and Clarity nothing', () => {
  const p = page(['measure']);
  sendForgeEvent(STATION_OPEN, p.window);
  sendForgeEvent({ name: 'forge_link_copy' }, p.window);
  assert.deepEqual(p.gtag, [
    ['event', 'forge_station_open', { station: 'judge', via: 'press' }],
    ['event', 'forge_link_copy', {}],
  ]);
  assert.deepEqual(p.clarity, []);
});

test('Google Analytics gets the page by its address with no query, so a search or a tool named in the address stays on the page', () => {
  const p = page(['measure']);
  // Google's tag sends the page's address with every event unless the event names one: the address here holds a search and a tool.
  (p.window as unknown as Record<string, unknown>).location = new URL('https://demo.example/sim?replay=r1&toolbox=1&find=radiation_dose&tool=3&open=judge');
  sendForgeEvent(STATION_OPEN, p.window);
  assert.equal(p.gtag.length, 1);
  const params = p.gtag[0][2] as Record<string, unknown>;
  assert.equal(params.page_location, 'https://demo.example/sim');
  assert.equal(params.station, 'judge');
  assert.ok(!JSON.stringify(p.gtag).includes('radiation_dose'), 'the search reaches no vendor');
});

test('with a yes to record alone, Clarity gets the event by its name alone, and Google Analytics nothing', () => {
  const p = page(['record']);
  sendForgeEvent(STATION_OPEN, p.window);
  assert.deepEqual(p.clarity, [['event', 'forge_station_open']]);
  assert.deepEqual(p.gtag, []);
});

test('a field not in the event\'s type, or a value off its list, never reaches either vendor', () => {
  const p = page(['measure', 'record']);
  const padded = {
    name: 'forge_trace_open',
    from: 'toolbox',
    toolName: 'habitat_pressure_check',
    actorName: 'Aria Chen',
    trace: { code: 'function execute(input) { return input; }' },
  } as unknown as ForgeEvent;
  sendForgeEvent(padded, p.window);
  // A tool's name passed where a station belongs is dropped, the rest of the event kept.
  sendForgeEvent({ name: 'forge_station_open', station: 'habitat_pressure_check', via: 'kept' } as unknown as ForgeEvent, p.window);
  sendForgeEvent({ name: 'forge_actor_filter', actors: 'Aria Chen' } as unknown as ForgeEvent, p.window);
  assert.deepEqual(p.gtag, [
    ['event', 'forge_trace_open', { from: 'toolbox' }],
    ['event', 'forge_station_open', { via: 'kept' }],
    ['event', 'forge_actor_filter', {}],
  ]);
  assert.deepEqual(p.clarity, [
    ['event', 'forge_trace_open'],
    ['event', 'forge_station_open'],
    ['event', 'forge_actor_filter'],
  ]);
});

test('the actors chosen are reported as 1, 2 to 4, 5 to 24 or 25 or more, and none chosen is no filter', () => {
  const ranges = [0, 1, 2, 4, 5, 24, 25, 300].map(actorRange);
  assert.deepEqual(ranges, [null, '1', '2-4', '2-4', '5-24', '5-24', '25+', '25+']);
});
