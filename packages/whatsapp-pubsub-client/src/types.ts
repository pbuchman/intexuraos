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

export const MESSAGE_DIGEST_TEMPLATE_BODY_MAX_CODE_POINTS = 1_024;
// Exact non-variable copy in the frozen template verified by the cutover preflight.
export const MESSAGE_DIGEST_TEMPLATE_FIXED_BODY_CODE_POINTS = 68;
export const MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS = 80;
export const MESSAGE_DIGEST_TEMPLATE_EXCERPT_MAX_CODE_POINTS =
  MESSAGE_DIGEST_TEMPLATE_BODY_MAX_CODE_POINTS -
  MESSAGE_DIGEST_TEMPLATE_FIXED_BODY_CODE_POINTS -
  MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS;
export const MESSAGE_DIGEST_EVENT_MESSAGE = 'Message Digest delivery';
export const MESSAGE_DIGEST_TEMPLATE_V2_WINDOW_LABEL_MAX_CODE_POINTS = 80;
export const MESSAGE_DIGEST_TEMPLATE_V2_HEADLINE_MAX_CODE_POINTS = 200;
export const MESSAGE_DIGEST_TEMPLATE_V2_FIXED_BODY_CODE_POINTS = 88;
export const MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS =
  MESSAGE_DIGEST_TEMPLATE_BODY_MAX_CODE_POINTS -
  MESSAGE_DIGEST_TEMPLATE_V2_FIXED_BODY_CODE_POINTS -
  MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS -
  MESSAGE_DIGEST_TEMPLATE_V2_WINDOW_LABEL_MAX_CODE_POINTS -
  MESSAGE_DIGEST_TEMPLATE_V2_HEADLINE_MAX_CODE_POINTS;

/**
 * Frozen presentation contract for the approved Message Digest Utility template.
 */
export interface WhatsAppMessageDigestV1Presentation {
  kind: 'message_digest_v1';
  digestName: string;
  digestExcerpt: string;
  runUrlSuffix: string;
}

/** Scan-friendly presentation contract for the Polish Message Digest Utility template. */
export interface WhatsAppMessageDigestV2Presentation {
  kind: 'message_digest_v2';
  digestName: string;
  windowLabel: string;
  headline: string;
  digestBody: string;
  runUrlSuffix: string;
}

export type WhatsAppMessageDigestPresentation =
  | WhatsAppMessageDigestV1Presentation
  | WhatsAppMessageDigestV2Presentation;

/**
 * Non-secret identity used by whatsapp-service to acquire a just-in-time
 * Message Digest delivery authorization before calling the provider.
 */
export interface WhatsAppMessageDigestDeliveryAuthorization {
  kind: 'message_digest_delivery_v1';
  definitionId: string;
  runId: string;
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
   * Optional approved-template presentation. Message Digests use this instead of
   * a free-form WhatsApp message so scheduled delivery works outside the 24-hour window.
   */
  presentation?: WhatsAppMessageDigestPresentation;

  /** Required cancellation fence identity for Message Digest template events. */
  deliveryAuthorization?: WhatsAppMessageDigestDeliveryAuthorization;

  /**
   * Whether whatsapp-service may retain message text for reply correlation.
   * Defaults to true. Message Digests explicitly set this to false.
   */
  retainMessageText?: boolean;

  /**
   * Optional: marks the message as important so whatsapp-service delivers it
   * even when the recipient has opted into 'important' notifications only.
   */
  important?: boolean;

  /**
   * Optional consumer-side delivery idempotency key. Only callers that require
   * durable exactly-once suppression should set this field.
   */
  idempotencyKey?: string;

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
