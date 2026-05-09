/**
 * Targeted tests for the provider-error classifier.
 *
 * Covers the two terminal cases (auth, quota) end to end for OpenAI and
 * Anthropic, a rate limit + network recovery case (non-terminal), the
 * priority rule (auth wins over quota when both signals appear), and the
 * provider-inference fallback when no provider string is present.
 *
 * Uses node:test to match the rest of the suite (paracosm avoids vitest
 * for runtime unit tests).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProviderError,
  shouldAbortRun,
} from '../../src/runtime/util/provider-errors.js';

describe('classifyProviderError', () => {
  describe('auth', () => {
    it('classifies OpenAI 401 with invalid_api_key as auth', () => {
      const err = new Error('OpenAI API error: 401 { "error": { "code": "invalid_api_key" } }');
      const c = classifyProviderError(err);
      assert.equal(c.kind, 'auth');
      assert.equal(c.provider, 'openai');
      assert.match(c.message, /OpenAI API key/);
      assert.equal(c.actionUrl, 'https://platform.openai.com/api-keys');
    });

    it('classifies Anthropic authentication_error as auth', () => {
      const err = new Error('AnthropicError: authentication_error invalid x-api-key header');
      const c = classifyProviderError(err);
      assert.equal(c.kind, 'auth');
      assert.equal(c.provider, 'anthropic');
      assert.equal(c.actionUrl, 'https://console.anthropic.com/settings/keys');
    });

    it('classifies plain 401 as auth even without provider signal', () => {
      const err = new Error('401 Unauthorized');
      const c = classifyProviderError(err);
      assert.equal(c.kind, 'auth');
      assert.equal(c.provider, undefined);
    });
  });

  describe('quota', () => {
    it('classifies OpenAI insufficient_quota (429 body) as quota not rate_limit', () => {
      // This is the critical case: 429 status would look like a rate limit,
      // but insufficient_quota in the body means credits are exhausted.
      // We want the banner to say "add credits", not "wait a moment".
      const err = new Error('OpenAI error 429: { "error": { "code": "insufficient_quota" } }');
      const c = classifyProviderError(err);
      assert.equal(c.kind, 'quota');
      assert.equal(c.provider, 'openai');
      assert.match(c.message, /credits/i);
      assert.equal(c.actionUrl, 'https://platform.openai.com/settings/organization/billing');
    });

    it('classifies Anthropic credit_balance_too_low as quota', () => {
      const err = new Error('anthropic 400: credit_balance_too_low');
      const c = classifyProviderError(err);
      assert.equal(c.kind, 'quota');
      assert.equal(c.provider, 'anthropic');
      assert.match(c.message, /credit balance/i);
    });

    it('classifies 402 Payment Required as quota', () => {
      const err = new Error('402 Payment Required');
      const c = classifyProviderError(err);
      assert.equal(c.kind, 'quota');
    });
  });

  describe('rate_limit (non-terminal)', () => {
    it('classifies plain 429 without quota body as rate_limit', () => {
      const err = new Error('openai error 429 rate_limit_exceeded: please retry');
      const c = classifyProviderError(err);
      assert.equal(c.kind, 'rate_limit');
      assert.equal(c.provider, 'openai');
    });

    it('classifies overloaded_error as rate_limit', () => {
      const err = new Error('anthropic overloaded_error: server busy');
      const c = classifyProviderError(err);
      assert.equal(c.kind, 'rate_limit');
    });
  });

  describe('network', () => {
    it('classifies fetch failed as network', () => {
      const c = classifyProviderError(new Error('fetch failed'));
      assert.equal(c.kind, 'network');
    });

    it('classifies ECONNREFUSED as network', () => {
      const c = classifyProviderError(new Error('connect ECONNREFUSED 127.0.0.1:443'));
      assert.equal(c.kind, 'network');
    });
  });

  describe('unknown', () => {
    it('classifies a random 500 as unknown', () => {
      const c = classifyProviderError(new Error('500 internal server error'));
      assert.equal(c.kind, 'unknown');
    });

    it('handles non-Error throws (strings, nulls)', () => {
      assert.equal(classifyProviderError('just a string').kind, 'unknown');
      assert.equal(classifyProviderError(null).kind, 'unknown');
      assert.equal(classifyProviderError(undefined).kind, 'unknown');
    });
  });

  describe('priority rules', () => {
    it('auth wins over quota when both appear (bad key is a different fix)', () => {
      // A revoked key can return 401 with a body that also mentions
      // insufficient_quota (e.g. reused error message). The user fix for
      // auth (replace key) is different from quota (add credits), so we
      // prioritize auth.
      const err = new Error('401 invalid_api_key insufficient_quota');
      const c = classifyProviderError(err);
      assert.equal(c.kind, 'auth');
    });
  });
});

describe('shouldAbortRun', () => {
  it('aborts on auth and quota', () => {
    assert.equal(shouldAbortRun('auth'), true);
    assert.equal(shouldAbortRun('quota'), true);
  });

  it('does NOT abort on rate_limit, network, or unknown (recoverable within run)', () => {
    assert.equal(shouldAbortRun('rate_limit'), false);
    assert.equal(shouldAbortRun('network'), false);
    assert.equal(shouldAbortRun('unknown'), false);
  });
});
