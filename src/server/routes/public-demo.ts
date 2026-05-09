import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ParacosmServerMode } from '../server-mode.js';

export function handlePublicDemoRoute(
  mode: ParacosmServerMode,
  req: IncomingMessage,
  res: ServerResponse,
  corsHeaders: Record<string, string>,
): boolean {
  // Defensive parse: bots and CF probes send malformed paths like `//`
  // which crash `new URL(...)` with "Invalid URL". A failure here used
  // to bubble up to Server.<anonymous> and crash the request handler;
  // server logs were full of `TypeError: Invalid URL ... input: '//'`.
  // A non-parseable URL is just not our route — return false.
  let url: URL | null = null;
  if (req.url) {
    try { url = new URL(req.url, 'http://localhost'); } catch { return false; }
  }
  if (!url || url.pathname !== '/api/v1/demo/status' || req.method !== 'GET') return false;

  res.writeHead(200, {
    'Content-Type': 'application/json',
    ...corsHeaders,
  });
  res.end(JSON.stringify({
    mode,
    replayAvailable: mode !== 'platform_api',
    authenticatedApiAvailable: mode === 'platform_api',
  }));
  return true;
}
