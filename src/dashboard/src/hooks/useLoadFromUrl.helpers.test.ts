/**
 * Pure-logic tests for useLoadFromUrl's helpers. URL parsing and file
 * name derivation live in the helpers file so they run under node:test
 * without a browser shim, matching the dashboard pattern.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLoadUrlParam,
  deriveFileNameFromUrl,
  isCrossOrigin,
  parseAutoloadParam,
  parseDestinationTabParam,
} from './useLoadFromUrl.helpers.js';

// -- parseLoadUrlParam ----------------------------------------------------

test('parseLoadUrlParam: https URL -> ok', () => {
  const r = parseLoadUrlParam('http://dash/sim?load=https://example.com/r.json');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.url.toString(), 'https://example.com/r.json');
});

test('parseLoadUrlParam: http URL -> ok (allowed for local dev)', () => {
  const r = parseLoadUrlParam('http://dash/sim?load=http://localhost:8000/run.json');
  assert.equal(r.ok, true);
});

test('parseLoadUrlParam: javascript: scheme -> unsupported-scheme', () => {
  const r = parseLoadUrlParam('http://dash/sim?load=javascript:alert(1)');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'unsupported-scheme');
});

test('parseLoadUrlParam: file: scheme -> unsupported-scheme', () => {
  const r = parseLoadUrlParam('http://dash/sim?load=file:///etc/passwd');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'unsupported-scheme');
});

test('parseLoadUrlParam: data: scheme -> unsupported-scheme', () => {
  const r = parseLoadUrlParam('http://dash/sim?load=data:application/json,{}');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'unsupported-scheme');
});

test('parseLoadUrlParam: no load param -> missing', () => {
  const r = parseLoadUrlParam('http://dash/sim');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'missing');
});

test('parseLoadUrlParam: empty load param -> missing', () => {
  const r = parseLoadUrlParam('http://dash/sim?load=');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'missing');
});

test('parseLoadUrlParam: malformed url value -> malformed', () => {
  // `not a url` is decoded from query, then URL() throws.
  const r = parseLoadUrlParam('http://dash/sim?load=not%20a%20url');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'malformed');
});

test('parseLoadUrlParam: preserves other query params when parsing load', () => {
  // Presence of unrelated params should not affect parse.
  const r = parseLoadUrlParam('http://dash/sim?tab=sim&load=https://example.com/r.json');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.url.pathname, '/r.json');
});

// -- deriveFileNameFromUrl ------------------------------------------------

test('deriveFileNameFromUrl: path with file -> last segment', () => {
  assert.equal(
    deriveFileNameFromUrl(new URL('https://example.com/runs/mars.json')),
    'mars.json',
  );
});

test('deriveFileNameFromUrl: root path -> fallback', () => {
  assert.equal(
    deriveFileNameFromUrl(new URL('https://example.com/')),
    'remote-run.json',
  );
});

test('deriveFileNameFromUrl: empty path -> fallback', () => {
  assert.equal(
    deriveFileNameFromUrl(new URL('https://example.com')),
    'remote-run.json',
  );
});

test('deriveFileNameFromUrl: deep path -> last segment', () => {
  assert.equal(
    deriveFileNameFromUrl(new URL('https://example.com/a/b/c/file')),
    'file',
  );
});

test('deriveFileNameFromUrl: URL with query -> ignores query, uses path', () => {
  assert.equal(
    deriveFileNameFromUrl(new URL('https://example.com/runs/mars.json?t=123&sig=abc')),
    'mars.json',
  );
});

test('deriveFileNameFromUrl: URL-encoded characters in segment decoded', () => {
  assert.equal(
    deriveFileNameFromUrl(new URL('https://example.com/run%20mars.json')),
    'run mars.json',
  );
});

// -- isCrossOrigin --------------------------------------------------------

test('isCrossOrigin: same origin -> false', () => {
  assert.equal(
    isCrossOrigin(new URL('https://dash.example.com/a.json'), 'https://dash.example.com/sim'),
    false,
  );
});

test('isCrossOrigin: different host -> true', () => {
  assert.equal(
    isCrossOrigin(new URL('https://other.com/a.json'), 'https://dash.example.com/sim'),
    true,
  );
});

test('isCrossOrigin: different port -> true', () => {
  assert.equal(
    isCrossOrigin(new URL('https://dash.example.com:8443/a.json'), 'https://dash.example.com/sim'),
    true,
  );
});

test('isCrossOrigin: different scheme -> true', () => {
  assert.equal(
    isCrossOrigin(new URL('http://dash.example.com/a.json'), 'https://dash.example.com/sim'),
    true,
  );
});

// -- parseAutoloadParam ---------------------------------------------------

test('parseAutoloadParam: autoload=1 -> true', () => {
  assert.equal(parseAutoloadParam('http://dash/sim?autoload=1'), true);
});

test('parseAutoloadParam: autoload=true (any case) -> true', () => {
  assert.equal(parseAutoloadParam('http://dash/sim?autoload=true'), true);
  assert.equal(parseAutoloadParam('http://dash/sim?autoload=TRUE'), true);
  assert.equal(parseAutoloadParam('http://dash/sim?autoload=True'), true);
});

test('parseAutoloadParam: autoload=0 -> false', () => {
  assert.equal(parseAutoloadParam('http://dash/sim?autoload=0'), false);
});

test('parseAutoloadParam: autoload=false -> false', () => {
  assert.equal(parseAutoloadParam('http://dash/sim?autoload=false'), false);
});

test('parseAutoloadParam: missing param -> false', () => {
  assert.equal(parseAutoloadParam('http://dash/sim'), false);
});

test('parseAutoloadParam: empty value -> false', () => {
  assert.equal(parseAutoloadParam('http://dash/sim?autoload='), false);
});

test('parseAutoloadParam: garbage value -> false', () => {
  assert.equal(parseAutoloadParam('http://dash/sim?autoload=yes'), false);
});

test('parseAutoloadParam: bad outer href -> false', () => {
  assert.equal(parseAutoloadParam('not a url'), false);
});

// -- parseDestinationTabParam --------------------------------------------

const TABS = ['quickstart', 'sim', 'viz', 'settings', 'reports', 'chat', 'library', 'studio', 'about'] as const;

test('parseDestinationTabParam: tab=viz -> "viz"', () => {
  assert.equal(parseDestinationTabParam('http://dash/sim?tab=viz', TABS), 'viz');
});

test('parseDestinationTabParam: tab=sim -> "sim"', () => {
  assert.equal(parseDestinationTabParam('http://dash/sim?tab=sim', TABS), 'sim');
});

test('parseDestinationTabParam: tab=invalid -> null', () => {
  assert.equal(parseDestinationTabParam('http://dash/sim?tab=does-not-exist', TABS), null);
});

test('parseDestinationTabParam: missing tab -> null', () => {
  assert.equal(parseDestinationTabParam('http://dash/sim', TABS), null);
});

test('parseDestinationTabParam: empty tab -> null', () => {
  assert.equal(parseDestinationTabParam('http://dash/sim?tab=', TABS), null);
});

test('parseDestinationTabParam: bad outer href -> null', () => {
  assert.equal(parseDestinationTabParam('not a url', TABS), null);
});

test('parseDestinationTabParam: ignores other params', () => {
  assert.equal(
    parseDestinationTabParam(
      'http://dash/sim?load=https://e.com/r.json&tab=viz&autoload=1',
      TABS,
    ),
    'viz',
  );
});
