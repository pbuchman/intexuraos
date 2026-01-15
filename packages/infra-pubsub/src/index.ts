/**
 * @intexuraos/infra-pubsub
 *
 * Pub/Sub infrastructure adapters for cross-service messaging.
 */

export type {
  PublishError,
  SendMessageEvent,
  WhatsAppSendPublisherConfig,
  TodoProcessingEvent,
  TodosProcessingPublisherConfig,
} from './types.js';

export {
  BasePubSubPublisher,
  type BasePubSubPublisherConfig,
  type PublishContext,
} from './basePublisher.js';

export {
  type WhatsAppSendPublisher,
  createWhatsAppSendPublisher,
} from './whatsappSendPublisher.js';

export {
  type TodosProcessingPublisher,
  createTodosProcessingPublisher,
} from './todosProcessingPublisher.js';
