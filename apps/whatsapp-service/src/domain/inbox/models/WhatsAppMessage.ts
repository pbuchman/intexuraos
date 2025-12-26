/**
 * Domain model for stored WhatsApp messages.
 * Represents a text message received via WhatsApp webhook.
 */

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
