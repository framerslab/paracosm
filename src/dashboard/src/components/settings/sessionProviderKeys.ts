/**
 * The provider keys the visitor saved in Settings, read as the server reads
 * them (`normalizeCredential`): a blank value, or a masked one the page kept
 * (`sk-...`), is no key. Settings unlocks the provider and the models on the
 * hosted demo only when one of these holds a key, and every request that can
 * run on the visitor's key posts these, so the page never shows a run as the
 * visitor's that the server runs on the host's keys.
 */
import { normalizeCredential } from '../../../../engine/provider/credentials.js';

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
