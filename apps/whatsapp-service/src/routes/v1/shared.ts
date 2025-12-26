import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

/**
 * Phone number validation patterns for supported countries.
 * Pattern validates the full number with country code (digits only).
 */
const PHONE_PATTERNS: Record<string, { pattern: RegExp; name: string }> = {
  // Poland: +48 followed by 9 digits starting with non-zero
  '48': { pattern: /^48[1-9]\d{8}$/, name: 'Poland' },
  // USA: +1 followed by 10 digits, first digit 2-9
  '1': { pattern: /^1[2-9]\d{9}$/, name: 'USA' },
};

/**
 * Normalize phone number to consistent format for storage and comparison.
 *
 * Storage format: digits only, no "+" prefix (e.g., "48123456789")
 *
 * This ensures:
 * - User saves "+48123456789" → stored as "48123456789"
 * - Webhook sends "48123456789" → matches stored "48123456789"
 *
 * @example normalizePhoneNumber("+48123456789") => "48123456789"
 * @example normalizePhoneNumber("48123456789") => "48123456789"
 * @example normalizePhoneNumber("+1-555-123-4567") => "15551234567"
 */
export function normalizePhoneNumber(phoneNumber: string): string {
  // Remove all non-digit characters (including +, spaces, dashes, parentheses)
  return phoneNumber.replace(/\D/g, '');
}

/**
 * Validation result for phone number.
 */
export interface PhoneValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

/**
 * Validate phone number format for supported countries.
 * Returns normalized number if valid.
 *
 * Supported countries: Poland (+48), USA (+1)
 */
export function validatePhoneNumber(phoneNumber: string): PhoneValidationResult {
  const normalized = normalizePhoneNumber(phoneNumber);

  if (normalized.length === 0) {
    return { valid: false, normalized, error: 'Phone number is required' };
  }

  // Check against known country patterns
  for (const [code, { pattern, name }] of Object.entries(PHONE_PATTERNS)) {
    if (normalized.startsWith(code)) {
      if (pattern.test(normalized)) {
        return { valid: true, normalized };
      }
      return {
        valid: false,
        normalized,
        error: `Invalid ${name} phone number format`,
      };
    }
  }

  return {
    valid: false,
    normalized,
    error: 'Unsupported country code. Supported: Poland (+48), USA (+1)',
  };
}

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
 *
 * Based on official Meta documentation:
 * https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 *
 * Example payload structure:
 * {
 *   "object": "whatsapp_business_account",
 *   "entry": [{
 *     "id": "<WHATSAPP_BUSINESS_ACCOUNT_ID>",  // WABA ID
 *     "changes": [{
 *       "value": {
 *         "messaging_product": "whatsapp",
 *         "metadata": {
 *           "display_phone_number": "<BUSINESS_DISPLAY_PHONE_NUMBER>",  // e.g. "15550783881"
 *           "phone_number_id": "<BUSINESS_PHONE_NUMBER_ID>"             // e.g. "106540352242922"
 *         },
 *         "messages": [{
 *           "from": "<WHATSAPP_USER_PHONE_NUMBER>",  // e.g. "16505551234"
 *           "id": "<WHATSAPP_MESSAGE_ID>",
 *           ...
 *         }]
 *       },
 *       "field": "messages"
 *     }]
 *   }]
 * }
 */
interface WebhookValue {
  metadata?: {
    phone_number_id?: string;
    display_phone_number?: string;
  };
  messages?: {
    from?: string;
    id?: string;
    timestamp?: string;
    type?: string;
    text?: {
      body?: string;
    };
  }[];
  contacts?: {
    profile?: {
      name?: string;
    };
  }[];
}

interface WebhookChange {
  value?: WebhookValue;
}

interface WebhookEntry {
  id?: string;
  changes?: WebhookChange[];
}

interface WebhookPayloadShape {
  entry?: WebhookEntry[];
}

/**
 * Safely extract the first webhook entry from payload.
 */
function extractFirstEntry(payload: unknown): WebhookEntry | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const p = payload as WebhookPayloadShape;
  const entry = p.entry?.[0];
  return entry ?? null;
}

/**
 * Safely extract the first webhook value from payload.
 */
function extractFirstValue(payload: unknown): WebhookValue | null {
  const entry = extractFirstEntry(payload);
  if (entry === null) return null;

  const change = entry.changes?.[0];
  if (change === undefined) return null;

  return change.value ?? null;
}

/**
 * Extract WhatsApp Business Account ID (WABA ID) from webhook payload.
 *
 * Path: entry[0].id
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */
export function extractWabaId(payload: unknown): string | null {
  const entry = extractFirstEntry(payload);
  return typeof entry?.id === 'string' ? entry.id : null;
}

/**
 * Extract phone number ID from webhook payload.
 * This is the Meta-assigned ID for the WhatsApp Business phone number receiving the message.
 *
 * Path: entry[0].changes[0].value.metadata.phone_number_id
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */
export function extractPhoneNumberId(payload: unknown): string | null {
  const value = extractFirstValue(payload);
  return value?.metadata?.phone_number_id ?? null;
}

/**
 * Extract display phone number from webhook payload.
 * This is the business phone number in international format WITHOUT leading "+".
 *
 * Example: "15550783881" (not "+15550783881")
 *
 * Path: entry[0].changes[0].value.metadata.display_phone_number
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */
export function extractDisplayPhoneNumber(payload: unknown): string | null {
  const value = extractFirstValue(payload);
  return value?.metadata?.display_phone_number ?? null;
}

/**
 * Extract sender phone number from webhook payload.
 * This is the WhatsApp user who sent the message.
 *
 * Format: International format, typically WITHOUT leading "+".
 * Examples from Meta docs show "16505551234" (no "+").
 *
 * Path: entry[0].changes[0].value.messages[0].from
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components#text-messages
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
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components#text-messages
 */
export function extractMessageId(payload: unknown): string | null {
  const value = extractFirstValue(payload);
  const message = value?.messages?.[0];
  if (message === undefined) return null;
  return typeof message.id === 'string' ? message.id : null;
}

/**
 * Extract message text content from webhook payload.
 *
 * Path: entry[0].changes[0].value.messages[0].text.body
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components#text-messages
 */
export function extractMessageText(payload: unknown): string | null {
  const value = extractFirstValue(payload);
  const message = value?.messages?.[0];
  if (message === undefined) return null;
  return typeof message.text?.body === 'string' ? message.text.body : null;
}

/**
 * Extract message timestamp from webhook payload.
 *
 * Path: entry[0].changes[0].value.messages[0].timestamp
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components#text-messages
 */
export function extractMessageTimestamp(payload: unknown): string | null {
  const value = extractFirstValue(payload);
  const message = value?.messages?.[0];
  if (message === undefined) return null;
  return typeof message.timestamp === 'string' ? message.timestamp : null;
}

/**
 * Extract sender profile name from webhook payload.
 *
 * Path: entry[0].changes[0].value.contacts[0].profile.name
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components#contacts-object
 */
export function extractSenderName(payload: unknown): string | null {
  const value = extractFirstValue(payload);
  const contact = value?.contacts?.[0];
  if (contact === undefined) return null;
  return typeof contact.profile?.name === 'string' ? contact.profile.name : null;
}

/**
 * Extract message type from webhook payload.
 *
 * Path: entry[0].changes[0].value.messages[0].type
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components#text-messages
 */
export function extractMessageType(payload: unknown): string | null {
  const value = extractFirstValue(payload);
  const message = value?.messages?.[0];
  if (message === undefined) return null;
  return typeof message.type === 'string' ? message.type : null;
}
