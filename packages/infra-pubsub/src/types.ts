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
 * This is the payload format expected by whatsapp-service's Pub/Sub handler.
 * Phone number lookup is done internally by whatsapp-service using userId.
 */
export interface SendMessageEvent {
  /**
   * Event type identifier.
   */
  type: 'whatsapp.message.send';

  /**
   * IntexuraOS user ID. whatsapp-service looks up the phone number internally.
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
 * Configuration for the WhatsApp send publisher.
 */
export interface WhatsAppSendPublisherConfig {
  projectId: string;
  topicName: string;
}
