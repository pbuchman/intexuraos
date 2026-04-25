import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { BasePubSubPublisher, type PublishContext } from '../basePublisher.js';
import { runWithRequestContext } from '../requestContextShim.js';
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
    topicName: string,
    event: unknown,
    context: PublishContext
  ): Promise<Result<void, PublishError>> {
    return await this.publishToTopic(topicName, event, context, 'test event');
  }

  async publishOptional(
    topicName: string | null,
    event: unknown,
    context: PublishContext
  ): Promise<Result<void, PublishError>> {
    return await this.publishToOptionalTopic(topicName, event, context, 'test optional event');
  }
}

describe('BasePubSubPublisher', () => {
  let publisher: TestPublisher;
  const mockLogger = pino({ name: 'test', level: 'silent' });

  beforeEach(() => {
    mockPublishMessage.mockReset();
    mockPublishMessage.mockResolvedValue('message-id-123');
    publisher = new TestPublisher({ projectId: 'test-project', logger: mockLogger });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe('publishToTopic', () => {
    it('publishes event successfully', async () => {
      const result = await publisher.publish('test-topic', { data: 'test' }, { id: '123' });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);
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

  describe('publishToOptionalTopic', () => {
    it('skips publishing when topic is null', async () => {
      const result = await publisher.publishOptional(null, { data: 'test' }, { id: '123' });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).not.toHaveBeenCalled();
    });

    it('publishes when topic is provided', async () => {
      const result = await publisher.publishOptional(
        'optional-topic',
        { data: 'test' },
        { id: '456' }
      );

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);
    });

    it('publishToOptionalTopic sets correlation attributes when context exists', async () => {
      await runWithRequestContext({ requestId: 'opt-r', correlationId: 'opt-c' }, async () => {
        await publisher.publishOptional('optional-topic', { data: 'test' }, {});
      });

      const call = mockPublishMessage.mock.calls[0]?.[0] as {
        attributes: Record<string, string>;
      };
      expect(call.attributes['x-request-id']).toBe('opt-r');
      expect(call.attributes['x-correlation-id']).toBe('opt-c');
    });
  });

  describe('correlation attributes', () => {
    it('sets x-request-id and x-correlation-id from request context', async () => {
      await runWithRequestContext({ requestId: 'r-1', correlationId: 'r-1' }, async () => {
        await publisher.publish('test-topic', { data: 'test' }, {});
      });

      expect(mockPublishMessage).toHaveBeenCalledTimes(1);
      const call = mockPublishMessage.mock.calls[0]?.[0] as {
        data: Buffer;
        attributes: Record<string, string>;
      };
      expect(call.data).toBeInstanceOf(Buffer);
      expect(call.attributes['x-request-id']).toBe('r-1');
      expect(call.attributes['x-correlation-id']).toBe('r-1');
    });

    it('sets traceparent when traceId and parentId are present', async () => {
      const traceId = 't'.repeat(32);
      const parentId = 'p'.repeat(16);
      await runWithRequestContext(
        { requestId: 'r-1', correlationId: 'r-1', traceId, parentId },
        async () => {
          await publisher.publish('test-topic', { data: 'test' }, {});
        }
      );

      const call = mockPublishMessage.mock.calls[0]?.[0] as {
        attributes: Record<string, string>;
      };
      expect(call.attributes['traceparent']).toBe(`00-${traceId}-${parentId}-01`);
    });

    it('uses 0000000000000000 parent when traceId is set but parentId is absent', async () => {
      const traceId = 't'.repeat(32);
      await runWithRequestContext({ requestId: 'r-1', correlationId: 'r-1', traceId }, async () => {
        await publisher.publish('test-topic', { data: 'test' }, {});
      });

      const call = mockPublishMessage.mock.calls[0]?.[0] as {
        attributes: Record<string, string>;
      };
      expect(call.attributes['traceparent']).toBe(`00-${traceId}-0000000000000000-01`);
    });

    it('omits correlation attributes outside any request context but keeps publisher-service', async () => {
      await publisher.publish('test-topic', { data: 'test' }, {});

      const call = mockPublishMessage.mock.calls[0]?.[0] as {
        attributes: Record<string, string>;
      };
      expect('x-request-id' in call.attributes).toBe(false);
      expect('x-correlation-id' in call.attributes).toBe(false);
      expect('traceparent' in call.attributes).toBe(false);
      expect(call.attributes['publisher-service']).toBeDefined();
    });

    it('omits traceparent when ctx has no traceId (only correlation ids)', async () => {
      await runWithRequestContext({ requestId: 'r-1', correlationId: 'r-1' }, async () => {
        await publisher.publish('test-topic', { data: 'test' }, {});
      });

      const call = mockPublishMessage.mock.calls[0]?.[0] as {
        attributes: Record<string, string>;
      };
      expect('traceparent' in call.attributes).toBe(false);
    });

    it('uses INTEXURAOS_SERVICE_NAME for publisher-service when set', async () => {
      vi.stubEnv('INTEXURAOS_SERVICE_NAME', 'whatsapp-service');
      await publisher.publish('test-topic', { data: 'test' }, {});

      const call = mockPublishMessage.mock.calls[0]?.[0] as {
        attributes: Record<string, string>;
      };
      expect(call.attributes['publisher-service']).toBe('whatsapp-service');
    });

    it('falls back to "unknown" for publisher-service when env var is absent', async () => {
      vi.stubEnv('INTEXURAOS_SERVICE_NAME', '');
      // empty string from stubEnv still returns '' from process.env, which is falsy for ??;
      // re-stub by deleting
      vi.unstubAllEnvs();
      const original = process.env['INTEXURAOS_SERVICE_NAME'];
      delete process.env['INTEXURAOS_SERVICE_NAME'];
      try {
        await publisher.publish('test-topic', { data: 'test' }, {});
        const call = mockPublishMessage.mock.calls[0]?.[0] as {
          attributes: Record<string, string>;
        };
        expect(call.attributes['publisher-service']).toBe('unknown');
      } finally {
        if (original !== undefined) {
          process.env['INTEXURAOS_SERVICE_NAME'] = original;
        }
      }
    });
  });
});
