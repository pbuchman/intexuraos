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
   * Reference to transcription job (for audio messages).
   */
  transcriptionJobId?: string;

  /**
   * Transcription status for audio messages.
   */
  transcriptionStatus?: 'pending' | 'processing' | 'completed' | 'failed';

  /**
   * Transcription text (when completed).
   */
  transcription?: string;

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
