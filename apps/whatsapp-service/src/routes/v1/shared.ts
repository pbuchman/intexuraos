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
 * Extract phone number ID from webhook payload if available.
 */
export function extractPhoneNumberId(payload: unknown): string | null {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'entry' in payload &&
    Array.isArray((payload as { entry: unknown }).entry)
  ) {
    const entry = (payload as { entry: unknown[] }).entry[0];
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'changes' in entry &&
      Array.isArray((entry as { changes: unknown }).changes)
    ) {
      const change = (entry as { changes: unknown[] }).changes[0];
      if (
        typeof change === 'object' &&
        change !== null &&
        'value' in change &&
        typeof (change as { value: unknown }).value === 'object' &&
        (change as { value: unknown }).value !== null
      ) {
        const value = (change as { value: { metadata?: { phone_number_id?: string } } }).value;
        if (value.metadata?.phone_number_id !== undefined) {
          return value.metadata.phone_number_id;
        }
      }
    }
  }
  return null;
}

/**
 * Extract sender phone number from webhook payload if available.
 */
export function extractSenderPhoneNumber(payload: unknown): string | null {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'entry' in payload &&
    Array.isArray((payload as { entry: unknown }).entry)
  ) {
    const entry = (payload as { entry: unknown[] }).entry[0];
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'changes' in entry &&
      Array.isArray((entry as { changes: unknown }).changes)
    ) {
      const change = (entry as { changes: unknown[] }).changes[0];
      if (
        typeof change === 'object' &&
        change !== null &&
        'value' in change &&
        typeof (change as { value: unknown }).value === 'object' &&
        (change as { value: unknown }).value !== null
      ) {
        const value = (change as { value: { messages?: { from?: string }[] } }).value;
        if (
          value.messages !== undefined &&
          Array.isArray(value.messages) &&
          value.messages.length > 0
        ) {
          const message = value.messages[0];
          if (message !== undefined && typeof message.from === 'string') {
            return message.from;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Extract message ID from webhook payload if available.
 * Used for creating message replies (context).
 */
export function extractMessageId(payload: unknown): string | null {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'entry' in payload &&
    Array.isArray((payload as { entry: unknown }).entry)
  ) {
    const entry = (payload as { entry: unknown[] }).entry[0];
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'changes' in entry &&
      Array.isArray((entry as { changes: unknown }).changes)
    ) {
      const change = (entry as { changes: unknown[] }).changes[0];
      if (
        typeof change === 'object' &&
        change !== null &&
        'value' in change &&
        typeof (change as { value: unknown }).value === 'object' &&
        (change as { value: unknown }).value !== null
      ) {
        const value = (change as { value: { messages?: { id?: string }[] } }).value;
        if (
          value.messages !== undefined &&
          Array.isArray(value.messages) &&
          value.messages.length > 0
        ) {
          const message = value.messages[0];
          if (message !== undefined && typeof message.id === 'string') {
            return message.id;
          }
        }
      }
    }
  }
  return null;
}
