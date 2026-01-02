import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BasePubSubPublisher, getLogLevel, type PublishContext } from '../basePublisher.js';
import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '../types.js';

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

class TestPublisher extends BasePubSubPublisher {
  async publish(
    topicName: string | null,
    event: unknown,
    context: PublishContext
  ): Promise<Result<void, PublishError>> {
    return await this.publishToTopic(topicName, event, context, 'test event');
  }
}

describe('getLogLevel', () => {
  it('returns silent for test environment', () => {
    expect(getLogLevel('test')).toBe('silent');
  });

  it('returns info for non-test environment', () => {
    expect(getLogLevel('production')).toBe('info');
    expect(getLogLevel('development')).toBe('info');
    expect(getLogLevel(undefined)).toBe('info');
  });
});

describe('BasePubSubPublisher', () => {
  let publisher: TestPublisher;

  beforeEach(() => {
    mockPublishMessage.mockReset();
    mockPublishMessage.mockResolvedValue('message-id-123');
    publisher = new TestPublisher({ projectId: 'test-project', loggerName: 'test' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('uses default loggerName when not provided', () => {
      const pub = new TestPublisher({ projectId: 'test-project' });
      expect(pub).toBeDefined();
    });
  });

  describe('publishToTopic', () => {
    it('publishes event successfully', async () => {
      const result = await publisher.publish('test-topic', { data: 'test' }, { id: '123' });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);
    });

    it('skips publishing when topic is null', async () => {
      const result = await publisher.publish(null, { data: 'test' }, { id: '123' });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).not.toHaveBeenCalled();
    });

    it('caches topic references', async () => {
      await publisher.publish('test-topic', { data: '1' }, {});
      await publisher.publish('test-topic', { data: '2' }, {});

      expect(mockPublishMessage).toHaveBeenCalledTimes(2);
    });

    it('returns TOPIC_NOT_FOUND error when topic does not exist', async () => {
      mockPublishMessage.mockRejectedValue(new Error('NOT_FOUND: Topic does not exist'));

      const result = await publisher.publish('missing-topic', { data: 'test' }, {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOPIC_NOT_FOUND');
        expect(result.error.message).toContain('NOT_FOUND');
        expect(result.error.message).toContain('missing-topic');
      }
    });

    it('returns PERMISSION_DENIED error when access is denied', async () => {
      mockPublishMessage.mockRejectedValue(new Error('PERMISSION_DENIED: Access denied'));

      const result = await publisher.publish('forbidden-topic', { data: 'test' }, {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('PERMISSION_DENIED');
        expect(result.error.message).toContain('forbidden-topic');
      }
    });

    it('returns PUBLISH_FAILED error for other failures', async () => {
      mockPublishMessage.mockRejectedValue(new Error('Connection timeout'));

      const result = await publisher.publish('test-topic', { data: 'test' }, {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PUBLISH_FAILED');
        expect(result.error.message).toContain('Connection timeout');
      }
    });
  });
});
