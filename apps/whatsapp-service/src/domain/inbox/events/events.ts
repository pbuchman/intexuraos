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
 * Union of all event types for type safety.
 */
export type WhatsAppEvent = AudioStoredEvent | MediaCleanupEvent;
