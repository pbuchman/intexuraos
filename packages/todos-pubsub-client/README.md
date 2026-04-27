# @intexuraos/todos-pubsub-client

Publisher-side leaf client for the todos-processing Pub/Sub topic.

This package exists so that services which only need to **enqueue** a todo
for background processing can do so without depending on the consumer service
(`todos-agent`) and without polluting the generic `@intexuraos/infra-pubsub`
package with domain-specific publishers.

## Exports

- `createTodosProcessingPublisher(config)` — factory returning a
  `TodosProcessingPublisher` bound to a Pub/Sub topic.
- `TodosProcessingPublisher` — the publisher interface.
- `TodosProcessingPublisherConfig` — `{ projectId, topicName, logger }`.
- `TodoProcessingEvent` — payload shape consumed by `todos-agent`.

## Dependencies

- `@intexuraos/common-core` — `Result` helpers.
- `@intexuraos/infra-pubsub` — `BasePubSubPublisher` + `PublishError`.
