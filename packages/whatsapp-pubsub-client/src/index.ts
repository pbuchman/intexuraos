/**
 * @intexuraos/whatsapp-pubsub-client
 *
 * Publisher-side client for the WhatsApp send Pub/Sub topic.
 * Apps that need to enqueue WhatsApp messages depend on this leaf package
 * instead of importing from `whatsapp-service` (which would create an
 * app-to-app coupling) or from `infra-pubsub` (which is reserved for the
 * generic `BasePubSubPublisher`).
 */
export type {
  SendMessageEvent,
  WhatsAppInteractiveButton,
  WhatsAppMessageDigestDeliveryAuthorization,
  WhatsAppMessageDigestPresentation,
  WhatsAppMessageDigestV1Presentation,
  WhatsAppMessageDigestV2Presentation,
  WhatsAppSendPublisherConfig,
} from './types.js';
export {
  MESSAGE_DIGEST_EVENT_MESSAGE,
  MESSAGE_DIGEST_TEMPLATE_EXCERPT_MAX_CODE_POINTS,
  MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS,
  MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS,
  MESSAGE_DIGEST_TEMPLATE_V2_FIXED_BODY_CODE_POINTS,
  MESSAGE_DIGEST_TEMPLATE_V2_HEADLINE_MAX_CODE_POINTS,
  MESSAGE_DIGEST_TEMPLATE_V2_WINDOW_LABEL_MAX_CODE_POINTS,
} from './types.js';
export {
  buildSendMessageEvent,
  type WhatsAppSendPublisher,
  type WhatsAppSendPublisherWithReceipt,
  createWhatsAppSendPublisher,
} from './whatsappSendPublisher.js';
