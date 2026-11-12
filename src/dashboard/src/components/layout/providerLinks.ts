/**
 * Which addresses the provider error banner turns into a link.
 *
 * The server's provider_error events carry the key and billing pages of
 * src/runtime/util/provider-errors.ts (authUrl, billingUrl). Those hosts
 * are the only ones the banner links to: a run file loaded from disk or
 * from a ?load= link carries whatever address its author wrote, so any
 * other address is shown as text.
 *
 * @module paracosm/dashboard/components/layout/providerLinks
 */

/** Hosts of the provider pages the server sends (provider-errors.ts authUrl, billingUrl). */
const PROVIDER_HOSTS = new Set(['platform.openai.com', 'console.anthropic.com']);

/**
 * The address as a link target when it is an http or https URL on a known
 * provider host with no credentials or port in it; otherwise null.
 */
export function knownProviderLink(address: string | undefined): string | null {
  if (!address) return null;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  if (!PROVIDER_HOSTS.has(url.hostname)) return null;
  return url.toString();
}
