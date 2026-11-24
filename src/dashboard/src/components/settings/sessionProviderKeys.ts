/**
 * The provider keys the visitor saved in Settings, read as the server reads
 * them (`normalizeCredential`): a blank value, or a masked one the page kept
 * (`sk-...`), is no key. Settings unlocks the provider and the models on the
 * hosted demo only when one of these holds a key, and every request that can
 * run on the visitor's key posts these, so the page never shows a run as the
 * visitor's that the server runs on the host's keys.
 */
import { carriesVisitorKey, LOOPBACK_HOSTNAMES, normalizeCredential, VISITOR_KEY_TRANSPORT_REFUSAL } from '../../../../engine/provider/credentials.js';

/**
 * True when this page may send a visitor key: the browser calls it a secure
 * context, and it was opened over HTTPS or at a name for this computer, the
 * two transports the server takes a key over. The page's own address is
 * read as well as the browser's word, since a browser set to trust a
 * plain-HTTP address on the network calls that page a secure context too.
 */
function pageMaySendKeys(): boolean {
  if (typeof window === 'undefined' || window.isSecureContext !== true) return false;
  const { protocol, hostname } = window.location;
  return protocol === 'https:' || LOOPBACK_HOSTNAMES.has(hostname);
}

/**
 * The server's refusal, when a request with this body would carry a visitor
 * key from a page that may not send one (`carriesVisitorKey`: what the
 * server reads as a key). Without a body, the notice for the key fields in
 * Settings. Every request that can carry a visitor key asks this first.
 */
export function visitorKeyTransportError(body?: Readonly<Record<string, unknown>>): string | undefined {
  if (pageMaySendKeys()) return undefined;
  if (!body || carriesVisitorKey(body)) return VISITOR_KEY_TRANSPORT_REFUSAL;
  return undefined;
}

/** The saved key overrides (`paracosm:keyOverrides`) this reads: the OpenAI and the Anthropic key. */
export interface SavedProviderKeys {
  openai?: string;
  anthropic?: string;
}

/** The OpenAI and Anthropic keys of the saved overrides, as request fields. */
export function sessionProviderKeys(overrides: SavedProviderKeys): { apiKey?: string; anthropicKey?: string } {
  const apiKey = normalizeCredential(overrides.openai);
  const anthropicKey = normalizeCredential(overrides.anthropic);
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(anthropicKey ? { anthropicKey } : {}),
  };
}

/** True when the saved overrides hold a provider key the server reads as one. */
export function hasSessionProviderKey(overrides: SavedProviderKeys): boolean {
  const keys = sessionProviderKeys(overrides);
  return keys.apiKey !== undefined || keys.anthropicKey !== undefined;
}
