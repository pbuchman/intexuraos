/**
 * Types for the WhatsApp send Pub/Sub client.
 */
import type { Logger } from 'pino';

/**
 * WhatsApp interactive button for reply messages.
 */
export interface WhatsAppInteractiveButton {
  type: 'reply';
  reply: {
    id: string;
    title: string;
  };
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
   * Optional: Interactive buttons for the message.
   * Cannot be combined with ctaUrl (WhatsApp API constraint).
   */
  buttons?: WhatsAppInteractiveButton[];

  /**
   * Optional: CTA URL button that opens a link in the browser.
   * Cannot be combined with buttons (WhatsApp API constraint).
   */
  ctaUrl?: { displayText: string; url: string };

  /**
   * Optional: marks the message as important so whatsapp-service delivers it
   * even when the recipient has opted into 'important' notifications only.
   */
  important?: boolean;

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
  logger: Logger;
}
