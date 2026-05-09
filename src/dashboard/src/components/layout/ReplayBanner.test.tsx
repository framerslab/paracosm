import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { ReplayBanner } from './ReplayBanner.js';

// SSR-only render: the banner fetches `/sessions/:id` from useEffect on
// mount, which doesn't fire under react-dom/server. That's fine — the
// banner's fallback rendering ("saved run" with no subline) is exactly
// what we want to assert against, since it isolates the visual contract
// from any session-data variability.

test('ReplayBanner: no inline opacity hacks on the muted spans', () => {
  const html = renderToString(<ReplayBanner replaySessionId="abc" />);
  // Prior bug: muted spans used `style={{ opacity: 0.7 }}` and
  // `style={{ opacity: 0.55 }}` to dim text on top of the rust accent.
  // Those drop contrast below WCAG AA. Post-fix: muted text comes from
  // the token classes (--text-2 / --text-3), no inline opacity.
  assert.equal(
    html.includes('opacity:0.55') || html.includes('opacity:0.7') || html.includes('opacity: 0.55') || html.includes('opacity: 0.7'),
    false,
    `Inline opacity hack still present in rendered HTML: ${html}`,
  );
});

test('ReplayBanner: cached-playback tag is preceded by a separator (no run-on with the timestamp)', () => {
  const html = renderToString(<ReplayBanner replaySessionId="abc" />);
  // The bug surfaced as "8:28 AMcached playback (no new LLM cost)" with
  // no separator. Post-fix: a leading "· " character precedes the tag,
  // independent of the inline whitespace from React's text rendering.
  assert.match(html, /·\s*cached playback/);
});

test('ReplayBanner: REPLAYING strong + EXIT REPLAY button still render', () => {
  const html = renderToString(<ReplayBanner replaySessionId="abc" />);
  assert.match(html, /<strong[^>]*>REPLAYING<\/strong>/);
  assert.match(html, /EXIT REPLAY/);
});
