/**
 * The provider keys the dashboard holds in Settings, read as the server
 * reads them.
 *
 * Settings unlocks the provider and the models on the hosted demo when the
 * visitor holds a provider key, and the launch posts that key. A masked
 * value the page kept (`sk-...`) or a blank one is no key to the server
 * (`normalizeCredential`), which runs such a launch on the host's keys, so
 * the page reads it as no key too: the lock stays on and nothing is posted.
 *
 * The page sends a key over the two transports the server takes one over:
 * HTTPS, or a name for this computer. Anywhere else it sends none and says
 * the server's own refusal. What counts as a key is what the server counts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSessionProviderKey, sessionProviderKeys, visitorKeyTransportError } from '../../src/dashboard/src/components/settings/sessionProviderKeys.js';
import { hasProviderCredentials, VISITOR_KEY_FIELDS, VISITOR_KEY_TRANSPORT_REFUSAL } from '../../src/engine/provider/credentials.js';

/** Runs `check` as the page at `href` runs it, with the browser's own answer on whether that page is a secure context. */
function onPage<T>(href: string, isSecureContext: boolean, check: () => T): T {
  const held = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { isSecureContext, location: new URL(href) } });
  try {
    return check();
  } finally {
    if (held) Object.defineProperty(globalThis, 'window', held);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

/** A dashboard opened over plain HTTP at an address on the network. */
const NETWORK_PAGE = 'http://192.168.1.20:3456/sim';
const HTTPS_PAGE = 'https://paracosm.example/sim';

test('a visitor key leaves the page over HTTPS or at a name for this computer, and nowhere else', () => {
  const body = { apiKey: 'sk-test-0000', turns: 3 };
  for (const href of [HTTPS_PAGE, 'http://localhost:3456/sim', 'http://127.0.0.1:3456/sim', 'http://[::1]:3456/sim']) {
    assert.equal(onPage(href, true, () => visitorKeyTransportError(body)), undefined, `${href} sends the key`);
    assert.equal(onPage(href, true, () => visitorKeyTransportError()), undefined, `${href} shows no notice in Settings`);
  }
  // Plain HTTP at a network address: the key stays, and Settings says why before anything is pressed.
  assert.equal(onPage(NETWORK_PAGE, false, () => visitorKeyTransportError(body)), VISITOR_KEY_TRANSPORT_REFUSAL);
  assert.equal(onPage(NETWORK_PAGE, false, () => visitorKeyTransportError()), VISITOR_KEY_TRANSPORT_REFUSAL);
  // A browser set to trust that address calls the page a secure context. The connection is as plain as before.
  assert.equal(onPage(NETWORK_PAGE, true, () => visitorKeyTransportError(body)), VISITOR_KEY_TRANSPORT_REFUSAL);
  assert.equal(onPage(NETWORK_PAGE, true, () => visitorKeyTransportError()), VISITOR_KEY_TRANSPORT_REFUSAL);
  // An HTTPS page the browser does not call a secure context, as inside a plain-HTTP frame.
  assert.equal(onPage(HTTPS_PAGE, false, () => visitorKeyTransportError(body)), VISITOR_KEY_TRANSPORT_REFUSAL);
});

test('over plain HTTP the page refuses what the server refuses: a real key in any key field, and no other value', () => {
  for (const field of VISITOR_KEY_FIELDS) {
    assert.equal(onPage(NETWORK_PAGE, false, () => visitorKeyTransportError({ [field]: ' a-real-key ' })), VISITOR_KEY_TRANSPORT_REFUSAL, `${field} stays on the page`);
  }
  // No key, a blank field and a masked value are no key to the server, which runs the launch on its own keys.
  for (const noKey of [{}, { turns: 3, provider: 'openai' }, { serperKey: '   ' }, { apiKey: 'sk-...', anthropicKey: '' }, { tavilyKey: 'tv-ab...cd' }]) {
    assert.equal(onPage(NETWORK_PAGE, false, () => visitorKeyTransportError(noKey)), undefined, `${JSON.stringify(noKey)} starts`);
  }
});

test('a masked or blank provider key in Settings is no key, as the server reads it', () => {
  for (const value of ['sk-...', 'sk-ab...cd', '   ', '']) {
    const overrides = { openai: value, anthropic: value };
    assert.equal(hasProviderCredentials({ apiKey: value, anthropicKey: value }), false, `the server reads ${JSON.stringify(value)} as no key`);
    assert.equal(hasSessionProviderKey(overrides), false, `Settings stays locked on ${JSON.stringify(value)}`);
    assert.deepEqual(sessionProviderKeys(overrides), {}, `the launch posts no key for ${JSON.stringify(value)}`);
  }
});

test('a real provider key in Settings unlocks it and is posted as the server reads it', () => {
  assert.equal(hasSessionProviderKey({ anthropic: ' sk-ant-real ' }), true);
  assert.deepEqual(sessionProviderKeys({ openai: 'sk-...', anthropic: ' sk-ant-real ' }), { anthropicKey: 'sk-ant-real' });
  assert.deepEqual(sessionProviderKeys({ openai: 'sk-real' }), { apiKey: 'sk-real' });
});
