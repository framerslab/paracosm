import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { ProviderErrorBanner } from './ProviderErrorBanner.js';

// The banner's action link comes from the provider_error event, which a
// run file loaded from disk or from a ?load= link carries as it was
// written. The server only ever sends the provider pages of
// src/runtime/util/provider-errors.ts, so the banner links to those hosts
// alone and shows any other address as text.

const quota = (actionUrl: string) => ({
  kind: 'quota' as const,
  provider: 'openai',
  message: 'OpenAI credits exhausted.',
  actionUrl,
  leader: 'A',
});

test('ProviderErrorBanner: links to the provider billing page the server sends', () => {
  const html = renderToString(
    <ProviderErrorBanner providerError={quota('https://platform.openai.com/settings/organization/billing')} />,
  );
  assert.match(html, /<a [^>]*href="https:\/\/platform\.openai\.com\/settings\/organization\/billing"/);
  assert.match(html, /Add credits/);
});

test('ProviderErrorBanner: links to the Anthropic key page the server sends', () => {
  const html = renderToString(
    <ProviderErrorBanner
      providerError={{ kind: 'auth', provider: 'anthropic', message: 'bad key', actionUrl: 'https://console.anthropic.com/settings/keys' }}
    />,
  );
  assert.match(html, /<a [^>]*href="https:\/\/console\.anthropic\.com\/settings\/keys"/);
});

for (const hostile of [
  'https://evil.example/openai-billing',
  'https://platform.openai.com.evil.example/billing',
  'https://evil.example/@platform.openai.com/',
  'https://platform.openai.com@evil.example/billing',
  'ftp://platform.openai.com/billing',
  'not a url',
]) {
  test(`ProviderErrorBanner: an address on another host is text, not a link (${hostile})`, () => {
    const html = renderToString(<ProviderErrorBanner providerError={quota(hostile)} />);
    assert.equal(/<a\b/.test(html), false, `banner rendered a link for ${hostile}: ${html}`);
    // React escapes text; the address still shows so the visitor sees what the run named.
    const escaped = hostile.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    assert.ok(html.includes(escaped), `address missing from the banner text: ${html}`);
  });
}
