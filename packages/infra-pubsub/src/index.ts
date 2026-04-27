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

export { extractCorrelation, type InboundPubSubAttributes } from './extractCorrelation.js';
/* Type-only re-export — runtime ALS helpers (`runWithRequestContext`, `getRequestContext`) are intentionally NOT exported. Each consumer must use the AsyncLocalStorage instance from `@intexuraos/common-core/tracing` (S2) to avoid duplicate stores. The shim file is removed by the INT-1538 reconciliation commit once S2 lands. */
export type { RequestContext } from './requestContextShim.js';
