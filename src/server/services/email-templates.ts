/**
 * HTML + plain-text templates for transactional emails. Inline styles
 * only — Gmail/Outlook/Yahoo strip <style> blocks. All user-supplied
 * fields are HTML-escaped to prevent injection.
 *
 * @module paracosm/cli/server/email-templates
 */

export interface WaitlistConfirmationInput {
  email: string;
  name: string | null;
  position: number;
  useCase: string | null;
}

export interface YoureInInput {
  email: string;
  name: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const PARACOSM_LOGO_URL = 'https://paracosm.agentos.sh/brand/favicons/favicon-192.png';
const PARACOSM_REPO = 'https://github.com/framersai/paracosm';
const PARACOSM_NPM = 'https://npmjs.com/package/paracosm';
const PARACOSM_DEMO = 'https://paracosm.agentos.sh';
const SUPPORT_EMAIL = 'team@frame.dev';

const BG_DEEP = '#0a0806';
const TEXT_PRIMARY = '#f5e6d3';
const TEXT_MUTED = '#a89484';
const ACCENT_AMBER = '#e8b44a';
const ACCENT_RUST = '#c46a3a';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderWaitlistConfirmation(input: WaitlistConfirmationInput): RenderedEmail {
  const safeEmail = escapeHtml(input.email);
  const safeName = input.name ? escapeHtml(input.name) : null;
  const safeUseCase = input.useCase ? escapeHtml(input.useCase) : null;
  const greeting = safeName ? `Hi ${safeName},` : 'Hi,';

  const subject = `You're on the Paracosm waitlist`;

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${BG_DEEP};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${TEXT_PRIMARY};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BG_DEEP};padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#1a1410;border:1px solid #2a1f18;border-radius:8px;overflow:hidden;">
<tr><td style="padding:32px 40px 16px 40px;border-bottom:1px solid #2a1f18;">
<table role="presentation" cellspacing="0" cellpadding="0">
<tr>
<td style="vertical-align:middle;padding-right:14px;"><img src="${PARACOSM_LOGO_URL}" width="40" height="40" alt="Paracosm" style="display:block;border-radius:6px;"></td>
<td style="vertical-align:middle;font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:${ACCENT_AMBER};letter-spacing:1px;">PARACOSM</td>
</tr>
</table>
</td></tr>

<tr><td style="padding:32px 40px 0 40px;">
<h1 style="margin:0 0 24px 0;font-size:28px;font-weight:700;color:${TEXT_PRIMARY};line-height:1.3;">You're on the waitlist.</h1>
<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:${TEXT_PRIMARY};">${greeting}</p>
<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:${TEXT_PRIMARY};">Thanks for requesting early access to the hosted Paracosm dashboard. We're shipping in Q3 2026 with fleet orchestration, team workspaces, and the full analytics suite.</p>
<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:${TEXT_PRIMARY};">In the meantime, the engine is open source under Apache-2.0:</p>

<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;">
<tr><td style="padding:4px 0;"><span style="color:${ACCENT_RUST};font-family:monospace;">&rarr;</span> <a href="${PARACOSM_DEMO}" style="color:${ACCENT_AMBER};text-decoration:none;">Live demo: paracosm.agentos.sh</a></td></tr>
<tr><td style="padding:4px 0;"><span style="color:${ACCENT_RUST};font-family:monospace;">&rarr;</span> <a href="${PARACOSM_NPM}" style="color:${ACCENT_AMBER};text-decoration:none;">npm: npmjs.com/package/paracosm</a></td></tr>
<tr><td style="padding:4px 0;"><span style="color:${ACCENT_RUST};font-family:monospace;">&rarr;</span> <a href="${PARACOSM_REPO}" style="color:${ACCENT_AMBER};text-decoration:none;">Source: github.com/framersai/paracosm</a></td></tr>
</table>

<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:${TEXT_PRIMARY};">Reply to this email if you want to chat about a specific use case ${safeUseCase ? `&mdash; you mentioned: <em style="color:${TEXT_MUTED};">&quot;${safeUseCase}&quot;</em>` : '&mdash; agent-society research, decision rehearsal for an enterprise process, custom scenario authoring, or anything else'}.</p>
<p style="margin:0 0 32px 0;font-size:16px;line-height:1.6;color:${TEXT_PRIMARY};">&mdash; The Paracosm team</p>
</td></tr>

<tr><td style="padding:24px 40px;border-top:1px solid #2a1f18;font-size:12px;color:${TEXT_MUTED};">
<p style="margin:0 0 6px 0;">Sent to <strong style="color:${TEXT_PRIMARY};">${safeEmail}</strong> from <a href="mailto:${SUPPORT_EMAIL}" style="color:${ACCENT_AMBER};text-decoration:none;">${SUPPORT_EMAIL}</a>.</p>
<p style="margin:0;"><a href="https://frame.dev" style="color:${ACCENT_AMBER};text-decoration:none;">Frame.dev</a> &middot; <a href="https://agentos.sh" style="color:${ACCENT_AMBER};text-decoration:none;">agentos.sh</a> &middot; <a href="https://manic.agency" style="color:${ACCENT_AMBER};text-decoration:none;">manic.agency</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const text = [
    `You're on the Paracosm waitlist.`,
    '',
    input.name ? `Hi ${input.name},` : 'Hi,',
    '',
    `Thanks for requesting early access to the hosted Paracosm dashboard. We're shipping in Q3 2026 with fleet orchestration, team workspaces, and the full analytics suite.`,
    '',
    'In the meantime, the engine is open source under Apache-2.0:',
    `  -> Live demo: ${PARACOSM_DEMO}`,
    `  -> npm: ${PARACOSM_NPM}`,
    `  -> Source: ${PARACOSM_REPO}`,
    '',
    input.useCase
      ? `Reply to this email if you want to chat -- you mentioned: "${input.useCase}".`
      : 'Reply to this email if you want to chat about a specific use case.',
    '',
    '-- The Paracosm team',
    '',
    `Sent to ${input.email} from ${SUPPORT_EMAIL}.`,
    'frame.dev | agentos.sh | manic.agency',
  ].join('\n');

  return { subject, html, text };
}

/**
 * Broadcast email sent to existing waitlist members when hosted access
 * opens up. Identical visual shell to the confirmation; different copy.
 * No personalization beyond the optional name — keeps it appropriate
 * for bulk delivery.
 */
export function renderYoureIn(input: YoureInInput): RenderedEmail {
  const safeEmail = escapeHtml(input.email);
  const safeName = input.name ? escapeHtml(input.name) : null;
  const greeting = safeName ? `Hi ${safeName},` : 'Hi,';

  const subject = `You're in — Paracosm hosted access is open`;

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${BG_DEEP};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${TEXT_PRIMARY};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BG_DEEP};padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#1a1410;border:1px solid #2a1f18;border-radius:8px;overflow:hidden;">
<tr><td style="padding:32px 40px 16px 40px;border-bottom:1px solid #2a1f18;">
<table role="presentation" cellspacing="0" cellpadding="0">
<tr>
<td style="vertical-align:middle;padding-right:14px;"><img src="${PARACOSM_LOGO_URL}" width="40" height="40" alt="Paracosm" style="display:block;border-radius:6px;"></td>
<td style="vertical-align:middle;font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:${ACCENT_AMBER};letter-spacing:1px;">PARACOSM</td>
</tr>
</table>
</td></tr>

<tr><td style="padding:32px 40px 0 40px;">
<h1 style="margin:0 0 24px 0;font-size:28px;font-weight:700;color:${TEXT_PRIMARY};line-height:1.3;">You're in.</h1>
<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:${TEXT_PRIMARY};">${greeting}</p>
<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:${TEXT_PRIMARY};">Hosted Paracosm access is open. You can now run scenarios, fork worlds, and inspect run artifacts directly in the browser — no install, no API key required to start.</p>

<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
<tr><td style="background:linear-gradient(135deg, ${ACCENT_RUST}, ${ACCENT_AMBER});border-radius:6px;">
<a href="${PARACOSM_DEMO}" style="display:inline-block;padding:14px 28px;color:#0a0806;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">Open the dashboard &rarr;</a>
</td></tr>
</table>

<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:${TEXT_PRIMARY};">A few starting points:</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;">
<tr><td style="padding:4px 0;"><span style="color:${ACCENT_RUST};font-family:monospace;">&rarr;</span> <a href="${PARACOSM_DEMO}/sim" style="color:${ACCENT_AMBER};text-decoration:none;">Simulation studio</a></td></tr>
<tr><td style="padding:4px 0;"><span style="color:${ACCENT_RUST};font-family:monospace;">&rarr;</span> <a href="${PARACOSM_DEMO}/docs" style="color:${ACCENT_AMBER};text-decoration:none;">API reference</a></td></tr>
<tr><td style="padding:4px 0;"><span style="color:${ACCENT_RUST};font-family:monospace;">&rarr;</span> <a href="${PARACOSM_NPM}" style="color:${ACCENT_AMBER};text-decoration:none;">npm: npmjs.com/package/paracosm</a></td></tr>
<tr><td style="padding:4px 0;"><span style="color:${ACCENT_RUST};font-family:monospace;">&rarr;</span> <a href="${PARACOSM_REPO}" style="color:${ACCENT_AMBER};text-decoration:none;">Source on GitHub</a></td></tr>
</table>

<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:${TEXT_PRIMARY};">Reply to this email if anything's broken or you want to talk about a specific use case. We're listening to the early cohort closely.</p>
<p style="margin:0 0 32px 0;font-size:16px;line-height:1.6;color:${TEXT_PRIMARY};">&mdash; The Paracosm team</p>
</td></tr>

<tr><td style="padding:24px 40px;border-top:1px solid #2a1f18;font-size:12px;color:${TEXT_MUTED};">
<p style="margin:0 0 6px 0;">Sent to <strong style="color:${TEXT_PRIMARY};">${safeEmail}</strong> from <a href="mailto:${SUPPORT_EMAIL}" style="color:${ACCENT_AMBER};text-decoration:none;">${SUPPORT_EMAIL}</a>.</p>
<p style="margin:0;"><a href="https://frame.dev" style="color:${ACCENT_AMBER};text-decoration:none;">Frame.dev</a> &middot; <a href="https://agentos.sh" style="color:${ACCENT_AMBER};text-decoration:none;">agentos.sh</a> &middot; <a href="https://manic.agency" style="color:${ACCENT_AMBER};text-decoration:none;">manic.agency</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const text = [
    `You're in — Paracosm hosted access is open.`,
    '',
    input.name ? `Hi ${input.name},` : 'Hi,',
    '',
    `Hosted Paracosm access is open. You can now run scenarios, fork worlds, and inspect run artifacts directly in the browser — no install, no API key required to start.`,
    '',
    `Open the dashboard: ${PARACOSM_DEMO}`,
    '',
    'A few starting points:',
    `  -> Simulation studio: ${PARACOSM_DEMO}/sim`,
    `  -> API reference: ${PARACOSM_DEMO}/docs`,
    `  -> npm: ${PARACOSM_NPM}`,
    `  -> Source: ${PARACOSM_REPO}`,
    '',
    `Reply to this email if anything's broken or you want to talk about a specific use case.`,
    '',
    '-- The Paracosm team',
    '',
    `Sent to ${input.email} from ${SUPPORT_EMAIL}.`,
    'frame.dev | agentos.sh | manic.agency',
  ].join('\n');

  return { subject, html, text };
}
