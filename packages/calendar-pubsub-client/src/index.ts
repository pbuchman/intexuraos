/**
 * @intexuraos/calendar-pubsub-client
 *
 * Publisher-side leaf client for the calendar-preview Pub/Sub topic.
 * Apps that need to enqueue a calendar preview generation request depend
 * on this package instead of importing from `calendar-agent` (the consumer
 * service) or from `infra-pubsub` (which is reserved for the generic
 * `BasePubSubPublisher`).
 */
export type { CalendarPreviewGenerateEvent, CalendarPreviewPublisherConfig } from './types.js';
export {
  type CalendarPreviewPublisher,
  createCalendarPreviewPublisher,
} from './calendarPreviewPublisher.js';
