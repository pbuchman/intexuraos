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
  WhatsAppSendPublisherConfig,
} from './types.js';
export {
  type WhatsAppSendPublisher,
  type WhatsAppSendPublisherWithReceipt,
  createWhatsAppSendPublisher,
} from './whatsappSendPublisher.js';
