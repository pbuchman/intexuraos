# @intexuraos/todos-pubsub-client

Publisher-side leaf client for the `todos.processing.created` Pub/Sub topic. Lets any service enqueue a todo for background processing by `todos-agent`, without taking a workspace dependency on `todos-agent` itself.

**Type:** ESM
**Node:** >=22.0.0

## Why this package exists

`@intexuraos/infra-pubsub` is a generic, domain-free wrapper around `@google-cloud/pubsub`. Domain event types and topic-specific factory functions used to live alongside it, which created a hidden dependency: every publisher imported a payload type that semantically belonged to the consumer service.

To break that cycle, each typed publisher now lives in its own leaf client package. Publishers depend on the leaf client, the leaf client depends on `infra-pubsub`, and the consumer service depends on neither.

## Dependencies

| Package                     | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `@intexuraos/common-core`   | `Result` helpers for the publisher API   |
| `@intexuraos/infra-pubsub`  | `BasePubSubPublisher` + `PublishError`   |

## Exports

- `createTodosProcessingPublisher(config)` — factory returning a `TodosProcessingPublisher` bound to a Pub/Sub topic.
- `TodosProcessingPublisher` — publisher interface (`publishTodoProcessing`).
- `TodosProcessingPublisherConfig` — `{ projectId, topicName, logger }`.
- `TodoProcessingEvent` — payload shape consumed by `todos-agent`.

## Usage

```ts
import { createTodosProcessingPublisher } from '@intexuraos/todos-pubsub-client';

const publisher = createTodosProcessingPublisher({
  projectId: process.env['INTEXURAOS_GCP_PROJECT_ID']!,
  topicName: process.env['INTEXURAOS_TODOS_PROCESSING_TOPIC']!,
  logger,
});

const result = await publisher.publishTodoProcessing({
  todoId: 'todo-123',
  userId: 'user-456',
});

if (!result.ok) {
  logger.error({ error: result.error }, 'Failed to enqueue todo processing');
}
```

## Used By

- `apps/todos-agent` (self-publishes for retry/scheduling flows)

## Source Files

| File                              | Purpose                                  |
| --------------------------------- | ---------------------------------------- |
| `src/index.ts`                    | Public barrel                            |
| `src/todosProcessingPublisher.ts` | `createTodosProcessingPublisher` factory |
| `src/types.ts`                    | `TodoProcessingEvent` payload shape      |
