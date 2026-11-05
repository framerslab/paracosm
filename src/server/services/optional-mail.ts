/**
 * The one way Paracosm sends an email. Every email Paracosm sends is
 * optional (there are no accounts, so there is no sign-in, receipt or
 * account mail), and each one goes through `sendOptionalEmail`, which:
 *
 * 1. reads the suppression list and sends nothing to an address on it;
 * 2. draws the recipient's own unsubscribe token for this email;
 * 3. renders the email with the visible Unsubscribe link and the sender's
 *    postal address in its footer, and refuses to send without the address;
 * 4. sends it with `List-Unsubscribe: <https://…/unsubscribe?t=…>` and
 *    `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), passed
 *    on Resend's send call. RFC 8058 asks that the DKIM signature cover
 *    both; a received email's `DKIM-Signature` `h=` list shows whether it does.
 *
 * The link opens `/unsubscribe` on the dashboard server
 * (`../routes/unsubscribe.ts`): a GET asks, a POST suppresses at once, and
 * no email is sent about it.
 *
 * @module paracosm/cli/server/optional-mail
 */
import { sendEmail } from './email.js';
import type { MailFooter, RenderedEmail } from './email-templates.js';
import { openMailStore } from '../stores/mail-suppression.js';

/** The public site the links in an email point to. */
export const DEFAULT_MAIL_LINK_BASE = 'https://paracosm.agentos.sh';

/** The unsubscribe page for one token, on the given site. */
export function unsubscribeUrl(linkBase: string, token: string): string {
  return `${linkBase.replace(/\/+$/, '')}/unsubscribe?t=${token}`;
}

/** The RFC 8058 one-click headers for an unsubscribe link: https only, no mailto. */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export interface SendOptionalEmailInput {
  /** The mail store (`mailDbPath(APP_DIR)`), shared with the dashboard server. */
  mailDbPath: string;
  from: string;
  to: string;
  replyTo?: string;
  /** The sender's postal address. Required: an empty one throws before anything is sent. */
  postalAddress: string;
  /** The site the unsubscribe link points to. Defaults to {@link DEFAULT_MAIL_LINK_BASE}. */
  linkBase?: string;
  /** Renders the email with the footer it is given. */
  render: (footer: MailFooter) => RenderedEmail;
}

/** `sent`, `suppressed` (nothing sent), or `failed` (Resend refused or was unreachable). */
export type SendOptionalEmailResult = 'sent' | 'suppressed' | 'failed';

export async function sendOptionalEmail(input: SendOptionalEmailInput): Promise<SendOptionalEmailResult> {
  const postalAddress = input.postalAddress.trim();
  if (!postalAddress) {
    throw new Error('A Paracosm email must carry the sender\'s postal address; none was given, so nothing was sent.');
  }

  // A suppressed address gets no email and no new link.
  const store = openMailStore({ dbPath: input.mailDbPath });
  let token: string | null = null;
  try {
    if (!(await store.isSuppressed(input.to))) token = await store.mintUnsubscribeToken(input.to);
  } finally {
    await store.close();
  }
  if (token === null) return 'suppressed';

  const url = unsubscribeUrl(input.linkBase ?? DEFAULT_MAIL_LINK_BASE, token);
  const rendered = input.render({ unsubscribeUrl: url, postalAddress });
  const ok = await sendEmail({
    from: input.from,
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo: input.replyTo,
    headers: listUnsubscribeHeaders(url),
  });
  return ok ? 'sent' : 'failed';
}
