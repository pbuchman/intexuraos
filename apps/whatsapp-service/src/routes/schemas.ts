import { z } from 'zod';

/**
 * Query parameters for webhook verification GET request.
 * Meta sends these when verifying webhook URL.
 */
export const webhookVerifyQuerySchema = z.object({
  'hub.mode': z.literal('subscribe'),
  'hub.verify_token': z.string().min(1),
  'hub.challenge': z.string().min(1),
});

export type WebhookVerifyQuery = z.infer<typeof webhookVerifyQuerySchema>;

/**
 * WhatsApp webhook message contact.
 */
const contactSchema = z.object({
  wa_id: z.string(),
  profile: z
    .object({
      name: z.string(),
    })
    .optional(),
});

/**
 * WhatsApp webhook message text.
 */
const textSchema = z.object({
  body: z.string(),
});

/**
 * WhatsApp webhook message.
 */
const messageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: textSchema.optional(),
});

/**
 * WhatsApp webhook status.
 */
const statusSchema = z.object({
  id: z.string(),
  status: z.enum(['delivered', 'read', 'sent', 'failed']),
  timestamp: z.string(),
  recipient_id: z.string(),
});

/**
 * WhatsApp webhook value containing messages or statuses.
 */
const webhookValueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string(),
    phone_number_id: z.string(),
  }),
  contacts: z.array(contactSchema).optional(),
  messages: z.array(messageSchema).optional(),
  statuses: z.array(statusSchema).optional(),
});

/**
 * WhatsApp webhook change entry.
 */
const webhookChangeSchema = z.object({
  field: z.literal('messages'),
  value: webhookValueSchema,
});

/**
 * WhatsApp webhook entry.
 */
const webhookEntrySchema = z.object({
  id: z.string(),
  changes: z.array(webhookChangeSchema),
});

/**
 * WhatsApp webhook payload (POST body).
 */
export const webhookPayloadSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(webhookEntrySchema),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

/**
 * Persisted webhook event for Firestore storage.
 */
export interface PersistedWebhookEvent {
  /**
   * Unique event ID (generated).
   */
  id: string;
  /**
   * Raw webhook payload from Meta.
   */
  payload: unknown;
  /**
   * Whether signature was valid.
   */
  signatureValid: boolean;
  /**
   * Timestamp when event was received.
   */
  receivedAt: string;
  /**
   * Phone number ID from metadata.
   */
  phoneNumberId: string | null;
}
