/**
 * Types for the todos-processing Pub/Sub client.
 */
import type { Logger } from 'pino';

/**
 * Event to process a newly created todo.
 * This is the payload format expected by todos-agent's Pub/Sub handler.
 */
export interface TodoProcessingEvent {
  /**
   * Event type identifier.
   */
  type: 'todos.processing.created';

  /**
   * The ID of the todo to process.
   */
  todoId: string;

  /**
   * The user who owns the todo.
   */
  userId: string;

  /**
   * The todo title (for logging/debugging).
   */
  title: string;

  /**
   * Correlation ID for tracing across services.
   */
  correlationId: string;

  /**
   * Event timestamp (ISO 8601).
   */
  timestamp: string;
}

/**
 * Configuration for the todos processing publisher.
 */
export interface TodosProcessingPublisherConfig {
  projectId: string;
  topicName: string;
  logger: Logger;
}
