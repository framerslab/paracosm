import test from 'node:test';
import assert from 'node:assert/strict';
import { renderYoureIn } from './email-templates.js';

const footer = {
  unsubscribeUrl: 'https://paracosm.agentos.sh/unsubscribe?t=abc',
  postalAddress: 'Example Sender LLC, 100 Test Street, Testville, NV 89000',
};

test('renderYoureIn includes brand assets and CTA, omits position', () => {
  const out = renderYoureIn({ email: 'ada@example.com', name: 'Ada', ...footer });
  assert.equal(out.subject, "You're in — Paracosm hosted access is open");
  assert.match(out.html, /You're in\./);
  assert.match(out.html, /Hi Ada,/);
  assert.match(out.html, /paracosm\.agentos\.sh\/brand\/favicons\/favicon-192\.png/);
  assert.match(out.html, /paracosm\.agentos\.sh"/);
  assert.match(out.html, /Open the dashboard/);
  assert.match(out.html, /https:\/\/frame\.dev"/);
  assert.match(out.html, /https:\/\/agentos\.sh"/);
  assert.doesNotMatch(out.html, /manic\.agency/);
  assert.doesNotMatch(out.html, /\(#\d+\)/);
  assert.doesNotMatch(out.subject, /\(#\d+\)/);
  assert.match(out.text, /You're in/);
  assert.match(out.text, /paracosm\.agentos\.sh/);
});

test('renderYoureIn falls back to "Hi," with no name', () => {
  const out = renderYoureIn({ email: 'a@b.co', name: null, ...footer });
  assert.match(out.html, /Hi,/);
  assert.doesNotMatch(out.html, /Hi null/);
});

test('renderYoureIn HTML-escapes name', () => {
  const out = renderYoureIn({ email: 'a@b.co', name: '<script>x</script>', ...footer });
  assert.doesNotMatch(out.html, /Hi <script>/);
  assert.match(out.html, /Hi &lt;script&gt;/);
});

test('renderYoureIn HTML-escapes the postal address and the unsubscribe link', () => {
  const out = renderYoureIn({
    email: 'a@b.co',
    name: null,
    unsubscribeUrl: 'https://paracosm.agentos.sh/unsubscribe?t=a"b',
    postalAddress: 'Sender <LLC> & Co',
  });
  assert.match(out.html, /href="https:\/\/paracosm\.agentos\.sh\/unsubscribe\?t=a&quot;b"/);
  assert.match(out.html, /Sender &lt;LLC&gt; &amp; Co/);
  assert.doesNotMatch(out.html, /<LLC>/);
});
