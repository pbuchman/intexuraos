/**
 * Event definitions for Pub/Sub messaging.
 */

/**
 * Event published when audio is stored and ready for transcription.
 */
export interface AudioStoredEvent {
  /**
   * Event type identifier.
   */
  type: 'whatsapp.audio.stored';

  /**
   * IntexuraOS user ID.
   */
  userId: string;

  /**
   * WhatsApp message ID.
   */
  messageId: string;

  /**
   * WhatsApp media ID.
   */
  mediaId: string;

  /**
   * GCS path to the audio file.
   */
  gcsPath: string;

  /**
   * MIME type of the audio file.
   */
  mimeType: string;

  /**
   * Event timestamp (ISO 8601).
   */
  timestamp: string;
}

/**
 * Event published when media needs cleanup (message deleted).
 */
export interface MediaCleanupEvent {
  /**
   * Event type identifier.
   */
  type: 'whatsapp.media.cleanup';

  /**
   * IntexuraOS user ID.
   */
  userId: string;

  /**
   * WhatsApp message ID.
   */
  messageId: string;

  /**
   * GCS paths to delete (original + thumbnail if applicable).
   */
  gcsPaths: string[];

  /**
   * Event timestamp (ISO 8601).
   */
  timestamp: string;
}

/**
 * Event published when transcription is completed.
 */
export interface TranscriptionCompletedEvent {
  /**
   * Event type identifier.
   */
  type: 'srt.transcription.completed';

  /**
   * IntexuraOS user ID.
   */
  userId: string;

  /**
   * WhatsApp message ID.
   */
  messageId: string;

  /**
   * Transcription job ID (srt-service internal ID).
   */
  jobId: string;

  /**
   * Status of transcription.
   */
  status: 'completed' | 'failed';

  /**
   * Transcription text (when completed successfully).
   */
  transcript?: string;

  /**
   * Error message (when failed).
   */
  error?: string;

  /**
   * Event timestamp (ISO 8601).
   */
  timestamp: string;
}

/**
 * Event received to send an outbound WhatsApp message.
 * Published by other services (e.g., research-agent) to request message sending.
 * The phone number is looked up internally using userId.
 */
export interface SendMessageEvent {
  /**
   * Event type identifier.
   */
  type: 'whatsapp.message.send';

  /**
   * IntexuraOS user ID. Used to look up the phone number internally.
   */
  userId: string;

  /**
   * Message text to send.
   */
  message: string;

  /**
   * Optional: WhatsApp message ID to reply to.
   */
  replyToMessageId?: string;

  /**
   * Correlation ID for tracing across services.
   */
  correlationId: string;

  /**
   * Event timestamp (ISO 8601).
   */
  timestamp: string;
}

/**
 * Event published when a command is ready for ingestion.
 * Triggers the commands-agent to classify and create actions.
 */
export interface CommandIngestEvent {
  /**
   * Event type identifier.
   */
  type: 'command.ingest';

  /**
   * IntexuraOS user ID.
   */
  userId: string;

  /**
   * Source type identifier.
   */
  sourceType: 'whatsapp_text' | 'whatsapp_voice';

  /**
   * External ID (WhatsApp message ID).
   */
  externalId: string;

  /**
   * Command text content.
   */
  text: string;

  /**
   * Event timestamp (ISO 8601).
   */
  timestamp: string;
}

/**
 * Event published when a webhook needs async processing.
 * Decouples webhook response from processing to avoid CPU throttling.
 */
export interface WebhookProcessEvent {
  type: 'whatsapp.webhook.process';
  eventId: string;
  payload: string;
  phoneNumberId: string;
  receivedAt: string;
}

/**
 * Event published when audio needs transcription.
 * Triggers async transcription polling (up to 5 min).
 */
export interface TranscribeAudioEvent {
  type: 'whatsapp.audio.transcribe';
  messageId: string;
  userId: string;
  gcsPath: string;
  mimeType: string;
  userPhoneNumber: string;
  originalWaMessageId: string;
  phoneNumberId: string;
}

/**
 * Event published when text message contains URLs for preview extraction.
 */
export interface ExtractLinkPreviewsEvent {
  type: 'whatsapp.linkpreview.extract';
  messageId: string;
  userId: string;
  text: string;
}

/**
 * Union of all event types for type safety.
 */
export type WhatsAppEvent =
  | AudioStoredEvent
  | MediaCleanupEvent
  | TranscriptionCompletedEvent
  | CommandIngestEvent
  | SendMessageEvent
  | WebhookProcessEvent
  | TranscribeAudioEvent
  | ExtractLinkPreviewsEvent;
