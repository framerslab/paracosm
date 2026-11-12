/**
 * Fetches a URL a request names: only from a public address, with a time
 * limit and a byte limit, and strips HTML to text in linear time.
 *
 * - The host name is resolved once and every address it resolves to is
 *   checked; the connection is made to the checked addresses (the request's
 *   `lookup`), so a name that resolves to a public address at the check
 *   cannot connect to a private one after it. An IP literal is checked as
 *   written. Loopback, private, link-local, carrier-grade NAT, unique-local,
 *   multicast, reserved and documentation ranges are refused, in IPv4, IPv6
 *   and IPv4-mapped IPv6 form.
 * - Redirects are followed by hand, at most five, each to an http or https
 *   URL checked the same way.
 * - The body is read up to `maxBytes` (2 MiB by default) after decoding
 *   gzip, deflate or brotli, and the rest is dropped. The whole fetch,
 *   redirects and body included, ends after `timeoutMs` (15 s by default).
 *
 * @module paracosm/engine/compiler/public-url-fetch
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { pipeline, type Readable, type Transform } from 'node:stream';

/** A URL the server does not fetch: its scheme, or an address it names or resolves to. */
export class UrlRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlRefusedError';
  }
}

export const DEFAULT_MAX_FETCH_BYTES = 2 * 1024 * 1024;
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

const refusedRanges = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) refusedRanges.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) refusedRanges.addSubnet(network, prefix, 'ipv6');

/** True when `address` (an IP literal) is one the server may connect to. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '');
  const family = isIP(bare);
  if (family === 4) return !refusedRanges.check(bare, 'ipv4');
  if (family !== 6) return false;
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:hhhh:hhhh) and IPv4-compatible
  // forms reach the IPv4 address they carry, so that address is checked.
  const mapped = /^(?:0{0,4}:){0,5}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
  if (mapped && isIP(mapped[1]) === 4) return !refusedRanges.check(mapped[1], 'ipv4');
  const hexMapped = /^(?:0{0,4}:){0,5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(bare) ?? /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(bare);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return !refusedRanges.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, 'ipv4');
  }
  return !refusedRanges.check(bare, 'ipv6');
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * The request's lookup: resolves the name, refuses it when any address it
 * resolves to is not public, and hands the checked addresses to the socket.
 * Answers in the form the socket asked for (`all` for Happy Eyeballs).
 */
function checkedLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback): void {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    if (list.length === 0) return callback(Object.assign(new Error(`No address for ${hostname}`), { code: 'ENOTFOUND' }), []);
    const refused = list.find(entry => !isPublicAddress(entry.address));
    if (refused) return callback(new UrlRefusedError(`${hostname} resolves to an address the server does not fetch`) as NodeJS.ErrnoException, []);
    if (options?.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

function checkUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlRefusedError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlRefusedError(`Unsupported URL scheme: ${url.protocol}. Use http or https.`);
  }
  if (url.username || url.password) throw new UrlRefusedError('A URL with credentials is not fetched');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) {
    throw new UrlRefusedError(`${host} is an address the server does not fetch`);
  }
  return url;
}

export interface PublicUrlFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
  /** Test seam: skip the address checks, for a server on loopback. */
  allowPrivateAddresses?: boolean;
}

export interface PublicUrlResponse {
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
  /** True when the body was longer than `maxBytes` and was cut there. */
  truncated: boolean;
  /** The URL the body came from, after redirects. */
  url: string;
}

function requestOnce(url: URL, signal: AbortSignal, accept: string, allowPrivate: boolean): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, {
      method: 'GET',
      headers: { Accept: accept, 'Accept-Encoding': 'gzip, deflate, br', 'User-Agent': 'paracosm-seed-fetch' },
      signal,
      ...(allowPrivate ? {} : { lookup: checkedLookup as never }),
    }, resolve);
    req.on('error', reject);
    req.end();
  });
}

/** Reads a stream into at most `maxBytes`, then stops reading it. */
async function readCapped(stream: Readable, maxBytes: number): Promise<{ bytes: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = chunk as Buffer;
    if (size + buf.length > maxBytes) {
      chunks.push(buf.subarray(0, maxBytes - size));
      size = maxBytes;
      stream.destroy();
      return { bytes: Buffer.concat(chunks, size), truncated: true };
    }
    chunks.push(buf);
    size += buf.length;
  }
  return { bytes: Buffer.concat(chunks, size), truncated: false };
}

/** The decoded body. pipeline carries an abort or a decode error to the
 *  stream read, and destroying that stream destroys the response. */
function decoded(res: IncomingMessage): Readable {
  const encoding = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
  let decoder: Transform | null = null;
  if (encoding === 'gzip' || encoding === 'x-gzip') decoder = createGunzip();
  else if (encoding === 'deflate') decoder = createInflate();
  else if (encoding === 'br') decoder = createBrotliDecompress();
  if (!decoder) return res;
  pipeline(res, decoder, () => { /* the read below sees the error */ });
  return decoder;
}

/** Fetches `rawUrl` under the rules in the module comment. Throws UrlRefusedError for a URL it does not fetch. */
export async function fetchPublicUrl(rawUrl: string, options: PublicUrlFetchOptions = {}): Promise<PublicUrlResponse> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_FETCH_BYTES;
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
  const accept = options.accept ?? 'text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1';
  const allowPrivate = options.allowPrivateAddresses === true;
  let url = allowPrivate ? new URL(rawUrl) : checkUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, signal, accept, allowPrivate);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location) {
      res.resume();
      if (hop >= MAX_REDIRECTS) throw new Error(`More than ${MAX_REDIRECTS} redirects`);
      url = allowPrivate ? new URL(location, url) : checkUrl(new URL(location, url));
      continue;
    }
    const stream = decoded(res);
    try {
      const { bytes, truncated } = await readCapped(stream, maxBytes);
      return {
        status,
        ok: status >= 200 && status < 300,
        contentType: String(res.headers['content-type'] ?? ''),
        text: bytes.toString('utf-8'),
        truncated,
        url: url.toString(),
      };
    } finally {
      res.destroy();
    }
  }
}

/** Reads a fetch Response's body up to `maxBytes`, then cancels the rest. */
export async function readResponseTextCapped(res: Response, maxBytes = DEFAULT_MAX_FETCH_BYTES): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.length;
  }
  return { text: Buffer.concat(chunks, size).toString('utf-8'), truncated };
}

function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Removes each `<tag ...>...</tag>` block of the named tags, with index
 * searches that never rescan text already passed. An unclosed block runs to
 * the end of the page.
 */
function dropBlocks(html: string, tags: readonly string[]): string {
  const lower = html.toLowerCase();
  const next = new Map<string, number>();
  const out: string[] = [];
  let i = 0;
  for (;;) {
    let best = -1;
    let bestTag = '';
    for (const tag of tags) {
      let pos = next.get(tag);
      if (pos === undefined || (pos !== -1 && pos < i)) {
        pos = lower.indexOf(`<${tag}`, i);
        next.set(tag, pos);
      }
      if (pos !== -1 && (best === -1 || pos < best)) {
        best = pos;
        bestTag = tag;
      }
    }
    if (best === -1) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, best), ' ');
    const close = lower.indexOf(`</${bestTag}`, best);
    if (close === -1) break;
    const end = lower.indexOf('>', close);
    if (end === -1) break;
    i = end + 1;
  }
  return out.join('');
}

/** The page's text: head, script, style and noscript blocks dropped, tags removed, entities decoded, whitespace collapsed. Linear in the page's length. */
export function htmlToText(html: string): string {
  return decodeBasicHtmlEntities(
    dropBlocks(html, ['head', 'script', 'style', 'noscript'])
      // A tag runs from `<` to the next `>` with no `<` inside, so each
      // match attempt stops at the next `<` and the pass stays linear.
      .replace(/<[^<>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/** The page's first <title>, or ''. */
export function htmlTitle(html: string): string {
  const lower = html.toLowerCase();
  const open = lower.indexOf('<title');
  if (open === -1) return '';
  const start = lower.indexOf('>', open);
  if (start === -1) return '';
  const close = lower.indexOf('</title', start);
  if (close === -1) return '';
  return decodeBasicHtmlEntities(html.slice(start + 1, close).replace(/\s+/g, ' ').trim());
}
