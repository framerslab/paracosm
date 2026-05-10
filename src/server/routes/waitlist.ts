/**
 * POST /api/waitlist handler. Validates payload, rate-limits per IP,
 * inserts into the waitlist store, fires confirmation email
 * best-effort. Returns the user's position. Email is awaited so we
 * can report `emailSent` accurately to the client; the await never
 * throws because `sendEmail` swallows all errors.
 *
 * @module paracosm/cli/server/waitlist-route
 */
import { z } from 'zod';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type WaitlistStore, WAITLIST_USER_TYPES } from '../stores/waitlist.js';
import type { SendEmailParams } from '../services/email.js';
import { renderWaitlistConfirmation } from '../services/email-templates.js';

const WaitlistBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  useCase: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  source: z
    .string()
    .trim()
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  // Self-classification ('hobbyist' if omitted). Strict enum so the column
  // never receives unexpected values; the store enforces the same set.
  userType: z
    .enum(WAITLIST_USER_TYPES)
    .optional()
    .or(z.literal('').transform(() => undefined))
    .default('hobbyist'),
});

export interface RateLimitDecisionLike {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export interface WaitlistRouteDeps {
  waitlistStore: WaitlistStore;
  sendEmail: (params: SendEmailParams) => Promise<boolean>;
  rateLimiter: {
    consumeWaitlist: (ip: string) => RateLimitDecisionLike;
    getClientIp: (req: IncomingMessage) => string;
  };
  waitlistFrom: string;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function handleWaitlist(
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: string,
  deps: WaitlistRouteDeps,
): Promise<void> {
  let parsed;
  try {
    parsed = WaitlistBodySchema.safeParse(JSON.parse(rawBody || '{}'));
  } catch {
    jsonResponse(res, 400, { error: 'Invalid JSON' });
    return;
  }
  if (!parsed.success) {
    jsonResponse(res, 400, {
      error: 'Invalid payload',
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
    return;
  }
  const ip = deps.rateLimiter.getClientIp(req);
  const decision = deps.rateLimiter.consumeWaitlist(ip);
  if (!decision.allowed) {
    jsonResponse(res, 429, {
      error: 'Already submitted recently. Try again in a few minutes.',
    });
    return;
  }

  const { email, name, useCase, source, userType } = parsed.data;
  let result;
  try {
    result = await deps.waitlistStore.insertOrGetExisting({
      email,
      name: name ?? null,
      useCase: useCase ?? null,
      source: source ?? null,
      userType,
      ip,
    });
  } catch (err) {
    console.error('[waitlist] store insert failed:', err);
    jsonResponse(res, 500, { error: 'Waitlist insert failed' });
    return;
  }

  let emailSent = false;
  if (!result.alreadyExisted) {
    const rendered = renderWaitlistConfirmation({
      email,
      name: name ?? null,
      position: result.position,
      useCase: useCase ?? null,
    });
    emailSent = await deps.sendEmail({
      from: deps.waitlistFrom,
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: 'team@frame.dev',
    });
  }

  jsonResponse(res, 200, {
    ok: true,
    position: result.position,
    alreadyOnList: result.alreadyExisted,
    emailSent,
  });
}
