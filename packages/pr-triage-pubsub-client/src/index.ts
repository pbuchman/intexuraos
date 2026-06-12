/**
 * @intexuraos/pr-triage-pubsub-client
 *
 * Publisher-side leaf client for the PR-triage Pub/Sub topic. Apps that
 * need to enqueue a PR triage request depend on this package instead of
 * importing from `code-agent` (the consumer service) or from
 * `infra-pubsub` (which is reserved for the generic `BasePubSubPublisher`).
 */
export type { PRTriageEvent, PRTriagePublisherConfig } from './types.js';
export { type PRTriagePublisher, createPRTriagePublisher } from './prTriagePublisher.js';
