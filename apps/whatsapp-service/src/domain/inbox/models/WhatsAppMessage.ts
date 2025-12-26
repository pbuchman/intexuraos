/**
 * Domain model for stored WhatsApp messages.
 * Represents a text, image, or audio message received via WhatsApp webhook.
 */

/**
 * Type of WhatsApp message content.
 */
export type WhatsAppMediaType = 'text' | 'image' | 'audio';

/**
 * Media information from WhatsApp webhook.
 */
export interface WhatsAppMediaInfo {
  /**
   * WhatsApp media ID.
   */
  id: string;

  /**
   * MIME type of the media (e.g., 'image/jpeg', 'audio/ogg').
   */
  mimeType: string;

  /**
   * File size in bytes.
   */
  fileSize: number;

  /**
   * SHA256 hash of the file (from WhatsApp).
   */
  sha256?: string;
}

/**
 * Status of audio transcription.
 */
export type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Operation types for speech-to-text API calls.
 */
export type TranscriptionApiOperation = 'submit' | 'poll' | 'fetch_result';

/**
 * Error information for failed transcriptions.
 */
export interface TranscriptionError {
  code: string;
  message: string;
}

/**
 * Last API call tracking for debugging.
 */
export interface TranscriptionApiCall {
  timestamp: string;
  operation: TranscriptionApiOperation;
  success: boolean;
  response?: unknown;
}

/**
 * Transcription state for audio messages.
 * Tracks the entire lifecycle of speech-to-text processing.
 */
export interface TranscriptionState {
  /**
   * Current transcription status.
   */
  status: TranscriptionStatus;

  /**
   * Provider job ID (e.g., Speechmatics job ID).
   */
  jobId?: string;

  /**
   * Transcription result text.
   */
  text?: string;

  /**
   * Error details if transcription failed.
   */
  error?: TranscriptionError;

  /**
   * Last API call details for debugging.
   */
  lastApiCall?: TranscriptionApiCall;

  /**
   * When transcription processing started (ISO 8601).
   */
  startedAt?: string;

  /**
   * When transcription completed or failed (ISO 8601).
   */
  completedAt?: string;
}

/**
 * WhatsApp message stored in Firestore.
 */
export interface WhatsAppMessage {
  /**
   * Firestore document ID.
   */
  id: string;

  /**
   * IntexuraOS user ID who owns this message.
   */
  userId: string;

  /**
   * WhatsApp message ID (wamid.xxx).
   */
  waMessageId: string;

  /**
   * Sender phone number (E.164 format).
   */
  fromNumber: string;

  /**
   * Receiving business phone number (display format).
   */
  toNumber: string;

  /**
   * Message text content.
   */
  text: string;

  /**
   * Type of message content.
   * Defaults to 'text' for backward compatibility.
   */
  mediaType: WhatsAppMediaType;

  /**
   * Media information (for image/audio messages).
   */
  media?: WhatsAppMediaInfo;

  /**
   * GCS path to the original media file.
   */
  gcsPath?: string;

  /**
   * GCS path to the thumbnail (for images).
   */
  thumbnailGcsPath?: string;

  /**
   * Caption text accompanying media.
   */
  caption?: string;

  /**
   * Transcription state for audio messages.
   * Contains job ID, status, result, and API call tracking.
   */
  transcription?: TranscriptionState;

  /**
   * Timestamp from WhatsApp (Unix epoch string).
   */
  timestamp: string;

  /**
   * When webhook received this message (ISO 8601).
   */
  receivedAt: string;

  /**
   * Reference to webhook_events document.
   */
  webhookEventId: string;

  /**
   * Additional metadata from the webhook payload.
   */
  metadata?: WhatsAppMessageMetadata;
}

/**
 * Optional metadata from webhook payload.
 */
export interface WhatsAppMessageMetadata {
  /**
   * Sender's WhatsApp profile name (if available).
   */
  senderName?: string;

  /**
   * Business phone number ID.
   */
  phoneNumberId?: string;
}
