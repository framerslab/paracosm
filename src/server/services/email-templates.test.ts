import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWaitlistConfirmation, renderYoureIn } from './email-templates.js';

test('renderWaitlistConfirmation includes email + brand assets, omits position number', () => {
  const out = renderWaitlistConfirmation({
    email: 'test@example.com',
    name: 'Ada',
    position: 42,
    useCase: 'evaluating decision rehearsal for a hospital triage scenario',
  });
  // Position is intentionally NOT rendered — it's private info; surfacing it in
  // the recipient's mailbox lets them infer how small the waitlist is.
  assert.doesNotMatch(out.html, /#42/);
  assert.doesNotMatch(out.text, /#42/);
  assert.doesNotMatch(out.subject, /#42/);
  assert.match(out.html, /paracosm\.agentos\.sh/);
  assert.match(out.html, /team@frame\.dev/);
  assert.match(out.html, /paracosm\.agentos\.sh\/brand\/favicons\/favicon-192\.png/);
  // Logo must be the Paracosm orbital favicon, not Frame.dev's "F" mark.
  assert.doesNotMatch(out.html, /frame\.dev\/icon-192\.png/);
  assert.match(out.html, /github\.com\/framersai\/paracosm/);
  assert.match(out.html, /https:\/\/frame\.dev"/);
  assert.match(out.html, /https:\/\/agentos\.sh"/);
  assert.match(out.html, /https:\/\/manic\.agency"/);
  // Footer drops safeos.sh + wilds.ai per user request.
  assert.doesNotMatch(out.html, /safeos\.sh/);
  assert.doesNotMatch(out.html, /wilds\.ai/);
  assert.match(out.text, /paracosm\.agentos\.sh/);
  assert.equal(out.subject, "You're on the Paracosm waitlist");
});

test('renderWaitlistConfirmation tolerates empty optional fields', () => {
  const out = renderWaitlistConfirmation({
    email: 'a@b.co',
    name: null,
    position: 1,
    useCase: null,
  });
  assert.match(out.html, /a@b\.co/);
  assert.doesNotMatch(out.html, /undefined/);
  assert.doesNotMatch(out.html, /null/);
});

test('renderWaitlistConfirmation HTML uses inline styles only (no <style> blocks)', () => {
  const out = renderWaitlistConfirmation({
    email: 'a@b.co',
    name: 'A',
    position: 7,
    useCase: 'x',
  });
  assert.doesNotMatch(out.html, /<style/i);
});

test('renderWaitlistConfirmation HTML-escapes user input to prevent injection', () => {
  const out = renderWaitlistConfirmation({
    email: 'a@b.co',
    name: '<script>alert(1)</script>',
    position: 1,
    useCase: '<img src=x onerror=alert(1)>',
  });
  // Raw < and > from user input must be escaped; any browser parsing
  // the HTML will render the escaped sequence as text, not as a tag.
  assert.doesNotMatch(out.html, /<script>alert/);
  assert.doesNotMatch(out.html, /<img src=x onerror=/);
  assert.match(out.html, /&lt;script&gt;/);
  assert.match(out.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('renderYoureIn includes brand assets and CTA, omits position', () => {
  const out = renderYoureIn({ email: 'ada@example.com', name: 'Ada' });
  assert.equal(out.subject, "You're in — Paracosm hosted access is open");
  assert.match(out.html, /You're in\./);
  assert.match(out.html, /Hi Ada,/);
  assert.match(out.html, /paracosm\.agentos\.sh\/brand\/favicons\/favicon-192\.png/);
  assert.match(out.html, /paracosm\.agentos\.sh"/);
  assert.match(out.html, /Open the dashboard/);
  assert.match(out.html, /https:\/\/frame\.dev"/);
  assert.match(out.html, /https:\/\/agentos\.sh"/);
  assert.match(out.html, /https:\/\/manic\.agency"/);
  assert.doesNotMatch(out.html, /\(#\d+\)/);
  assert.doesNotMatch(out.subject, /\(#\d+\)/);
  assert.match(out.text, /You're in/);
  assert.match(out.text, /paracosm\.agentos\.sh/);
});

test('renderYoureIn falls back to "Hi," with no name', () => {
  const out = renderYoureIn({ email: 'a@b.co', name: null });
  assert.match(out.html, /Hi,/);
  assert.doesNotMatch(out.html, /Hi null/);
});

test('renderYoureIn HTML-escapes name', () => {
  const out = renderYoureIn({ email: 'a@b.co', name: '<script>x</script>' });
  assert.doesNotMatch(out.html, /Hi <script>/);
  assert.match(out.html, /Hi &lt;script&gt;/);
});
