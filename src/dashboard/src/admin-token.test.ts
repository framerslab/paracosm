import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_TOKEN_UNSENDABLE,
  ADMIN_TOKEN_WHERE,
  dropUnsendableAdminToken,
  isSendableAdminToken,
} from './admin-token.js';

// A request header carries U+0020 to U+007E and U+00A0 to U+00FF; fetch
// throws on anything else. The edges of both ranges, and the characters
// just outside them, decide what Save keeps.
const SENDABLE_EDGES = ['\u0020', '\u007E', '\u00A0', '\u00FF'];
const UNSENDABLE_EDGES = ['\u001F', '\u007F', '\u0080', '\u009F', '\u0100', '\u20AC', '\u{1F600}'];

test('a token may hold the edge characters of both header ranges', () => {
  for (const ch of SENDABLE_EDGES) {
    const token = `tok${ch}en`;
    assert.equal(isSendableAdminToken(token), true, `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
    assert.equal(dropUnsendableAdminToken(token), null);
  }
});

test('a token holding a character just outside either range is refused, with the characters a token may hold', () => {
  for (const ch of UNSENDABLE_EDGES) {
    const token = `tok${ch}en`;
    assert.equal(isSendableAdminToken(token), false, `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
    assert.equal(dropUnsendableAdminToken(token), `${ADMIN_TOKEN_UNSENDABLE} ${ADMIN_TOKEN_WHERE}`);
  }
});
