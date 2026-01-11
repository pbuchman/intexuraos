/**
 * Todos Processing Publisher.
 * Publishes TodoProcessingEvent to Pub/Sub for todos-agent to process.
 */
import { type Result } from '@intexuraos/common-core';
import { BasePubSubPublisher } from './basePublisher.js';
import type { PublishError, TodoProcessingEvent, TodosProcessingPublisherConfig } from './types.js';

/**
 * Interface for publishing todos processing events.
 */
export interface TodosProcessingPublisher {
  /**
   * Publish a todo processing event to Pub/Sub.
   * The event will be processed by todos-agent's processing worker.
   */
  publishTodoCreated(params: {
    todoId: string;
    userId: string;
    title: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>>;
}

/**
 * Todos processing publisher using BasePubSubPublisher.
 */
class TodosProcessingPublisherImpl extends BasePubSubPublisher implements TodosProcessingPublisher {
  private readonly topicName: string;

  constructor(config: TodosProcessingPublisherConfig) {
    super({ projectId: config.projectId, loggerName: 'todos-processing-publisher' });
    this.topicName = config.topicName;
  }

  async publishTodoCreated(params: {
    todoId: string;
    userId: string;
    title: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>> {
    const correlationId = params.correlationId ?? crypto.randomUUID();

    const event: TodoProcessingEvent = {
      type: 'todos.processing.created',
      todoId: params.todoId,
      userId: params.userId,
      title: params.title,
      correlationId,
      timestamp: new Date().toISOString(),
    };

    return await this.publishToTopic(
      this.topicName,
      event,
      { correlationId, todoId: params.todoId, userId: params.userId },
      'todo processing'
    );
  }
}

/**
 * Create a todos processing publisher.
 */
export function createTodosProcessingPublisher(
  config: TodosProcessingPublisherConfig
): TodosProcessingPublisher {
  return new TodosProcessingPublisherImpl(config);
}
