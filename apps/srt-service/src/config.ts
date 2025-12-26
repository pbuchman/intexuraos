/**
 * Configuration module for srt-service.
 * Validates required environment variables using Zod.
 */
import { z } from 'zod';

/**
 * Schema for SRT service configuration.
 */
const configSchema = z.object({
  /**
   * Speechmatics API key.
   */
  speechmaticsApiKey: z.string().min(1, 'INTEXURAOS_SPEECHMATICS_API_KEY is required'),

  /**
   * Pub/Sub subscription for audio stored events.
   */
  audioStoredSubscription: z.string().min(1, 'PUBSUB_AUDIO_STORED_SUBSCRIPTION is required'),

  /**
   * Pub/Sub topic for transcription completed events.
   */
  transcriptionCompletedTopic: z
    .string()
    .min(1, 'PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC is required'),

  /**
   * GCP Project ID.
   */
  gcpProjectId: z.string().min(1, 'GCP_PROJECT_ID is required'),

  /**
   * GCS bucket name for WhatsApp media files.
   */
  mediaBucketName: z.string().min(1, 'MEDIA_BUCKET_NAME is required'),

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
    speechmaticsApiKey: process.env['INTEXURAOS_SPEECHMATICS_API_KEY'],
    audioStoredSubscription: process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_SUBSCRIPTION'],
    transcriptionCompletedTopic: process.env['INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC'],
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'],
    mediaBucketName: process.env['INTEXURAOS_MEDIA_BUCKET_NAME'],
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
    'INTEXURAOS_SPEECHMATICS_API_KEY',
    'INTEXURAOS_PUBSUB_AUDIO_STORED_SUBSCRIPTION',
    'INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC',
    'INTEXURAOS_GCP_PROJECT_ID',
    'INTEXURAOS_MEDIA_BUCKET_NAME',
  ];
  return required.filter((key) => process.env[key] === undefined || process.env[key] === '');
}
