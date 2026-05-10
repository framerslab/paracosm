import test from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail, __resetEmailClientForTests } from './email.js';

test('sendEmail returns false when RESEND_API_KEY is missing', async () => {
  const prev = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  __resetEmailClientForTests();
  const ok = await sendEmail({
    from: 'Paracosm <team@frame.dev>',
    to: 'test@example.com',
    subject: 'hi',
    html: '<p>hi</p>',
    text: 'hi',
  });
  assert.equal(ok, false);
  if (prev !== undefined) process.env.RESEND_API_KEY = prev;
  __resetEmailClientForTests();
});

test('sendEmail returns false on Resend SDK rejection', async () => {
  process.env.RESEND_API_KEY = 're_test_key';
  __resetEmailClientForTests({
    emails: {
      send: async () => ({ data: null, error: { name: 'validation_error', message: 'bad' } }),
    },
  });
  const ok = await sendEmail({
    from: 'Paracosm <team@frame.dev>',
    to: 'test@example.com',
    subject: 'hi',
    html: '<p>hi</p>',
    text: 'hi',
  });
  assert.equal(ok, false);
  __resetEmailClientForTests();
});

test('sendEmail returns true on Resend SDK success', async () => {
  process.env.RESEND_API_KEY = 're_test_key';
  __resetEmailClientForTests({
    emails: {
      send: async () => ({ data: { id: 'msg_123' }, error: null }),
    },
  });
  const ok = await sendEmail({
    from: 'Paracosm <team@frame.dev>',
    to: 'test@example.com',
    subject: 'hi',
    html: '<p>hi</p>',
    text: 'hi',
  });
  assert.equal(ok, true);
  __resetEmailClientForTests();
});
