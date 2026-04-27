/**
 * @intexuraos/infra-pubsub
 *
 * Pub/Sub infrastructure adapters for cross-service messaging.
 */

export type {
  PublishError,
  SendMessageEvent,
  WhatsAppInteractiveButton,
  WhatsAppSendPublisherConfig,
  TodoProcessingEvent,
  TodosProcessingPublisherConfig,
  CalendarPreviewGenerateEvent,
  CalendarPreviewPublisherConfig,
  PRTriageEvent,
  PRTriagePublisherConfig,
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

export {
  type CalendarPreviewPublisher,
  createCalendarPreviewPublisher,
} from './calendarPreviewPublisher.js';

export { type PRTriagePublisher, createPRTriagePublisher } from './prTriagePublisher.js';

export { extractCorrelation, type InboundPubSubAttributes } from './extractCorrelation.js';
/* Type-only re-export — runtime ALS helpers (`runWithRequestContext`, `getRequestContext`) are intentionally NOT exported. Each consumer must use the AsyncLocalStorage instance from `@intexuraos/common-core/tracing` (S2) to avoid duplicate stores. The shim file is removed by the INT-1538 reconciliation commit once S2 lands. */
export type { RequestContext } from './requestContextShim.js';
