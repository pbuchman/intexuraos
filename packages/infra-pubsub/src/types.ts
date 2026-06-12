/**
 * Pub/Sub infrastructure types.
 *
 * This module exposes ONLY generic Pub/Sub primitives. Domain-specific event
 * shapes live in their dedicated leaf client packages
 * (e.g. `@intexuraos/whatsapp-pubsub-client`,
 * `@intexuraos/todos-pubsub-client`,
 * `@intexuraos/calendar-pubsub-client`,
 * `@intexuraos/pr-triage-pubsub-client`).
 */

/**
 * Reason a publish operation failed. Extracted as a named type so callers can
 * switch on it without re-stating the union literally.
 */
export type PublishFailureReason = 'PUBLISH_FAILED' | 'TOPIC_NOT_FOUND' | 'PERMISSION_DENIED';

/**
 * Error returned when a publish operation fails.
 */
export interface PublishError {
  code: PublishFailureReason;
  message: string;
}
