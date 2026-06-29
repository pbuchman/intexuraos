/**
 * Event and configuration types for the transcription worker.
 */

import { loadRequiredEnv } from './__shims__/common-worker.js';

/**
 * Event received from Pub/Sub when audio is stored in GCS.
 * Published by whatsapp-service after audio is stored.
 */
export interface AudioStoredEvent {
  /** Event type identifier. */
  type: 'whatsapp.audio.stored';

  /** Source collection where the message is stored. */
  messageSource?: 'public_whatsapp' | 'private_whatsapp';

  /** IntexuraOS user ID. */
  userId: string;

  /** WhatsApp message ID. */
  messageId: string;

  /** WhatsApp media ID. */
  mediaId: string;

  /** GCS path to the audio file. */
  gcsPath: string;

  /** MIME type of the audio file. */
  mimeType: string;

  /** Event timestamp (ISO 8601). */
  timestamp: string;
}

/**
 * Event received from Pub/Sub when stored WhatsApp media should be transcribed.
 * Published by whatsapp-service for media types beyond the legacy audio event.
 */
export interface MediaTranscriptionRequestedEvent {
  /** Event type identifier. */
  type: 'whatsapp.media.transcription.requested';

  /** Source collection where the message is stored. */
  messageSource?: 'public_whatsapp' | 'private_whatsapp';

  /** Kind of stored media to transcribe. */
  mediaKind: 'audio' | 'video';

  /** IntexuraOS user ID. */
  userId: string;

  /** WhatsApp message ID. */
  messageId: string;

  /** WhatsApp media ID. */
  mediaId: string;

  /** GCS path to the media file. */
  gcsPath: string;

  /** MIME type of the media file. */
  mimeType: string;

  /** Event timestamp (ISO 8601). */
  timestamp: string;
}

export type TranscriptionRequestEvent = AudioStoredEvent | MediaTranscriptionRequestedEvent;

/**
 * Event published to Pub/Sub when transcription completes or fails.
 * Consumed by whatsapp-service to update message state.
 */
export interface TranscriptionCompletedEvent {
  /** Event type identifier. */
  type: 'srt.transcription.completed';

  /** Source collection where the message is stored. */
  messageSource?: 'public_whatsapp' | 'private_whatsapp';

  /** Kind of media that was transcribed. */
  mediaKind?: 'audio' | 'video';

  /** IntexuraOS user ID. */
  userId: string;

  /** WhatsApp message ID. */
  messageId: string;

  /** Transcription provider job ID. */
  jobId: string;

  /** Transcription result status. */
  status: 'completed' | 'failed';

  /** Transcribed text (when status is 'completed'). */
  transcript?: string;

  /** AI-generated summary (when available). */
  summary?: string;

  /** Detected language code (e.g., 'pl', 'en'). */
  detectedLanguage?: string;

  /** Error message (when status is 'failed'). */
  error?: string;

  /** Event timestamp (ISO 8601). */
  timestamp: string;
}

/**
 * Transcription worker configuration loaded from environment variables.
 */
export interface TranscriptionConfig {
  /** Speechmatics API key for transcription. */
  speechmaticsApiKey: string;

  /** Internal auth token for user-service calls. */
  internalAuthToken: string;

  /** Base URL of user-service. */
  userServiceUrl: string;

  /** Pub/Sub topic for transcription completed events. */
  transcriptionCompletedTopic: string;

  /** Pub/Sub topic for transcription dead-letter events (parse / schema failures). */
  transcriptionDlqTopic: string;

  /** GCP project ID for GCS operations. */
  gcpProjectId: string;

  /** GCS bucket name for WhatsApp media. */
  mediaBucket: string;
}

/**
 * Load and validate configuration from environment variables.
 *
 * Aggregates ALL missing required vars into a single error so deployers see
 * the full list at once instead of N restart cycles. Empty strings count as
 * missing (per `loadRequiredEnv` contract).
 *
 * @throws {Error} if any required variable is missing or empty
 */
export function loadConfig(): TranscriptionConfig {
  const env = loadRequiredEnv({
    INTEXURAOS_SPEECHMATICS_APP_API_KEY: { required: true },
    INTEXURAOS_INTERNAL_AUTH_TOKEN: { required: true },
    INTEXURAOS_USER_SERVICE_URL: { required: true },
    INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC: { required: true },
    INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC: { required: true },
    INTEXURAOS_GCP_PROJECT_ID: { required: true },
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET: { required: true },
  });

  return {
    speechmaticsApiKey: env.INTEXURAOS_SPEECHMATICS_APP_API_KEY,
    internalAuthToken: env.INTEXURAOS_INTERNAL_AUTH_TOKEN,
    userServiceUrl: env.INTEXURAOS_USER_SERVICE_URL,
    transcriptionCompletedTopic: env.INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC,
    transcriptionDlqTopic: env.INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC,
    gcpProjectId: env.INTEXURAOS_GCP_PROJECT_ID,
    mediaBucket: env.INTEXURAOS_WHATSAPP_MEDIA_BUCKET,
  };
}
