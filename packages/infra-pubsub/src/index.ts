/**
 * @intexuraos/infra-pubsub
 *
 * Generic Pub/Sub infrastructure: a thin wrapper around `@google-cloud/pubsub`
 * that callers extend via {@link BasePubSubPublisher}.
 *
 * Domain-specific publisher factories (WhatsApp send, todos processing,
 * calendar preview, PR triage) live in their own leaf client packages
 * under `packages/*-pubsub-client/`.
 */

export type { PublishError, PublishFailureReason } from './types.js';

export {
  BasePubSubPublisher,
  type BasePubSubPublisherConfig,
  type PublishContext,
} from './basePublisher.js';
