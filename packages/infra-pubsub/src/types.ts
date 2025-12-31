/**
 * Pub/Sub infrastructure types.
 */

/**
 * Error returned when a publish operation fails.
 */
export interface PublishError {
  code: 'PUBLISH_FAILED' | 'TOPIC_NOT_FOUND' | 'PERMISSION_DENIED';
  message: string;
}

/**
 * Event to send a WhatsApp message.
 * This is the payload format expected by whatsapp-service's SendMessageWorker.
 */
export interface SendMessageEvent {
  /**
   * Event type identifier.
   */
  type: 'whatsapp.message.send';

  /**
   * IntexuraOS user ID (for audit/logging).
   */
  userId: string;

  /**
   * Recipient phone number (E.164 format, e.g., +48123456789).
   */
  phoneNumber: string;

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
 * Configuration for the WhatsApp send publisher.
 */
export interface WhatsAppSendPublisherConfig {
  projectId: string;
  topicName: string;
}
