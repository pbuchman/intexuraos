/**
 * Tests for Todos Processing Publisher.
 * Mocks @google-cloud/pubsub SDK to test publishing without real Pub/Sub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTodosProcessingPublisher } from '../todosProcessingPublisher.js';
import type { TodosProcessingPublisherConfig } from '../types.js';

const mockPublishMessage = vi.fn();

vi.mock('@google-cloud/pubsub', () => {
  class MockTopic {
    publishMessage = mockPublishMessage;
  }

  class MockPubSub {
    topic(): MockTopic {
      return new MockTopic();
    }
  }

  return {
    PubSub: MockPubSub,
  };
});

describe('createTodosProcessingPublisher', () => {
  const config: TodosProcessingPublisherConfig = {
    projectId: 'test-project',
    topicName: 'test-todos-processing-topic',
  };

  beforeEach(() => {
    mockPublishMessage.mockReset();
    mockPublishMessage.mockResolvedValue('message-id-123');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('publishTodoCreated', () => {
    it('publishes todo.created event with all required fields', async () => {
      const publisher = createTodosProcessingPublisher(config);

      const result = await publisher.publishTodoCreated({
        todoId: 'todo-123',
        userId: 'user-456',
        title: 'Test Todo',
        correlationId: 'corr-789',
      });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['type']).toBe('todos.processing.created');
      expect(publishedData['todoId']).toBe('todo-123');
      expect(publishedData['userId']).toBe('user-456');
      expect(publishedData['title']).toBe('Test Todo');
      expect(publishedData['correlationId']).toBe('corr-789');
      expect(publishedData['timestamp']).toBeDefined();
    });

    it('generates correlationId when not provided', async () => {
      const publisher = createTodosProcessingPublisher(config);

      const result = await publisher.publishTodoCreated({
        todoId: 'todo-123',
        userId: 'user-456',
        title: 'Test Todo',
      });

      expect(result.ok).toBe(true);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['correlationId']).toBeDefined();
      expect(typeof publishedData['correlationId']).toBe('string');
      expect((publishedData['correlationId'] as string).length).toBeGreaterThan(0);
    });

    it('returns TOPIC_NOT_FOUND error when topic does not exist', async () => {
      mockPublishMessage.mockRejectedValue(new Error('NOT_FOUND: Topic does not exist'));

      const publisher = createTodosProcessingPublisher(config);

      const result = await publisher.publishTodoCreated({
        todoId: 'todo-123',
        userId: 'user-456',
        title: 'Test Todo',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOPIC_NOT_FOUND');
        expect(result.error.message).toContain('NOT_FOUND');
      }
    });

    it('returns PERMISSION_DENIED error when access is denied', async () => {
      mockPublishMessage.mockRejectedValue(new Error('PERMISSION_DENIED: Access denied'));

      const publisher = createTodosProcessingPublisher(config);

      const result = await publisher.publishTodoCreated({
        todoId: 'todo-123',
        userId: 'user-456',
        title: 'Test Todo',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('PERMISSION_DENIED');
      }
    });

    it('returns PUBLISH_FAILED error for other failures', async () => {
      mockPublishMessage.mockRejectedValue(new Error('Connection timeout'));

      const publisher = createTodosProcessingPublisher(config);

      const result = await publisher.publishTodoCreated({
        todoId: 'todo-123',
        userId: 'user-456',
        title: 'Test Todo',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PUBLISH_FAILED');
        expect(result.error.message).toContain('Connection timeout');
      }
    });
  });
});
