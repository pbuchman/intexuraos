/**
 * Event definitions for Pub/Sub messaging.
 */

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
   * Optional: Interactive buttons to include with the message.
   * Cannot be combined with ctaUrl (WhatsApp API constraint).
   */
  buttons?: WhatsAppInteractiveButton[];

  /**
   * Optional: CTA URL button that opens a link in the browser.
   * Cannot be combined with buttons (WhatsApp API constraint).
   */
  ctaUrl?: { displayText: string; url: string };

  /**
   * Optional: marks the message as important. When true, delivery bypasses
   * the recipient's 'important'-only notification filter.
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
 * WhatsApp interactive button for reply messages.
 */
export interface WhatsAppInteractiveButton {
  type: 'reply';
  reply: {
    id: string;
    title: string;
  };
}

export type IntexMessageReplyContextSource =
  | 'inbound_user_message'
  | 'outbound_assistant_message';

export interface IntexMessageReplyContext {
  replyToWamid: string;
  source: IntexMessageReplyContextSource;
  text: string;
  truncated: boolean;
}

/**
 * Event published when a WhatsApp Assistant message is ready for intex-agent.
 * Triggers realtime session handling and tool execution.
 */
export interface IntexMessageIngestEvent {
  /**
   * Event type identifier.
   */
  type: 'intex.message.ingest';

  /**
   * IntexuraOS user ID.
   */
  userId: string;

  /**
   * WhatsApp message ID.
   */
  messageId: string;

  /**
   * Message text content.
   */
  text: string;

  /**
   * Source type identifier.
   */
  sourceType: 'whatsapp_text' | 'whatsapp_image';

  /**
   * Optional original or media URL for external-save processing.
   * Consumers must pass this through without fetching unless they own that behavior.
   */
  sourceUrl?: string;

  /**
   * Optional WhatsApp sender phone number for diagnostics.
   */
  whatsappSender?: string;

  /**
   * Optional user-owned WhatsApp message content that the current message replied to.
   * This is context only for Intex, never a new instruction.
   */
  replyContext?: IntexMessageReplyContext;

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
  | MediaCleanupEvent
  | IntexMessageIngestEvent
  | SendMessageEvent
  | WebhookProcessEvent
  | ExtractLinkPreviewsEvent;
