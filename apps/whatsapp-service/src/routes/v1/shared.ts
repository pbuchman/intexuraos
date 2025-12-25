import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

/**
 * Handle Zod validation errors.
 * Converts Zod errors to standard API error response.
 */
export function handleValidationError(error: ZodError, reply: FastifyReply): FastifyReply {
  const details = error.errors.map((e) => ({
    path: e.path.join('.'),
    message: e.message,
  }));
  return reply.fail('INVALID_REQUEST', 'Validation failed', undefined, {
    errors: details,
  });
}

/**
 * WhatsApp webhook payload structure (partial, for extraction).
 * Based on actual Meta webhook format.
 */
interface WebhookValue {
  metadata?: {
    phone_number_id?: string;
    display_phone_number?: string;
  };
  messages?: {
    from?: string;
    id?: string;
  }[];
}

interface WebhookChange {
  value?: WebhookValue;
}

interface WebhookEntry {
  changes?: WebhookChange[];
}

interface WebhookPayloadShape {
  entry?: WebhookEntry[];
}

/**
 * Safely extract the first webhook value from payload.
 */
function extractFirstValue(payload: unknown): WebhookValue | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const p = payload as WebhookPayloadShape;
  const entry = p.entry?.[0];
  if (entry === undefined) return null;

  const change = entry.changes?.[0];
  if (change === undefined) return null;

  return change.value ?? null;
}

/**
 * Extract phone number ID from webhook payload.
 * This is the Meta-assigned ID for the WhatsApp Business phone number receiving the message.
 *
 * Path: entry[0].changes[0].value.metadata.phone_number_id
 */
export function extractPhoneNumberId(payload: unknown): string | null {
  const value = extractFirstValue(payload);
  return value?.metadata?.phone_number_id ?? null;
}

/**
 * Extract display phone number from webhook payload.
 * This is the actual phone number in international format WITHOUT leading "+".
 * Example: "15551381846" (not "+15551381846")
 *
 * Path: entry[0].changes[0].value.metadata.display_phone_number
 */
export function extractDisplayPhoneNumber(payload: unknown): string | null {
  const value = extractFirstValue(payload);
  return value?.metadata?.display_phone_number ?? null;
}

/**
 * Extract sender phone number from webhook payload.
 * This is the WhatsApp user who sent the message, in international format WITHOUT leading "+".
 * Example: "48534042325" (not "+48534042325")
 *
 * Path: entry[0].changes[0].value.messages[0].from
 */
export function extractSenderPhoneNumber(payload: unknown): string | null {
  const value = extractFirstValue(payload);
  const message = value?.messages?.[0];
  if (message === undefined) return null;
  return typeof message.from === 'string' ? message.from : null;
}

/**
 * Extract message ID from webhook payload.
 * Used for creating message replies (context).
 *
 * Path: entry[0].changes[0].value.messages[0].id
 */
export function extractMessageId(payload: unknown): string | null {
  const value = extractFirstValue(payload);
  const message = value?.messages?.[0];
  if (message === undefined) return null;
  return typeof message.id === 'string' ? message.id : null;
}
