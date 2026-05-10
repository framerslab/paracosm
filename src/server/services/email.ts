/**
 * Thin Resend wrapper. Mirrors the wilds-ai pattern at
 * apps/wilds-ai/src/lib/server/email.ts: lazy client, never throws,
 * returns boolean. Callers treat email as best-effort.
 *
 * @module paracosm/cli/server/email
 */
import { Resend } from 'resend';

export interface SendEmailParams {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

interface MinimalResendClient {
  emails: {
    send: (input: {
      from: string;
      to: string | string[];
      subject: string;
      html: string;
      text: string;
      replyTo?: string;
    }) => Promise<{ data: { id: string } | null; error: { name?: string; message?: string } | null }>;
  };
}

let cachedClient: MinimalResendClient | null = null;
let cachedKey: string | null = null;

function getClient(): MinimalResendClient | null {
  const key = process.env['RESEND_API_KEY'];
  if (!key) return null;
  if (cachedClient && cachedKey === key) return cachedClient;
  cachedClient = new Resend(key) as unknown as MinimalResendClient;
  cachedKey = key;
  return cachedClient;
}

/**
 * Send an email via Resend. Returns false (does not throw) if the API
 * key is missing, the SDK rejects, or the network errors. Callers must
 * treat the false case as "email skipped, continue".
 */
export async function sendEmail(params: SendEmailParams): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.warn('[email] RESEND_API_KEY missing — email skipped');
    return false;
  }
  try {
    const result = await client.emails.send({
      from: params.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      replyTo: params.replyTo,
    });
    if (result.error) {
      console.warn('[email] Resend rejected:', result.error.name, result.error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[email] Resend send threw:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Test-only hook. Call with a mock to inject a fake Resend client (the
 * mock is keyed to whatever RESEND_API_KEY happens to be when this is
 * called, so subsequent getClient() calls return the mock instead of
 * a real Resend instance). Call with no args to clear the cache so the
 * next sendEmail rebuilds from the current env. Never call from
 * production code.
 */
export function __resetEmailClientForTests(mock?: MinimalResendClient): void {
  if (mock) {
    cachedClient = mock;
    cachedKey = process.env['RESEND_API_KEY'] ?? 'mock';
  } else {
    cachedClient = null;
    cachedKey = null;
  }
}
