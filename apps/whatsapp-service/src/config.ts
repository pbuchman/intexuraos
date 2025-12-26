/**
 * Configuration module for whatsapp-service.
 * Validates required environment variables using Zod.
 */
import { z } from 'zod';

/**
 * Schema for WhatsApp service configuration.
 * All values are sourced from environment variables.
 *
 * Webhook validation requires both WABA ID and Phone Number ID to match.
 * This ensures webhooks are only accepted from the configured business account.
 */
const configSchema = z.object({
  /**
   * Webhook verification token.
   * Used to verify webhook registration with Meta.
   */
  verifyToken: z.string().min(1, 'INTEXURAOS_WHATSAPP_VERIFY_TOKEN is required'),

  /**
   * App secret for webhook signature validation.
   * Used to compute HMAC-SHA256 signatures.
   */
  appSecret: z.string().min(1, 'INTEXURAOS_WHATSAPP_APP_SECRET is required'),

  /**
   * WhatsApp access token for sending messages via Graph API.
   * Used to authenticate API requests to send messages.
   */
  accessToken: z.string().min(1, 'INTEXURAOS_WHATSAPP_ACCESS_TOKEN is required'),

  /**
   * Allowed WhatsApp Business Account IDs (WABA IDs).
   * Comma-separated list. Webhooks are rejected if entry[].id doesn't match.
   * Find at: Business Settings → WhatsApp Business Accounts → Account ID
   */
  allowedWabaIds: z
    .string()
    .min(1, 'INTEXURAOS_WHATSAPP_WABA_ID is required')
    .transform((val) => val.split(',').map((id) => id.trim())),

  /**
   * Allowed WhatsApp Business phone number IDs.
   * Comma-separated list. Webhooks are rejected if metadata.phone_number_id doesn't match.
   * Find at: WhatsApp → API Setup → Phone Number ID
   */
  allowedPhoneNumberIds: z
    .string()
    .min(1, 'INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID is required')
    .transform((val) => val.split(',').map((id) => id.trim())),

  /**
   * GCS bucket name for WhatsApp media files.
   */
  mediaBucket: z.string().min(1, 'INTEXURAOS_WHATSAPP_MEDIA_BUCKET is required'),

  /**
   * Pub/Sub topic for audio stored events (triggers srt-service).
   */
  audioStoredTopic: z.string().min(1, 'INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC is required'),

  /**
   * Pub/Sub topic for media cleanup events.
   */
  mediaCleanupTopic: z.string().min(1, 'INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC is required'),

  /**
   * Pub/Sub subscription for media cleanup events.
   * The cleanup worker subscribes to this to process cleanup events.
   */
  mediaCleanupSubscription: z
    .string()
    .min(1, 'INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION is required'),

  /**
   * Pub/Sub subscription for transcription completed events.
   * The transcription worker subscribes to this to update messages.
   */
  transcriptionCompletedSubscription: z
    .string()
    .min(1, 'INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_SUBSCRIPTION is required'),

  /**
   * GCP project ID.
   */
  gcpProjectId: z.string().min(1, 'INTEXURAOS_GCP_PROJECT_ID is required'),

  /**
   * Server port.
   */
  port: z.coerce.number().int().positive().default(8080),

  /**
   * Server host.
   */
  host: z.string().default('0.0.0.0'),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Load and validate configuration from environment variables.
 * Throws if required variables are missing or invalid.
 */
export function loadConfig(): Config {
  return configSchema.parse({
    verifyToken: process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'],
    appSecret: process.env['INTEXURAOS_WHATSAPP_APP_SECRET'],
    accessToken: process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'],
    allowedWabaIds: process.env['INTEXURAOS_WHATSAPP_WABA_ID'],
    allowedPhoneNumberIds: process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'],
    mediaBucket: process.env['INTEXURAOS_WHATSAPP_MEDIA_BUCKET'],
    audioStoredTopic: process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC'],
    mediaCleanupTopic: process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC'],
    mediaCleanupSubscription: process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION'],
    transcriptionCompletedSubscription:
      process.env['INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_SUBSCRIPTION'],
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'],
    port: process.env['PORT'],
    host: process.env['HOST'],
  });
}

/**
 * Validates that required config environment variables are present.
 * Returns list of missing variables.
 */
export function validateConfigEnv(): string[] {
  const required = [
    'INTEXURAOS_WHATSAPP_VERIFY_TOKEN',
    'INTEXURAOS_WHATSAPP_APP_SECRET',
    'INTEXURAOS_WHATSAPP_ACCESS_TOKEN',
    'INTEXURAOS_WHATSAPP_WABA_ID',
    'INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID',
    'INTEXURAOS_WHATSAPP_MEDIA_BUCKET',
    'INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC',
    'INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC',
    'INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION',
    'INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_SUBSCRIPTION',
    'INTEXURAOS_GCP_PROJECT_ID',
  ];
  return required.filter((key) => process.env[key] === undefined || process.env[key] === '');
}
