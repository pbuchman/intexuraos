/**
 * @intexuraos/todos-pubsub-client
 *
 * Publisher-side leaf client for the todos processing Pub/Sub topic.
 * Apps that need to enqueue todo-processing requests depend on this package
 * instead of importing from `todos-agent` (the consumer service) or from
 * `infra-pubsub` (which is reserved for the generic `BasePubSubPublisher`).
 */
export type { TodoProcessingEvent, TodosProcessingPublisherConfig } from './types.js';
export {
  type TodosProcessingPublisher,
  createTodosProcessingPublisher,
} from './todosProcessingPublisher.js';
