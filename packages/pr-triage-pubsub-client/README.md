# @intexuraos/pr-triage-pubsub-client

Publisher-side leaf client for the PR-triage Pub/Sub topic.

This package exists so that webhook handlers (`code-agent`) can enqueue a
PR-triage request without polluting the generic `@intexuraos/infra-pubsub`
package with domain-specific publishers.

## Exports

- `createPRTriagePublisher(config)` — factory returning a
  `PRTriagePublisher` bound to a Pub/Sub topic.
- `PRTriagePublisher` — the publisher interface.
- `PRTriagePublisherConfig` — `{ projectId, topicName, logger }`. An empty
  `topicName` skips publish and resolves to `ok` (used in environments where
  the push subscription is not wired up).
- `PRTriageEvent` — payload shape consumed by `code-agent`.

## Dependencies

- `@intexuraos/common-core` — `Result` helpers.
- `@intexuraos/infra-pubsub` — `BasePubSubPublisher` + `PublishError`.
