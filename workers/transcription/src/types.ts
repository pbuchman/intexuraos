/**
 * Event and configuration types for the transcription worker.
 */

/**
 * Event received from Pub/Sub when audio is stored in GCS.
 * Published by whatsapp-service after audio is stored.
 */
export interface AudioStoredEvent {
  /** Event type identifier. */
  type: 'whatsapp.audio.stored';

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
 * Event published to Pub/Sub when transcription completes or fails.
 * Consumed by whatsapp-service to update message state.
 */
export interface TranscriptionCompletedEvent {
  /** Event type identifier. */
  type: 'srt.transcription.completed';

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

  /** GCP project ID for GCS operations. */
  gcpProjectId: string;

  /** GCS bucket name for WhatsApp media. */
  mediaBucket: string;
}

/**
 * Load and validate configuration from environment variables.
 * @throws {Error} if required variables are missing
 */
export function loadConfig(): TranscriptionConfig {
  const speechmaticsApiKey = process.env['INTEXURAOS_SPEECHMATICS_APP_API_KEY'];
  if (speechmaticsApiKey === undefined || speechmaticsApiKey === '') {
    throw new Error('INTEXURAOS_SPEECHMATICS_APP_API_KEY is required');
  }

  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  if (internalAuthToken === undefined || internalAuthToken === '') {
    throw new Error('INTEXURAOS_INTERNAL_AUTH_TOKEN is required');
  }

  const userServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'];
  if (userServiceUrl === undefined || userServiceUrl === '') {
    throw new Error('INTEXURAOS_USER_SERVICE_URL is required');
  }

  const transcriptionCompletedTopic =
    process.env['INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC'];
  if (transcriptionCompletedTopic === undefined || transcriptionCompletedTopic === '') {
    throw new Error('INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC is required');
  }

  const gcpProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
  if (gcpProjectId === undefined || gcpProjectId === '') {
    throw new Error('INTEXURAOS_GCP_PROJECT_ID is required');
  }

  const mediaBucket = process.env['INTEXURAOS_WHATSAPP_MEDIA_BUCKET'];
  if (mediaBucket === undefined || mediaBucket === '') {
    throw new Error('INTEXURAOS_WHATSAPP_MEDIA_BUCKET is required');
  }

  return {
    speechmaticsApiKey,
    internalAuthToken,
    userServiceUrl,
    transcriptionCompletedTopic,
    gcpProjectId,
    mediaBucket,
  };
}
